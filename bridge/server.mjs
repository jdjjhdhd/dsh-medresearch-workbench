#!/usr/bin/env node
/**
 * 医学研究工作台 · 本地桥接服务（零第三方依赖）
 *
 * 只监听 127.0.0.1，为工作台窗口提供浏览器无法直接完成的能力：
 *   1. Zotero 7 本地 API 只读代理（绕过浏览器 CORS，解析 PDF/笔记/批注/全文）
 *   2. 统一数据文件保存、原子写、备份与恢复（项目 data/ 目录）
 *   3. 可选的大模型单篇论文问答（密钥只从宿主环境变量读取，永不返回浏览器）
 * 医学文献 / 临床试验 / 药物检索由页面直连公开上游（均支持 CORS），无需本服务。
 *
 * 启动：node bridge/server.mjs   （或双击项目根目录的「启动医学工作台服务.cmd」）
 * 环境变量（全部可选）：
 *   MEDWB_PORT=8765            桥接端口
 *   ZOTERO_BASE_URL=http://127.0.0.1:23119/api
 *   NCBI_API_KEY / NCBI_EMAIL  PubMed 提升额度（BioMCP 同名变量）
 *   OPENFDA_API_KEY            openFDA 提升额度
 *   DEEPSEEK_API_KEY / OPENAI_API_KEY / LLM_BASE_URL / LLM_MODEL  单篇问答
 */
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '0.2.4';
const SERVICE_ID = 'medresearch-workbench-bridge';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'workbench-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PORT = Number(process.env.MEDWB_PORT || 8765);
const ZOTERO_BASE = String(process.env.ZOTERO_BASE_URL || 'http://127.0.0.1:23119/api').replace(/\/+$/, '');
const NCBI_KEY = String(process.env.NCBI_API_KEY || process.env.BIOMCP_NCBI_API_KEY || '').trim();
const NCBI_EMAIL = String(process.env.NCBI_EMAIL || '').trim();
const OPENFDA_KEY = String(process.env.OPENFDA_API_KEY || '').trim();
const LLM = resolveLlmConfig();

function resolveLlmConfig() {
  const base = String(process.env.LLM_BASE_URL || '').trim();
  const model = String(process.env.LLM_MODEL || '').trim();
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      configured: true,
      provider: 'deepseek',
      key: String(process.env.DEEPSEEK_API_KEY),
      baseUrl: base || 'https://api.deepseek.com/v1',
      model: model || 'deepseek-flash',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      configured: true,
      provider: 'openai',
      key: String(process.env.OPENAI_API_KEY),
      baseUrl: base || 'https://api.openai.com/v1',
      model: model || 'gpt-4o-mini',
    };
  }
  return { configured: false, provider: '', key: '', baseUrl: '', model: model || '' };
}

/* ------------------------------------------------------------------ 基础工具 */
// 允许桌面端自定义协议来源 dsh-app://app（工作台 iframe 的真实 Origin），
// 以及本机 HTTP 来源；不允许任意远程站点。
const ALLOWED_ORIGIN = /^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|dsh-app:\/\/app)$/i;

export function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGIN.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-credentials', 'true');
    // Chromium/Electron 从自定义协议访问环回地址时可能触发 Private Network Access 预检。
    res.setHeader('access-control-allow-private-network', 'true');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-requested-with, x-medresearch-project-root');
  res.setHeader('access-control-max-age', '600');
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

async function readJsonBody(req, limit = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413, code: 'too-large' });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON 解析失败'), { status: 400, code: 'bad-json' });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const r = await fetchWithTimeout(url, options, timeoutMs);
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: r.status, ok: r.ok, headers: r.headers, json, text };
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

function stripXml(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeDrugName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ NCBI 队列与 PubMed */
let ncbiChain = Promise.resolve();
let lastNcbiAt = 0;

function ncbiSchedule(fn) {
  const run = async () => {
    const gap = NCBI_KEY ? 120 : 380;
    const wait = gap - (Date.now() - lastNcbiAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastNcbiAt = Date.now();
    }
  };
  const p = ncbiChain.then(run, run);
  ncbiChain = p.catch(() => {});
  return p;
}

async function ncbiFetch(url, timeoutMs) {
  return ncbiSchedule(async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetchWithTimeout(url, { headers: { 'user-agent': 'medresearch-workbench/1.0 (+local)' } }, timeoutMs);
        if (r.status === 429 || r.status >= 500) {
          lastError = new Error(r.status === 429 ? 'NCBI 限速（429），请稍后重试' : `NCBI 上游错误（${r.status}）`);
          if (attempt < 2) {
            await sleep(600 * (attempt + 1));
            continue;
          }
          throw Object.assign(lastError, { status: 502, code: 'upstream-failed' });
        }
        if (!r.ok) {
          throw Object.assign(new Error(`NCBI 返回 ${r.status}`), { status: 502, code: 'upstream-failed' });
        }
        return await r.text();
      } catch (error) {
        lastError = error;
        if (error.status) throw error;
        if (attempt < 2) {
          await sleep(600 * (attempt + 1));
          continue;
        }
      }
    }
    const msg = lastError && lastError.name === 'AbortError' ? 'NCBI 请求超时' : '无法连接 NCBI';
    throw Object.assign(new Error(msg), { status: 504, code: 'upstream-timeout' });
  });
}

function ncbiParams(extra) {
  const p = new URLSearchParams(extra);
  p.set('tool', 'dsh-medresearch-workbench');
  if (NCBI_EMAIL) p.set('email', NCBI_EMAIL);
  if (NCBI_KEY) p.set('api_key', NCBI_KEY);
  return p;
}

function parsePubMedXml(xml) {
  const items = [];
  const blocks = String(xml).match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  for (const block of blocks) {
    const pmid = (block.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1] || '';
    if (!pmid) continue;
    const title = stripXml((block.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || [])[1] || '');
    const abstractParts = [];
    const abstractRe = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g;
    let m;
    while ((m = abstractRe.exec(block))) {
      const label = (m[1].match(/Label="([^"]*)"/) || [])[1] || '';
      const text = stripXml(m[2]);
      if (text) abstractParts.push(label ? `${label}: ${text}` : text);
    }
    const journal = stripXml((block.match(/<Journal>[\s\S]*?<Title[^>]*>([\s\S]*?)<\/Title>/) || [])[1] || '');
    const pubDateBlock = (block.match(/<PubDate>([\s\S]*?)<\/PubDate>/) || [])[1] || '';
    const year =
      (pubDateBlock.match(/<Year>(\d{4})<\/Year>/) || [])[1] ||
      (pubDateBlock.match(/<MedlineDate>[\s\S]*?(\d{4})/) || [])[1] ||
      (block.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/) || [])[1] ||
      '';
    const month = (pubDateBlock.match(/<Month>([^<]+)<\/Month>/) || [])[1] || '';
    const day = (pubDateBlock.match(/<Day>(\d+)<\/Day>/) || [])[1] || '';
    const authors = [];
    const authorRe = /<Author([^>]*)>([\s\S]*?)<\/Author>/g;
    let a;
    while ((a = authorRe.exec(block))) {
      const inner = a[2];
      const last = stripXml((inner.match(/<LastName[^>]*>([\s\S]*?)<\/LastName>/) || [])[1] || '');
      const first = stripXml((inner.match(/<ForeName[^>]*>([\s\S]*?)<\/ForeName>/) || [])[1] || '');
      const collective = stripXml((inner.match(/<CollectiveName[^>]*>([\s\S]*?)<\/CollectiveName>/) || [])[1] || '');
      const name = collective || [last, first].filter(Boolean).join(' ');
      if (name) authors.push(name);
    }
    const doi =
      stripXml((block.match(/<ArticleId\s+IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/) || [])[1] || '') ||
      stripXml((block.match(/<ELocationID\s+EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/) || [])[1] || '');
    const pmc = stripXml((block.match(/<ArticleId\s+IdType="pmc"[^>]*>([\s\S]*?)<\/ArticleId>/) || [])[1] || '');
    items.push({
      pmid,
      title: title || '(未取到标题)',
      authors,
      journal,
      year,
      date: [year, month, day].filter(Boolean).join(' '),
      abstract: abstractParts.join('\n\n'),
      doi,
      pmc,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  }
  return items;
}

async function searchPubMed({ query, mindate, maxdate, limit, sort }) {
  const term = String(query || '').trim();
  if (!term) throw Object.assign(new Error('请输入检索词'), { status: 400, code: 'bad-request' });
  const retmax = clampInt(limit, 1, 30, 10);
  const parts = [`(${term})`];
  if (mindate || maxdate) {
    const from = mindate ? `${mindate}` : '1900';
    const to = maxdate ? `${maxdate}` : '3000';
    parts.push(`("${from}"[Date - Publication] : "${to}"[Date - Publication])`);
  }
  const searchParams = ncbiParams({
    db: 'pubmed',
    term: parts.join(' AND '),
    retmode: 'json',
    retmax: String(retmax),
    sort: sort === 'date' ? 'pub_date' : 'relevance',
  });
  const searchText = await ncbiFetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams.toString()}`,
    15000,
  );
  let searchJson;
  try {
    searchJson = JSON.parse(searchText);
  } catch {
    throw Object.assign(new Error('PubMed 返回无法解析'), { status: 502, code: 'upstream-failed' });
  }
  if (searchJson.error) {
    throw Object.assign(new Error(`PubMed 检索失败：${searchJson.error}`), { status: 502, code: 'upstream-failed' });
  }
  const result = searchJson.esearchresult || {};
  const ids = Array.isArray(result.idlist) ? result.idlist : [];
  const total = Number(result.count || 0);
  if (ids.length === 0) {
    return { source: 'PubMed', query: term, total: 0, items: [], at: nowIso() };
  }
  const fetchParams = ncbiParams({ db: 'pubmed', id: ids.join(','), retmode: 'xml' });
  const xml = await ncbiFetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${fetchParams.toString()}`,
    25000,
  );
  return { source: 'PubMed', query: term, total, items: parsePubMedXml(xml), at: nowIso() };
}

/* ------------------------------------------------------------------ ClinicalTrials.gov v2 */
function normalizeTrial(study) {
  const p = study.protocolSection || {};
  const id = p.identificationModule || {};
  const status = p.statusModule || {};
  const design = p.designModule || {};
  const sponsor = p.sponsorCollaboratorsModule || {};
  const cond = p.conditionsModule || {};
  const arms = p.armsInterventionsModule || {};
  const desc = p.descriptionModule || {};
  const outcomes = p.outcomesModule || {};
  const interventions = (arms.interventions || [])
    .map((x) => [x.name, x.type].filter(Boolean).join(' / '))
    .filter(Boolean);
  return {
    nctId: id.nctId || '',
    title: id.briefTitle || id.officialTitle || '(未取到标题)',
    officialTitle: id.officialTitle || '',
    status: status.overallStatus || '',
    statusLabel: trialStatusLabel(status.overallStatus),
    phase: Array.isArray(design.phases) ? design.phases.join(' / ') : '',
    sponsor: sponsor.leadSponsor?.name || '',
    collaborators: (sponsor.collaborators || []).map((x) => x.name).filter(Boolean),
    startDate: status.startDateStruct?.date || '',
    lastUpdate: status.lastUpdatePostDateStruct?.date || '',
    primaryCompletion: status.primaryCompletionDateStruct?.date || '',
    enrollment: design.enrollmentInfo?.count || '',
    enrollmentType: design.enrollmentInfo?.type || '',
    conditions: Array.isArray(cond.conditions) ? cond.conditions : [],
    interventions,
    summary: desc.briefSummary || '',
    primaryOutcome: (outcomes.primaryOutcomes || []).map((x) => x.measure).filter(Boolean).join('; '),
    url: `https://clinicaltrials.gov/study/${id.nctId || ''}`,
  };
}

function trialStatusLabel(s) {
  const map = {
    RECRUITING: '招募中',
    NOT_YET_RECRUITING: '尚未招募',
    ACTIVE_NOT_RECRUITING: '进行中（不招募）',
    COMPLETED: '已完成',
    ENROLLING_BY_INVITATION: '邀请入组',
    SUSPENDED: '暂停',
    TERMINATED: '终止',
    WITHDRAWN: '撤回',
    UNKNOWN: '未知',
  };
  return map[s] || s || '';
}

async function searchTrials({ condition, intervention, phase, status, limit, query }) {
  const pageSize = clampInt(limit, 1, 30, 10);
  const params = new URLSearchParams();
  const cond = firstNonEmpty(condition, query);
  if (cond) params.set('query.cond', cond);
  if (intervention) params.set('query.intr', intervention);
  if (status) params.set('filter.overallStatus', String(status).toUpperCase());
  if (phase) params.set('filter.phase', String(phase).toUpperCase());
  params.set('pageSize', String(pageSize));
  params.set(
    'fields',
    [
      'NCTId',
      'BriefTitle',
      'OfficialTitle',
      'OverallStatus',
      'Phase',
      'LeadSponsorName',
      'CollaboratorName',
      'StartDate',
      'LastUpdatePostDate',
      'PrimaryCompletionDate',
      'EnrollmentCount',
      'EnrollmentType',
      'Condition',
      'InterventionName',
      'InterventionType',
      'BriefSummary',
      'PrimaryOutcomeMeasure',
    ].join(','),
  );
  const { status: httpStatus, ok, json } = await fetchJson(
    `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`,
    {},
    25000,
  );
  if (httpStatus === 429) {
    throw Object.assign(new Error('ClinicalTrials.gov 限速，请稍后重试'), { status: 429, code: 'rate-limited' });
  }
  if (!ok) {
    throw Object.assign(new Error(`ClinicalTrials.gov 返回 ${httpStatus}`), { status: 502, code: 'upstream-failed' });
  }
  const studies = Array.isArray(json?.studies) ? json.studies : [];
  return {
    source: 'ClinicalTrials.gov API v2',
    query: { condition: cond, intervention: intervention || '', phase: phase || '', status: status || '' },
    queryLabel: [cond, intervention].filter(Boolean).join(' / ') + (phase || status ? ` · ${[phase, status].filter(Boolean).join(' / ')}` : ''),
    total: Number(json?.totalCount || studies.length),
    items: studies.map(normalizeTrial),
    at: nowIso(),
    url: 'https://clinicaltrials.gov/',
  };
}

/* ------------------------------------------------------------------ 药物资料 */
function openFdaField(label, key) {
  const value = label?.[key];
  if (Array.isArray(value)) return value.map((x) => String(x)).join('\n').trim();
  return firstNonEmpty(value);
}

function openFdaEffective(label) {
  const raw = firstNonEmpty(label?.effective_time, label?.meta?.last_updated);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw;
}

async function searchDrug({ query }) {
  const name = String(query || '').trim();
  if (!name) throw Object.assign(new Error('请输入药物名称'), { status: 400, code: 'bad-request' });
  const warnings = [];
  let mychem = null;
  try {
    const mychemParams = new URLSearchParams({
      q: name,
      size: '3',
      fields:
        'chembl.pref_name,chembl.molecule_chembl_id,chembl.max_phase,drugbank.name,drugbank.drugbank_id,pubchem.iupac.name.all,unii.name,ginas.name,inchikey',
    });
    const r = await fetchJson(`https://mychem.info/v1/query?${mychemParams.toString()}`, {}, 20000);
    if (r.ok && r.json?.hits?.length) mychem = r.json.hits;
    else if (r.status === 429) warnings.push('MyChem.info 限速，标识信息可能不完整');
  } catch (error) {
    warnings.push(`MyChem.info 暂不可用：${error.name === 'AbortError' ? '超时' : error.message}`);
  }

  let label = null;
  let labelScore = -1;
  const pick = (results) => {
    const needle = normalizeDrugName(name);
    let best = null;
    let bestScore = -1;
    for (const lab of results || []) {
      const names = [...(lab?.openfda?.generic_name || []), ...(lab?.openfda?.brand_name || [])];
      let score = 0;
      for (const raw of names) {
        const g = normalizeDrugName(raw);
        if (!g) continue;
        if (g === needle) score = Math.max(score, 100);
        else if (g.startsWith(needle + ' ') || g.endsWith(' ' + needle)) score = Math.max(score, 60);
        else if (g.includes(needle)) score = Math.max(score, 20);
      }
      score -= Math.min(names.length, 5);
      if (score > bestScore) {
        best = lab;
        bestScore = score;
      }
    }
    return { label: best, score: bestScore };
  };
  try {
    const fdaParams = new URLSearchParams({
      search: `openfda.generic_name:"${name.replace(/"/g, '')}"`,
      limit: '10',
    });
    if (OPENFDA_KEY) fdaParams.set('api_key', OPENFDA_KEY);
    const r = await fetchJson(`https://api.fda.gov/drug/label.json?${fdaParams.toString()}`, {}, 25000);
    if (r.status === 404) {
      const brandParams = new URLSearchParams({
        search: `openfda.brand_name:"${name.replace(/"/g, '')}"`,
        limit: '10',
      });
      if (OPENFDA_KEY) brandParams.set('api_key', OPENFDA_KEY);
      const r2 = await fetchJson(`https://api.fda.gov/drug/label.json?${brandParams.toString()}`, {}, 25000);
      if (r2.ok && r2.json?.results?.length) {
        const picked = pick(r2.json.results);
        label = picked.label;
        labelScore = picked.score;
      }
    } else if (r.status === 429) {
      warnings.push('openFDA 限速，稍后重试可获取说明书摘要');
    } else if (r.ok && r.json?.results?.length) {
      const picked = pick(r.json.results);
      label = picked.label;
      labelScore = picked.score;
    }
  } catch (error) {
    warnings.push(`openFDA 暂不可用：${error.name === 'AbortError' ? '超时' : error.message}`);
  }

  const first = mychem?.[0] || {};
  const identifiers = [
    ['ChEMBL', firstNonEmpty(first.chembl?.molecule_chembl_id)],
    ['DrugBank', firstNonEmpty(first.drugbank?.drugbank_id)],
    ['UNII', firstNonEmpty(first.unii?.name)],
    ['InChIKey', firstNonEmpty(first.inchikey)],
    ['GINAS', firstNonEmpty(first.ginas?.name)],
  ].filter(([, v]) => v);
  const names = [
    firstNonEmpty(first.chembl?.pref_name),
    firstNonEmpty(first.drugbank?.name),
    ...(Array.isArray(first.pubchem?.iupac?.name?.all) ? first.pubchem.iupac.name.all : []),
  ].filter(Boolean);

  const sectionDefs = [
    ['boxed_warning', '黑框警告'],
    ['indications_and_usage', '适应症'],
    ['dosage_and_administration', '用法用量'],
    ['contraindications', '禁忌'],
    ['warnings', '警告与注意事项'],
    ['adverse_reactions', '不良反应'],
    ['drug_interactions', '药物相互作用'],
    ['use_in_specific_populations', '特殊人群'],
    ['pregnancy', '妊娠'],
    ['pediatric_use', '儿科使用'],
    ['geriatric_use', '老年使用'],
    ['overdosage', '过量'],
    ['description', '药物描述'],
    ['clinical_pharmacology', '临床药理'],
  ];
  const sections = [];
  for (const [key, heading] of sectionDefs) {
    const text = openFdaField(label, key);
    if (text) sections.push({ key, heading, text: text.slice(0, 1600) });
  }

  const fdaNames = label?.openfda || {};
  const brand = Array.isArray(fdaNames.brand_name) ? fdaNames.brand_name.slice(0, 4) : [];
  const generic = Array.isArray(fdaNames.generic_name) ? fdaNames.generic_name.slice(0, 4) : [];
  const manufacturer = Array.isArray(fdaNames.manufacturer_name) ? fdaNames.manufacturer_name.slice(0, 2) : [];
  if (label && labelScore < 60) {
    warnings.push(
      `openFDA 未找到与“${name}”完全对应的单一成分说明书；当前展示的是含该成分的组合/复方说明书（${generic.join(' / ') || brand.join(' / ') || '名称未返回'}）。请核对具体成分与适应症。`,
    );
  }

  return {
    source: 'MyChem.info + openFDA',
    query: name,
    names: [...new Set(names)].slice(0, 8),
    identifiers,
    drugClass: firstNonEmpty(first.chembl?.max_phase ? `ChEMBL 最高阶段：${first.chembl.max_phase}` : ''),
    label: label
      ? {
          region: '美国',
          agency: 'FDA（openFDA 药品说明书）',
          effectiveTime: openFdaEffective(label),
          brandNames: brand,
          genericNames: generic,
          manufacturer,
          sections,
        }
      : null,
    warnings,
    links: [
      ['DailyMed 说明书检索', `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(name)}`],
      ['PubChem 化合物', `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(name)}`],
      firstNonEmpty(first.chembl?.molecule_chembl_id)
        ? ['ChEMBL 靶点与活性', `https://www.ebi.ac.uk/chembl/explore/compound/${first.chembl.molecule_chembl_id}`]
        : null,
      firstNonEmpty(first.drugbank?.drugbank_id)
        ? ['DrugBank', `https://go.drugbank.com/drugs/${first.drugbank.drugbank_id}`]
        : null,
    ].filter(Boolean),
    coverageNote:
      '当前仅整合美国 FDA 说明书与化学标识；中国 NMPA 说明书、适应症差异、医保与可及性未覆盖，临床使用前请查阅国家药监局批准的现行说明书。',
    at: nowIso(),
  };
}

/* ------------------------------------------------------------------ 大模型问答（可选） */
async function askModel({ question, itemTitle, chunks, mode }) {
  const q = String(question || '').trim();
  if (!q) throw Object.assign(new Error('请输入问题'), { status: 400, code: 'bad-request' });
  if (!LLM.configured) {
    return {
      configured: false,
      message: '未配置模型密钥（宿主环境变量 DEEPSEEK_API_KEY 或 OPENAI_API_KEY）。已保留原文检索结果，可在原生会话中继续问答。',
    };
  }
  const list = Array.isArray(chunks) ? chunks.slice(0, 18) : [];
  const context = list
    .map((c) => `[${c.label}]${c.page ? `（第 ${c.page} 页）` : ''}\n${String(c.text || '').slice(0, 2200)}`)
    .join('\n\n');
  const system = mode === 'case'
    ? [
        '你是严谨的医学病例整理助手，服务医生、药企医学人员与科研人员。',
        '只能整理用户提供的信息；不得补写未提供的症状、体征、检查、病史或用药。',
        '先列出已提供的信息结构与缺口，再指出互相矛盾或需要澄清的点，最后围绕用户列出的问题给出循证讨论框架。',
        '不得声称已查询最新指南或数据库；不得编造页码、DOI、指南年份或药物剂量；不得给出面向具体患者的处方或处置指令。',
        '用简体中文，结构清晰，控制在 600 字以内。',
      ].join('\n')
    : [
        '你是严谨的医学文献阅读助手，服务医生、药企医学人员与科研人员。',
        '只能使用用户提供的「原文片段」作答；片段之外的信息一律视为未知。',
        '每个关键结论后用 [P1] 这样的片段编号标注出处；无法从片段确认时明确写“已读取内容中未找到”，不得猜测。',
        '不得编造页码、引文、PMID、DOI、指南年份或药物剂量；不得给出面向具体患者的诊疗指令。',
        '用简体中文，先给结论，再给依据与局限，控制在 500 字以内。',
        mode === 'explain'
          ? '用户要求解释选中的段落：先用通俗中文解释术语与逻辑，再说明该段落在论文论证中的作用。'
          : '用户在就该论文提问：直接回答问题，并列出支撑片段。',
      ].join('\n');
  const user = [
    `论文标题：${itemTitle || '（未提供）'}`,
    '',
    '原文片段：',
    context || '（无可用片段）',
    '',
    `问题：${q}`,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch(`${LLM.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM.key}` },
      body: JSON.stringify({
        model: LLM.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const text = await r.text();
    if (!r.ok) {
      const snippet = text.slice(0, 300);
      throw Object.assign(new Error(`模型请求失败（${r.status}）：${snippet}`), { status: 502, code: 'llm-failed' });
    }
    const json = JSON.parse(text);
    const answer = String(json?.choices?.[0]?.message?.content || '').trim();
    if (!answer) throw Object.assign(new Error('模型返回为空'), { status: 502, code: 'llm-empty' });
    const labels = [...answer.matchAll(/\[(P\d+)\]/g)].map((m) => m[1]);
    const valid = new Set(list.map((c) => c.label));
    const invalid = [...new Set(labels.filter((l) => !valid.has(l)))];
    const used = [...new Set(labels.filter((l) => valid.has(l)))].map((label) => {
      const c = list.find((x) => x.label === label);
      return { label, page: c?.page || null, preview: String(c?.text || '').slice(0, 160) };
    });
    return {
      configured: true,
      provider: LLM.provider,
      model: LLM.model,
      answer,
      citations: used,
      invalidCitations: invalid,
      grounded: invalid.length === 0 && labels.length > 0,
      at: nowIso(),
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('模型请求超时'), { status: 504, code: 'llm-timeout' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ Zotero 本地 API */
function zoteroHeaders() {
  return { 'Zotero-API-Version': '3', accept: 'application/json' };
}

async function zoteroFetch(pathname, timeoutMs = 6000) {
  const r = await fetchWithTimeout(`${ZOTERO_BASE}${pathname}`, { headers: zoteroHeaders() }, timeoutMs);
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: r.status, ok: r.ok, json, text, headers: r.headers };
}

async function zoteroStatus() {
  try {
    const r = await zoteroFetch('/users/0/items?limit=1', 3000);
    if (r.ok) {
      return {
        connected: true,
        base: ZOTERO_BASE,
        serverId: r.headers.get('zotero-server-id') || '',
        version: r.headers.get('zotero-api-version') || '3',
        at: nowIso(),
      };
    }
    return { connected: false, base: ZOTERO_BASE, error: `Zotero 本地 API 返回 ${r.status}`, at: nowIso() };
  } catch (error) {
    return {
      connected: false,
      base: ZOTERO_BASE,
      error:
        error.name === 'AbortError'
          ? '连接 Zotero 超时：请确认 Zotero 已启动并允许本地 API'
          : '未检测到 Zotero 本地 API（127.0.0.1:23119）',
      at: nowIso(),
    };
  }
}

function zoteroYear(date) {
  const m = String(date || '').match(/\d{4}/);
  return m ? m[0] : '';
}

function zoteroItemToRecord(item) {
  const d = item?.data || {};
  const extra = String(d.extra || '');
  const creators = Array.isArray(d.creators)
    ? d.creators
        .map((c) =>
          String(
            c.name ||
              [c.lastName, c.firstName].filter(Boolean).join(' ') ||
              c.firstName ||
              '',
          ).trim(),
        )
        .filter(Boolean)
    : [];
  const pmidFromExtra = (extra.match(/PMID\s*[:：]\s*(\d+)/i) || [])[1] || '';
  const doiFromExtra = (extra.match(/DOI\s*[:：]\s*(\S+)/i) || [])[1] || '';
  const itemType = String(d.itemType || '');
  return {
    zoteroKey: item.key,
    zoteroRef: `zotero://user/0/item/${item.key}`,
    zoteroItemType: itemType,
    title: String(d.title || d.caseName || d.name || '(无标题条目)'),
    authors: creators,
    year: zoteroYear(d.date),
    date: String(d.date || ''),
    journal: String(d.publicationTitle || d.bookTitle || d.proceedingsTitle || d.publisher || d.university || ''),
    doi: firstNonEmpty(d.DOI, doiFromExtra),
    pmid: firstNonEmpty(d.PMID, pmidFromExtra),
    abstract: String(d.abstractNote || ''),
    url: String(d.url || ''),
    tags: Array.isArray(d.tags) ? d.tags.map((t) => String(t.tag || '')).filter(Boolean) : [],
    collections: Array.isArray(d.collections) ? d.collections : [],
    extra,
  };
}

async function zoteroSearch({ q, limit, start, itemType, tag, collection, mode, sort }) {
  const params = new URLSearchParams();
  params.set('limit', String(clampInt(limit, 1, 100, 25)));
  params.set('start', String(clampInt(start, 0, 10000, 0)));
  if (q) {
    params.set('q', String(q));
    params.set('qmode', mode === 'everything' ? 'everything' : 'titleCreatorYear');
  }
  if (itemType) params.set('itemType', String(itemType));
  if (tag) params.set('tag', String(tag));
  if (sort) params.set('sort', String(sort));
  params.set('direction', 'desc');
  const base = collection
    ? `/users/0/collections/${encodeURIComponent(collection)}/items/top`
    : '/users/0/items/top';
  const r = await zoteroFetch(`${base}?${params.toString()}`, 12000);
  if (!r.ok) throw Object.assign(new Error(`Zotero 检索返回 ${r.status}`), { status: 502, code: 'zotero-failed' });
  const rows = Array.isArray(r.json) ? r.json : [];
  const total = Number(r.headers.get('total-results') || rows.length);
  return { source: 'Zotero 本地库', total, items: rows.map(zoteroItemToRecord), at: nowIso() };
}

async function zoteroCollections() {
  const r = await zoteroFetch('/users/0/collections?limit=100', 8000);
  if (!r.ok) throw Object.assign(new Error(`读取 Zotero 分类失败（${r.status}）`), { status: 502, code: 'zotero-failed' });
  const rows = Array.isArray(r.json) ? r.json : [];
  return rows.map((c) => ({ key: c.key, name: c.data?.name || '', parent: c.data?.parentCollection || false }));
}

function zoteroAttachmentToRecord(item) {
  const d = item.data || {};
  return {
    key: item.key,
    title: String(d.title || d.filename || '附件'),
    contentType: String(d.contentType || ''),
    filename: String(d.filename || ''),
    linkMode: String(d.linkMode || ''),
  };
}

export async function zoteroItem(key, { fetchItem = zoteroFetch } = {}) {
  const r = await fetchItem(`/users/0/items/${encodeURIComponent(key)}`, 10000);
  if (!r.ok || !r.json) {
    throw Object.assign(new Error(`读取 Zotero 条目失败（${r.status}）`), { status: 404, code: 'zotero-not-found' });
  }
  const record = zoteroItemToRecord(r.json);
  record.children = { notes: [], annotations: [], attachments: [] };
  // 独立附件自身就是可读取文件，不会作为自己的子项出现在 /children。
  if (record.zoteroItemType === 'attachment') record.children.attachments.push(zoteroAttachmentToRecord(r.json));
  const cr = await fetchItem(`/users/0/items/${encodeURIComponent(key)}/children?limit=100`, 15000);
  if (cr.ok && Array.isArray(cr.json)) {
    for (const child of cr.json) {
      const d = child.data || {};
      if (d.itemType === 'note') {
        record.children.notes.push({
          key: child.key,
          title: htmlToText(d.note || '').split('\n')[0].slice(0, 80) || 'Zotero 笔记',
          body: htmlToText(d.note || ''),
          date: d.dateAdded || '',
        });
      } else if (d.itemType === 'annotation') {
        record.children.annotations.push({
          key: child.key,
          page: String(d.annotationPageLabel || ''),
          text: String(d.annotationText || ''),
          comment: String(d.annotationComment || ''),
          color: String(d.annotationColor || '#ffd400'),
          type: String(d.annotationType || ''),
        });
      } else if (d.itemType === 'attachment') {
        record.children.attachments.push(zoteroAttachmentToRecord(child));
      }
    }
  }
  // Zotero 本地 API 的 /children 默认不返回 PDF 批注；必须用 itemType=annotation
  // 单独查询附件子项，否则工作台会显示“0 条批注”。
  const seenAnnotations = new Set(record.children.annotations.map((a) => a.key));
  for (const att of record.children.attachments) {
    if (!att.key) continue;
    try {
      const ar = await fetchItem(
        `/users/0/items/${encodeURIComponent(att.key)}/children?itemType=annotation&limit=100`,
        15000,
      );
      if (!ar.ok || !Array.isArray(ar.json)) continue;
      for (const child of ar.json) {
        if (seenAnnotations.has(child.key)) continue;
        const d = child.data || {};
        record.children.annotations.push({
          key: child.key,
          page: String(d.annotationPageLabel || ''),
          text: String(d.annotationText || ''),
          comment: String(d.annotationComment || ''),
          color: String(d.annotationColor || '#ffd400'),
          type: String(d.annotationType || ''),
          parentAttachment: att.key,
          source: 'zotero',
        });
        seenAnnotations.add(child.key);
      }
    } catch {
      /* 单个附件批注读取失败不阻塞题录/PDF/笔记导入 */
    }
  }
  return record;
}

async function zoteroAttachmentFile(key) {
  const meta = await zoteroFetch(`/users/0/items/${encodeURIComponent(key)}`, 8000);
  const data = meta.json?.data || {};
  const contentType = String(data.contentType || '');
  if (String(data.linkMode || '') === 'linked_url') {
    if (data.url) return { kind: 'url', url: String(data.url), contentType };
  }
  const r = await fetchWithTimeout(
    `${ZOTERO_BASE}/users/0/items/${encodeURIComponent(key)}/file/view/url`,
    { headers: zoteroHeaders(), redirect: 'manual' },
    10000,
  );
  let target = '';
  if (r.status >= 300 && r.status < 400) {
    target = r.headers.get('location') || '';
  } else if (r.ok) {
    target = (await r.text()).trim();
  }
  if (!target) {
    throw Object.assign(new Error('Zotero 未返回可用的附件位置'), { status: 404, code: 'zotero-file-missing' });
  }
  if (/^file:/i.test(target)) {
    return { kind: 'file', path: fileURLToPath(target), contentType: contentType || 'application/pdf' };
  }
  if (/^https?:/i.test(target)) {
    return { kind: 'url', url: target, contentType };
  }
  return { kind: 'file', path: target, contentType: contentType || 'application/pdf' };
}

async function zoteroFulltext(key) {
  const r = await zoteroFetch(`/users/0/items/${encodeURIComponent(key)}/fulltext`, 10000);
  if (!r.ok || !r.json) {
    return { available: false, reason: r.status === 404 ? 'Zotero 未索引该附件全文' : `读取全文失败（${r.status}）` };
  }
  return {
    available: true,
    content: String(r.json.content || ''),
    indexedPages: Number(r.json.indexedPages || 0),
    totalPages: Number(r.json.totalPages || 0),
    indexedChars: Number(r.json.indexedChars || 0),
    totalChars: Number(r.json.totalChars || 0),
  };
}

/* ------------------------------------------------------------------ 数据保存 / 备份 */
function validateState(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return ['数据不是对象'];
  if (Number(data.version) !== 1) problems.push('版本号不是 1');
  for (const key of ['items', 'topics', 'notes', 'tasks', 'cases', 'searches']) {
    if (!Array.isArray(data[key])) problems.push(`缺少数组字段 ${key}`);
  }
  if (problems.length === 0) {
    const ids = new Set();
    for (const list of ['items', 'topics', 'notes', 'tasks', 'cases']) {
      for (const row of data[list]) {
        if (!row || typeof row.id !== 'string' || !row.id) problems.push(`${list} 中存在缺少 id 的记录`);
        else if (ids.has(row.id)) problems.push(`重复 id：${row.id}`);
        else ids.add(row.id);
        if (problems.length > 8) break;
      }
    }
  }
  return problems;
}

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

async function atomicWrite(file, content) {
  await ensureDirs();
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tmp, file);
  } catch (error) {
    await fsp.rm(tmp, { force: true });
    throw error;
  }
}

async function backupCurrent(label = 'auto') {
  await ensureDirs();
  try {
    await fsp.access(DATA_FILE);
  } catch {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const name = `${label}-${stamp}.json`;
  const target = path.join(BACKUP_DIR, name);
  await fsp.copyFile(DATA_FILE, target);
  await pruneBackups(30);
  return target;
}

async function pruneBackups(keep) {
  try {
    const files = (await fsp.readdir(BACKUP_DIR))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files.slice(keep)) await fsp.rm(path.join(BACKUP_DIR, f), { force: true });
  } catch {
    /* 备份清理失败不影响主流程 */
  }
}

const UPLOAD_IDENTITY_SUFFIX = '.medwb-upload.json';

function sameLocalPath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase() : path.resolve(value);
  return typeof left === 'string' && typeof right === 'string' && normalize(left) === normalize(right);
}

export function assertBridgeProjectRoot(req, pathname, { root = ROOT } = {}) {
  if (pathname === '/health' || pathname === '/status') return;
  const supplied = req.headers?.['x-medresearch-project-root'];
  const required = pathname === '/data' || pathname.startsWith('/data/') || pathname === '/files/upload';
  if (supplied === undefined && !required) return;
  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw Object.assign(new Error('本项目数据操作需要项目根目录标识'), { status: 403, code: 'project-root-required' });
  }
  let expected;
  try {
    expected = decodeURIComponent(supplied);
  } catch {
    throw Object.assign(new Error('项目根目录标识编码无效'), { status: 400, code: 'bad-project-root' });
  }
  if (!path.isAbsolute(expected) || !sameLocalPath(expected, root)) {
    throw Object.assign(new Error('本地服务属于其他工作台项目，已拒绝数据操作'), { status: 403, code: 'project-root-mismatch' });
  }
}

function insideDirectory(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function uploadFingerprint(file, root) {
  const realRoot = await fsp.realpath(root);
  const realFile = await fsp.realpath(file);
  if (!insideDirectory(path.join(realRoot, 'data', 'uploads'), realFile)) {
    throw new Error('上传文件不在本项目 data/uploads 内');
  }
  const stat = await fsp.stat(realFile);
  if (!stat.isFile()) throw new Error('上传引用不是文件');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(realFile)) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}

async function readUploadIdentity(file) {
  try {
    return JSON.parse(await fsp.readFile(file + UPLOAD_IDENTITY_SUFFIX, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function registerUploadedFile(file, { root = ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  if (!insideDirectory(path.join(resolvedRoot, 'data', 'uploads'), resolvedFile)) {
    throw new Error('只能登记本项目的上传文件');
  }
  const fingerprint = await uploadFingerprint(resolvedFile, resolvedRoot);
  const previous = await readUploadIdentity(resolvedFile);
  const preserved = previous?.sha256 === fingerprint.sha256 && previous?.bytes === fingerprint.bytes
    && Array.isArray(previous.sourcePaths) ? previous.sourcePaths : [];
  const identity = {
    version: 1,
    relativePath: path.relative(resolvedRoot, resolvedFile).split(path.sep).join('/'),
    ...fingerprint,
    sourcePaths: [...new Set([...preserved, resolvedFile])],
  };
  const sidecar = resolvedFile + UPLOAD_IDENTITY_SUFFIX;
  const tmp = `${sidecar}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(identity, null, 2), 'utf8');
    await fsp.rename(tmp, sidecar);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
  return identity;
}

export async function normalizeLocalPaths(data, { root = ROOT, warnings = [] } = {}) {
  if (!data || !Array.isArray(data.items)) return data;
  const resolvedRoot = path.resolve(root);
  const uploadDir = path.join(resolvedRoot, 'data', 'uploads');
  for (const item of data.items) {
    const filePath = typeof item?.filePath === 'string' ? item.filePath : '';
    if (!filePath) continue;
    const absolute = path.isAbsolute(filePath);
    const currentFile = path.resolve(resolvedRoot, filePath);
    // 已有相对上传与本项目内绝对上传可直接确认归属；为后续移动补记身份。
    if (insideDirectory(uploadDir, currentFile)) {
      try {
        const identity = await readUploadIdentity(currentFile);
        if (!identity) await registerUploadedFile(currentFile, { root: resolvedRoot });
        if (absolute) {
          await uploadFingerprint(currentFile, resolvedRoot);
          item.filePath = path.relative(resolvedRoot, currentFile).split(path.sep).join('/');
        }
      } catch {
        warnings.push({ itemId: item.id || '', code: 'upload-identity-unavailable', message: '无法核对本项目上传文件，已保留原路径。' });
      }
      continue;
    }
    if (!absolute) continue;
    // 同名只用于找到身份记录，不能单凭文件名或 data/uploads 后缀认领旧文件。
    const candidate = path.join(uploadDir, path.basename(filePath));
    try {
      const identity = await readUploadIdentity(candidate);
      const relativePath = path.relative(resolvedRoot, candidate).split(path.sep).join('/');
      if (!identity || identity.version !== 1 || identity.relativePath !== relativePath
        || !Array.isArray(identity.sourcePaths) || !identity.sourcePaths.some((origin) => sameLocalPath(origin, filePath))) {
        throw new Error('未找到属于该绝对路径的上传身份记录');
      }
      const fingerprint = await uploadFingerprint(candidate, resolvedRoot);
      if (fingerprint.bytes !== identity.bytes || fingerprint.sha256 !== identity.sha256) {
        throw new Error('当前文件与已登记上传文件的内容不一致');
      }
      await registerUploadedFile(candidate, { root: resolvedRoot });
      item.filePath = relativePath;
    } catch {
      warnings.push({ itemId: item.id || '', code: 'unverified-absolute-path', message: '该绝对路径没有可核对的项目上传身份，已保留原路径；文件已移动时请重新导入 PDF。' });
    }
  }
  return data;
}

async function saveState(data) {
  const pathWarnings = [];
  await normalizeLocalPaths(data, { warnings: pathWarnings });
  const problems = validateState(data);
  if (problems.length) {
    throw Object.assign(new Error(`数据格式校验失败：${problems.slice(0, 3).join('；')}`), {
      status: 400,
      code: 'bad-state',
    });
  }
  await ensureDirs();
  // 每次保存前最多每 10 分钟留一个自动备份，避免频繁写导致备份爆炸
  const last = await latestBackupMtime();
  if (!last || Date.now() - last > 10 * 60 * 1000) await backupCurrent('auto');
  const payload = JSON.stringify(data, null, 2);
  await atomicWrite(DATA_FILE, payload);
  return { ok: true, file: DATA_FILE, bytes: Buffer.byteLength(payload), at: nowIso(), pathWarnings };
}

async function latestBackupMtime() {
  try {
    const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json'));
    let latest = 0;
    for (const f of files) {
      const st = await fsp.stat(path.join(BACKUP_DIR, f));
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    }
    return latest;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ HTTP 路由 */
const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const started = Date.now();
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';
  try {
    assertBridgeProjectRoot(req, pathname);
    if (pathname === '/health' && method === 'GET') {
      const zotero = await zoteroStatus();
      sendJson(res, 200, {
        ok: true,
        service: SERVICE_ID,
        version: VERSION,
        projectRoot: ROOT,
        dataFile: DATA_FILE,
        backupDir: BACKUP_DIR,
        zotero,
        llm: { configured: LLM.configured, provider: LLM.provider, model: LLM.model || null },
        search: {
          pubmed: { source: 'NCBI E-utilities', apiKey: Boolean(NCBI_KEY), email: Boolean(NCBI_EMAIL) },
          trials: { source: 'ClinicalTrials.gov API v2' },
          drug: { source: 'MyChem.info + openFDA', openFdaKey: Boolean(OPENFDA_KEY) },
          biomcp: detectBiomcp(),
        },
        at: nowIso(),
      });
      return;
    }

    if (pathname === '/status' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        zotero: await zoteroStatus(),
        llm: { configured: LLM.configured, provider: LLM.provider, model: LLM.model || null },
        at: nowIso(),
      });
      return;
    }

    if (pathname === '/search/pubmed' && method === 'POST') {
      const body = await readJsonBody(req);
      let bioError = '';
      if (detectBiomcp().installed) {
        try {
          sendJson(res, 200, await searchBioMcpArticle(body || {}));
          return;
        } catch (error) {
          bioError = error.message;
          console.error('[biomcp] article fallback:', bioError);
        }
      }
      const result = await searchPubMed(body || {});
      if (bioError) result.fallback = { from: 'BioMCP', reason: bioError };
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/search/trials' && method === 'POST') {
      const body = await readJsonBody(req);
      let bioError = '';
      if (detectBiomcp().installed) {
        try {
          sendJson(res, 200, await searchBioMcpTrials(body || {}));
          return;
        } catch (error) {
          bioError = error.message;
          console.error('[biomcp] trials fallback:', bioError);
        }
      }
      const result = await searchTrials(body || {});
      if (bioError) result.fallback = { from: 'BioMCP', reason: bioError };
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/search/drug' && method === 'POST') {
      const body = await readJsonBody(req);
      let bioError = '';
      if (detectBiomcp().installed) {
        try {
          sendJson(res, 200, await searchBioMcpDrug(body || {}));
          return;
        } catch (error) {
          bioError = error.message;
          console.error('[biomcp] drug fallback:', bioError);
        }
      }
      const result = await searchDrug(body || {});
      if (bioError) result.fallback = { from: 'BioMCP', reason: bioError };
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/ai/ask' && method === 'POST') {
      const body = await readJsonBody(req);
      const result = await askModel(body || {});
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/zotero/status' && method === 'GET') {
      sendJson(res, 200, await zoteroStatus());
      return;
    }

    if (pathname === '/zotero/collections' && method === 'GET') {
      sendJson(res, 200, { items: await zoteroCollections(), at: nowIso() });
      return;
    }

    if (pathname === '/zotero/search' && method === 'GET') {
      const result = await zoteroSearch(Object.fromEntries(url.searchParams.entries()));
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/zotero/item' && method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!key) throw Object.assign(new Error('缺少 key'), { status: 400, code: 'bad-request' });
      sendJson(res, 200, { item: await zoteroItem(key), at: nowIso() });
      return;
    }

    if (pathname === '/zotero/fulltext' && method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!key) throw Object.assign(new Error('缺少 key'), { status: 400, code: 'bad-request' });
      sendJson(res, 200, await zoteroFulltext(key));
      return;
    }

    if (pathname === '/zotero/file' && method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!key) throw Object.assign(new Error('缺少 key'), { status: 400, code: 'bad-request' });
      const located = await zoteroAttachmentFile(key);
      if (located.kind === 'url') {
        res.writeHead(302, { location: located.url });
        res.end();
        return;
      }
      const stat = await fsp.stat(located.path);
      res.writeHead(200, {
        'content-type': located.contentType || 'application/pdf',
        'content-length': stat.size,
        'content-disposition': 'inline',
        'cache-control': 'no-store',
      });
      fs.createReadStream(located.path).pipe(res);
      return;
    }

    if (pathname === '/files/upload' && method === 'POST') {
      const body = await readJsonBody(req, 90 * 1024 * 1024);
      const name = String(body.name || 'paper.pdf').replace(/[\\/:*?"<>|]/g, '_').slice(-120);
      const mime = String(body.mime || 'application/octet-stream');
      const base64 = String(body.base64 || '');
      if (!base64) throw Object.assign(new Error('缺少文件内容'), { status: 400, code: 'bad-request' });
      const buf = Buffer.from(base64, 'base64');
      if (buf.length > 60 * 1024 * 1024) throw Object.assign(new Error('文件超过 60 MB'), { status: 413, code: 'too-large' });
      const uploadDir = path.join(DATA_DIR, 'uploads');
      await fsp.mkdir(uploadDir, { recursive: true });
      const ext = path.extname(name) || '.pdf';
      const safeBase = path.basename(name, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 60) || 'paper';
      const target = path.join(uploadDir, `${Date.now().toString(36)}-${safeBase}${ext}`);
      await fsp.writeFile(target, buf);
      await registerUploadedFile(target);
      // 返回相对项目根目录的稳定引用；移动安装目录后仍可解析，不写死本机绝对路径。
      const stablePath = path.relative(ROOT, target).split(path.sep).join('/');
      sendJson(res, 200, { ok: true, path: stablePath, absolutePath: target, bytes: buf.length, mime, at: nowIso() });
      return;
    }

    if (pathname === '/data/load' && method === 'GET') {
      try {
        const text = await fsp.readFile(DATA_FILE, 'utf8');
        const pathWarnings = [];
        const data = await normalizeLocalPaths(JSON.parse(text.replace(/^\uFEFF/, '')), { warnings: pathWarnings });
        const stat = await fsp.stat(DATA_FILE);
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-data-mtime': String(stat.mtimeMs),
        });
        res.end(JSON.stringify({ ...data, pathWarnings }));
      } catch (error) {
        if (error.code === 'ENOENT') sendJson(res, 404, { error: { code: 'not-found', message: '尚无本机数据文件' } });
        else sendJson(res, 500, { error: { code: 'bad-file', message: `读取失败：${error.message}` } });
      }
      return;
    }

    if (pathname === '/data/save' && method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 200, await saveState(body.data));
      return;
    }

    if (pathname === '/data/backup' && method === 'POST') {
      const body = await readJsonBody(req);
      const file = await backupCurrent(String(body.label || 'manual').replace(/[^a-z0-9_-]/gi, '') || 'manual');
      if (!file) {
        sendJson(res, 404, { error: { code: 'not-found', message: '尚无数据文件可备份' } });
        return;
      }
      sendJson(res, 200, { ok: true, file, at: nowIso() });
      return;
    }

    if (pathname === '/data/backups' && method === 'GET') {
      await ensureDirs();
      const files = [];
      for (const name of (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort().reverse()) {
        const st = await fsp.stat(path.join(BACKUP_DIR, name));
        files.push({ name, bytes: st.size, mtime: st.mtimeMs });
      }
      sendJson(res, 200, { dir: BACKUP_DIR, files });
      return;
    }

    if (pathname === '/data/restore' && method === 'POST') {
      const body = await readJsonBody(req);
      if (body.confirm !== true) {
        throw Object.assign(new Error('恢复需要确认'), { status: 400, code: 'confirm-required' });
      }
      const problems = validateState(body.data);
      if (problems.length) {
        sendJson(res, 400, { error: { code: 'bad-state', message: problems.slice(0, 3).join('；') } });
        return;
      }
      const backup = await backupCurrent('pre-restore');
      const result = await saveState(body.data);
      sendJson(res, 200, { ...result, backup });
      return;
    }

    sendJson(res, 404, { error: { code: 'not-found', message: `未知路由 ${method} ${pathname}` } });
  } catch (error) {
    const status = Number(error.status) || (error.code === 'ENOENT' ? 404 : 500);
    const code = error.code || 'internal';
    if (!res.headersSent) sendError(res, status, code, error.message || '服务内部错误');
    else res.end();
  } finally {
    if (process.env.MEDWB_LOG !== '0') {
      console.log(`[${new Date().toISOString()}] ${method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
});

export function detectBiomcp({ candidates, exists = fs.existsSync, exec = execFileSync } = {}) {
  const locations = candidates || [
    process.env.BIOMCP_BIN,
    path.join(ROOT, 'tools', process.platform === 'win32' ? 'biomcp.exe' : 'biomcp'),
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'biomcp.exe'),
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'biomcp'),
  ];
  const failures = [];
  for (const file of [...new Set(locations.filter(Boolean))]) {
    try {
      if (!exists(file)) continue;
      const output = String(exec(file, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })).trim();
      const version = /^biomcp\s+(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?)$/i.exec(output);
      if (!version) {
        failures.push({ path: file, reason: 'invalid-version' });
        continue;
      }
      return { found: true, installed: true, path: file, mode: 'binary', version: version[1] };
    } catch (error) {
      failures.push({ path: file, reason: 'execution-failed', code: String(error.code || 'unknown') });
    }
  }
  if (failures.length) {
    return {
      found: true,
      installed: false,
      mode: 'upstream',
      path: failures[0].path,
      reason: failures.some((failure) => failure.reason === 'execution-failed') ? 'execution-failed' : 'invalid-version',
      failures,
      note: '已找到 BioMCP 文件，但启动或版本检测未通过。可能是运行库缺失（如 Microsoft VC++ x64）、文件不兼容或访问受限；请核对具体运行错误。当前使用公开上游直连，不是 BioMCP。',
    };
  }
  return {
    found: false,
    installed: false,
    mode: 'upstream',
    reason: 'not-found',
    note: '未找到 BioMCP 二进制；当前使用 PubMed / ClinicalTrials.gov / MyChem.info / openFDA 公开上游直连，不是 BioMCP。',
  };
}

function biomcpRun(args, timeout = 45000) {
  const state = detectBiomcp();
  if (!state.installed) {
    throw Object.assign(new Error('未安装 BioMCP 二进制'), { status: 503, code: 'biomcp-unavailable' });
  }
  return new Promise((resolve, reject) => {
    execFile(
      state.path,
      [...args, '--json', '--no-cache'],
      { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`BioMCP 调用失败：${String(stderr || error.message).slice(0, 300)}`));
          return;
        }
        try {
          resolve({ json: JSON.parse(stdout), version: state.version, path: state.path });
        } catch {
          reject(new Error('BioMCP 返回无法解析为 JSON'));
        }
      },
    );
  });
}

async function searchBioMcpArticle({ query, mindate, maxdate, limit, sort }) {
  const term = String(query || '').trim();
  if (!term) throw Object.assign(new Error('请输入检索词'), { status: 400, code: 'bad-request' });
  const n = clampInt(limit, 1, 30, 10);
  const args = ['search', 'article', '-k', term, '--limit', String(n), '--full'];
  if (mindate) args.push('--date-from', String(mindate));
  if (maxdate) args.push('--date-to', String(maxdate));
  if (sort === 'date') args.push('--sort', 'date');
  const { json, version } = await biomcpRun(args);
  const raw = Array.isArray(json.results) ? json.results : [];
  const sources = [...new Set(raw.map((r) => r.source).filter(Boolean))];
  const items = raw.map((r) => {
    const pmid = String(r.pmid || '');
    const doi = String(r.doi || '');
    const year = String(r.date || '').slice(0, 4);
    return {
      pmid,
      title: r.title || '(未取到标题)',
      authors: Array.isArray(r.authors) ? r.authors : [],
      journal: r.journal || '',
      year,
      date: r.date || '',
      abstract: r.abstract || r.abstract_snippet || '',
      doi,
      pmc: r.pmcid || '',
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : doi ? `https://doi.org/${doi}` : '',
      rawSource: r.source || '',
    };
  });
  return {
    source: `BioMCP ${version} · ${sources.join(' / ') || 'PubMed/EuropePMC'}`.replace(/\s+/g, ' ').trim(),
    query: term,
    queryLabel: term,
    total: Number(json.pagination?.total ?? json.count ?? items.length) || items.length,
    items,
    at: nowIso(),
    via: 'biomcp',
    complete: json.complete !== false,
    note: json.complete === false ? 'BioMCP 标记为部分结果（部分上游源未返回），不代表完整覆盖。' : '',
  };
}

async function searchBioMcpTrials({ condition, intervention, phase, status, limit, query }) {
  const cond = firstNonEmpty(condition, query);
  if (!cond) throw Object.assign(new Error('请输入疾病或适应症'), { status: 400, code: 'bad-request' });
  const n = clampInt(limit, 1, 30, 10);
  const args = ['search', 'trial', '-c', cond, '--limit', String(n)];
  if (intervention) args.push('-i', String(intervention));
  if (phase) args.push('--phase', String(phase));
  if (status) args.push('--status', String(status).toLowerCase());
  const { json, version } = await biomcpRun(args);
  const raw = Array.isArray(json.results) ? json.results : [];
  const detailLimit = Math.min(3, raw.length);
  const details = await Promise.all(
    raw.slice(0, detailLimit).map((r) =>
      biomcpRun(['get', 'trial', String(r.nct_id || '')], 30000)
        .then((x) => x.json)
        .catch(() => null),
    ),
  );
  const items = raw.map((r, index) => {
    const d = details[index] || {};
    const interventions = [];
    const label = r.matched_intervention_label;
    if (label) interventions.push(label);
    for (const x of d.interventions || []) {
      const name = typeof x === 'string' ? x : x?.name;
      if (name && !interventions.includes(name)) interventions.push(name);
    }
    return {
      nctId: r.nct_id || '',
      title: r.title || '(未取到标题)',
      status: r.status || d.status || '',
      statusLabel: trialStatusLabel(r.status || d.status || ''),
      phase: r.phase || d.phase || '',
      sponsor: r.sponsor || d.sponsor || '',
      startDate: d.start_date || '',
      lastUpdate: '',
      conditions: Array.isArray(r.conditions) ? r.conditions : Array.isArray(d.conditions) ? d.conditions : [],
      interventions,
      summary: d.summary || '',
      enrollment: d.enrollment || '',
      url: `https://clinicaltrials.gov/study/${r.nct_id || ''}`,
      rawSource: 'ClinicalTrials.gov',
    };
  });
  return {
    source: `BioMCP ${version} · ClinicalTrials.gov`,
    query: { condition: cond, intervention: intervention || '', phase: phase || '', status: status || '' },
    queryLabel: [cond, intervention].filter(Boolean).join(' / ') + (phase || status ? ` · ${[phase, status].filter(Boolean).join(' / ')}` : ''),
    total: Number(json.pagination?.total ?? json.count ?? items.length) || items.length,
    items,
    at: nowIso(),
    via: 'biomcp',
    note: '更新时间字段 BioMCP 搜索/详情未返回时留空，不伪造；可点击试验页面核对。',
  };
}

async function searchBioMcpDrug({ query }) {
  const name = String(query || '').trim();
  if (!name) throw Object.assign(new Error('请输入药物名称'), { status: 400, code: 'bad-request' });
  // label 子命令只取说明书，通常 3 秒左右；完整 get drug 会并发多个监管源，容易超时。
  const { json, version } = await biomcpRun(['get', 'drug', name, 'label']);
  const sections = [];
  const push = (key, heading, text) => {
    const value = String(text || '').trim();
    if (value) sections.push({ key, heading, text: value.slice(0, 1600) });
  };
  const lab = json.label || {};
  const labelDefs = [
    ['boxed_warning', '黑框警告'],
    ['indications', '适应症'],
    ['dosage_and_administration', '用法用量'],
    ['contraindications', '禁忌'],
    ['warnings', '警告与注意事项'],
    ['adverse_reactions', '不良反应'],
    ['drug_interactions', '药物相互作用'],
  ];
  for (const [key, heading] of labelDefs) push(key, heading, lab[key]);
  push('mechanisms', '作用机制', (json.mechanisms || []).join('；'));
  push('targets', '靶点', (json.targets || []).slice(0, 16).join(', '));
  push('adverse', '常见不良事件（FAERS）', (json.top_adverse_events || []).join('；'));
  push('approval', 'FDA 批准', json.approval_summary || '');
  push('pharm_class', '药理分类', (json.pharm_classes || []).join('；'));
  const identifiers = [
    ['DrugBank', json.drugbank_id],
    ['ChEMBL', json.chembl_id],
    ['UNII', json.unii],
  ].filter(([, v]) => v);
  const links = (json._meta?.evidence_urls || [])
    .filter((x) => x && x.label && x.url)
    .map((x) => [x.label, x.url]);
  return {
    source: `BioMCP ${version} · MyChem/DrugBank/ChEMBL/OpenFDA`,
    query: name,
    names: [...new Set([json.name, ...(json.brand_names || [])].filter(Boolean))].slice(0, 8),
    identifiers,
    drugClass: [json.drug_type, json.route].filter(Boolean).join(' · '),
    label: {
      region: '美国',
      agency: `BioMCP ${version} · DailyMed/openFDA 说明书`,
      effectiveTime: lab.effective_time || json.approval_date || '',
      brandNames: json.brand_names || [],
      genericNames: [json.name].filter(Boolean),
      manufacturer: [],
      sections,
    },
    warnings: [],
    links,
    coverageNote:
      '由本地 BioMCP 真实调用 DrugBank/ChEMBL/MyChem/OpenFDA 汇总；并非完整说明书，区域、适应症与更新日期以原始链接为准。',
    at: nowIso(),
    via: 'biomcp',
  };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  医学研究工作台 · 本地桥接服务');
    console.log(`  地址      http://127.0.0.1:${PORT}`);
    console.log(`  项目目录  ${ROOT}`);
    console.log(`  数据文件  ${DATA_FILE}`);
    console.log(`  Zotero    ${ZOTERO_BASE}`);
    console.log(`  模型问答  ${LLM.configured ? LLM.provider + ' / ' + LLM.model : '未配置（可选）'}`);
    console.log('');
    console.log('  保持此窗口打开；关闭窗口即停止服务。按 Ctrl+C 退出。');
    console.log('');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log('\n  正在停止本地桥接服务…');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500);
    });
  }
}
