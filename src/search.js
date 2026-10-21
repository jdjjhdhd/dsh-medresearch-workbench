  /* ================================================================
     医学数据检索
     ================================================================ */
  function biomcpInfo() {
    var h = APP.bridge.health;
    return APP.bridge.online && h && h.search && h.search.biomcp && h.search.biomcp.installed ? h.search.biomcp : null;
  }
  function renderSearch() {
    var tab = APP.ui.search.tab;
    var bm = biomcpInfo();
    var html = '<div class="page">' + demoBanner();
    html += pageHead('医学数据检索', '三个入口分别对应 BioMCP 的文献、临床试验与药物资料。结果保留查询词、来源与查询时间；加入资料库后可继续阅读、批注与建任务。',
      '<button class="btn" data-act="settings" data-tab="conn">连接与来源</button>');
    html += '<div class="tabs searchTabs">' +
      [['lit', '医学文献'], ['trials', '临床试验'], ['drug', '药物资料']].map(function (x) {
        return '<button class="tab ' + (tab === x[0] ? 'tabOn' : '') + '" data-act="searchTab" data-tab="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
    var bioState = APP.bridge.health && APP.bridge.health.search && APP.bridge.health.search.biomcp;
    html += '<div class="banner ' + (bm ? 'bannerOk' : 'bannerWarn') + '"><div class="grow"><b>' +
      (bm ? '经本地 BioMCP ' + esc(bm.version || '') + ' 检索' : APP.bridge.online ? '经本地服务检索' : '直连公开上游检索') + '</b>：' +
      (bm
        ? '真实调用 BioMCP CLI；文献/试验/药物分别使用其 article、trial、drug label 通道，失败时回退同源上游并在结果中标注。'
        : APP.bridge.online
          ? esc((bioState && bioState.note) || 'BioMCP 未就绪。') + ' 当前使用 PubMed / ClinicalTrials.gov / MyChem.info / openFDA 备用检索；点击「状态」查看程序检测原因。'
          : '页面直接请求 PubMed、ClinicalTrials.gov、MyChem.info 与 openFDA（无密钥、公共额度）。') +
      '</div><button class="btn btnMini" data-act="settings" data-tab="conn">状态</button></div>';
    html += '<div class="searchPanel">' + searchFormHtml(tab) + searchResultsHtml(tab) + '</div>';
    html += '</div>';
    return html;
  }
  function searchHistoryHtml(type) {
    var historyType = { lit: 'literature', trials: 'trial', drug: 'drug' }[type] || type;
    var rows = APP.data.searches.filter(function (s) { return s.type === historyType || s.type === type; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 8);
    if (!rows.length) return '<div class="muted">还没有检索记录。支持无结果、断网与额度限制时保留失败上下文。</div>';
    return rows.map(function (s) {
      return '<div class="historyRow"><button class="linkBtn" data-act="searchHistory" data-type="' + type + '" data-query="' + esc(s.query) + '">' + esc(truncate(s.query || '（空查询）', 28)) + '</button><span>' + s.count + ' 条 · ' + esc(relTime(s.at)) + '</span></div>';
    }).join('');
  }
  function searchFormHtml(tab) {
    var f = APP.ui.search;
    var bm = biomcpInfo();
    var body = '';
    if (tab === 'lit') {
      body = '<div class="field"><label>检索词（疾病、药物、关键词或 PubMed 语法）</label><textarea class="textarea" name="q" rows="3" placeholder="例如：metformin AND cardiovascular outcomes，或 SGLT2 inhibitor heart failure">' + esc(f.q) + '</textarea><span class="hint">' + (bm ? '由 BioMCP ' + esc(bm.version || '') + ' 联邦检索（PubMed/EuropePMC/PubTator 等）；结果保留实际来源与 PMID。' : '由 PubMed E-utilities 执行；保留原始 PMID 与摘要。') + '</span></div>' +
        '<div class="formGrid"><div class="field"><label>起始年份</label><input class="input" name="yearFrom" placeholder="2015" value="' + esc(f.yearFrom) + '" /></div><div class="field"><label>截止年份</label><input class="input" name="yearTo" placeholder="2026" value="' + esc(f.yearTo) + '" /></div></div>' +
        '<div class="formGrid"><div class="field"><label>排序</label><select class="select" name="sort"><option value="relevance">相关性</option><option value="date">最新</option></select></div><div class="field"><label>返回条数</label><select class="select" name="limit"><option>5</option><option selected>10</option><option>20</option></select></div></div>';
    } else if (tab === 'trials') {
      body = '<div class="field"><label>疾病 / 适应症</label><input class="input" name="condition" placeholder="例如：melanoma、type 2 diabetes" value="' + esc(f.condition) + '" /></div>' +
        '<div class="field"><label>干预 / 药物（可选）</label><input class="input" name="intervention" placeholder="例如：pembrolizumab" value="' + esc(f.intervention) + '" /></div>' +
        '<div class="formGrid"><div class="field"><label>阶段</label><select class="select" name="phase"><option value="">全部</option><option value="PHASE1">I 期</option><option value="PHASE2">II 期</option><option value="PHASE3">III 期</option><option value="PHASE4">IV 期</option></select></div>' +
        '<div class="field"><label>招募状态</label><select class="select" name="trialStatus"><option value="">全部</option><option value="RECRUITING">招募中</option><option value="ACTIVE_NOT_RECRUITING">进行中（不招募）</option><option value="COMPLETED">已完成</option><option value="NOT_YET_RECRUITING">尚未招募</option></select></div></div>' +
        '<div class="formGrid"><div class="field"><label>返回条数</label><select class="select" name="limit"><option>5</option><option selected>10</option><option>20</option></select></div><div class="field"><label>来源</label><div class="muted" style="padding:7px 0">' + (bm ? 'BioMCP · ClinicalTrials.gov' : 'ClinicalTrials.gov API v2') + '</div></div></div>';
    } else {
      body = '<div class="field"><label>药物名称（通用名或商品名）</label><input class="input" name="query" placeholder="例如：metformin、semaglutide、pembrolizumab" value="' + esc(f.drug) + '" /><span class="hint">' + (bm ? 'BioMCP 药物 label 通道：DailyMed/openFDA 说明书 + DrugBank/ChEMBL 标识；显示地区与原始链接。' : '化学标识来自 MyChem.info；说明书摘要来自 openFDA（美国 FDA）。') + '</span></div>' +
        '<div class="banner"><div class="grow">不承诺覆盖所有药物或中国 NMPA 说明书。结果会标明地区、来源与更新时间；临床使用前请核对现行说明书。</div></div>';
    }
    return '<div class="card searchForm"><div class="cardHead"><h3>' + (tab === 'lit' ? '文献检索' : tab === 'trials' ? '临床试验检索' : '药物资料查询') + '</h3><span class="chip">' + (bm ? 'BioMCP ' + esc(bm.version || '') : tab === 'lit' ? 'PubMed' : tab === 'trials' ? 'CT.gov v2' : 'MyChem + openFDA') + '</span></div>' +
      '<div class="searchFormFields" data-searchform="' + tab + '">' + body + '</div>' +
      '<div class="flex" style="margin-top:10px"><button class="btn btnPrimary" data-act="runSearch" id="runSearchBtn">' + (tab === 'drug' ? '查询药物' : '开始检索') + '</button><span class="muted">' + (APP.bridge.online ? '经本地服务' : '页面直连') + '</span></div>' +
      '<div class="divider"></div><div class="cardHead"><h3>最近检索</h3></div><div>' + searchHistoryHtml(tab) + '</div>' +
      '</div>';
  }
  function searchResultMetaHtml() {
    var m = APP.search.meta[APP.ui.search.tab];
    if (!m) return '';
    var notes = [];
    if (m.fallback) notes.push('BioMCP 本次调用未成功，已使用备用来源：' + (m.fallback.reason || '未返回原因'));
    if (m.complete === false) notes.push('本次仅返回部分来源的结果，不代表完整覆盖。');
    if (m.note) notes.push(m.note);
    if (/[^\u0000-\u007f]/.test(m.query || '') && /[\u3400-\u9fff]/.test(m.query || '')) notes.push('若结果偏少，可尝试英文医学术语或规范检索式；例如 hypertension（高血压）。未自动翻译或改写原查询。');
    return '<div class="sourceNote">来源：' + esc(m.source || '—') + ' · 查询时间：' + esc(fmtDateTime(m.at)) + ' · 查询：' + esc(truncate(m.query || '', 120)) + (m.returnedCount != null ? ' · 返回 ' + m.returnedCount + ' 条' : '') + '</div>' +
      (notes.length ? '<div class="banner bannerWarn mt8"><div class="grow">' + notes.filter(function (x, i, all) { return all.indexOf(x) === i; }).map(esc).join('<br>') + '</div></div>' : '');
  }
  function searchResultsHtml(tab) {
    var html = '<div class="resultList" id="searchResults">';
    if (APP.search.loading) {
      html += '<div class="card"><div class="loadingRow"><span class="spin"></span>正在检索 ' + (biomcpInfo() ? 'BioMCP' : tab === 'lit' ? 'PubMed' : tab === 'trials' ? 'ClinicalTrials.gov' : '药物资料') + '…</div></div>';
    } else if (APP.search.error) {
      html += '<div class="banner bannerBad"><div class="grow"><b>检索失败</b><br>' + esc(APP.search.error) + '<br><span class="muted">已保留查询条件，可直接重试；断网、额度限制或上游维护都会在这里显示。</span></div><button class="btn btnMini" data-act="runSearch">重试</button></div>';
    } else {
      var rows = APP.search.results[tab];
      if (!rows) {
        html += '<div class="card"><div class="empty">输入条件后开始检索。' + (tab === 'lit' ? '可先试试「metformin cardiovascular outcomes」。' : tab === 'trials' ? '可先试试疾病 melanoma、干预 pembrolizumab。' : '可先试试 metformin。') + '</div></div>';
      } else if (!rows.length) {
        html += '<div class="card"><div class="empty">没有检索到结果。请尝试更宽泛的疾病名、药物通用名，或减少筛选条件。</div>' + searchResultMetaHtml() + '</div>';
      } else {
        html += rows.map(function (row, idx) { return searchCardHtml(tab, row, idx); }).join('');
        html += '<div class="card">' + searchResultMetaHtml() + '</div>';
      }
    }
    html += '</div>';
    return html;
  }
  function searchCardHtml(tab, row, idx) {
    if (tab === 'lit') {
      return '<div class="resultCard"><div class="resultTitle"><a href="' + esc(row.url || '#') + '" target="_blank" rel="noreferrer">' + esc(row.title) + '</a></div>' +
        '<div class="resultMeta">' + (row.pmid ? '<span class="chip chipKey mono">PMID ' + esc(row.pmid) + '</span>' : '') + (row.doi ? '<span class="chip chipKey mono">DOI ' + esc(row.doi) + '</span>' : '') + (row.pmc ? '<span class="chip chipTeal mono">' + esc(row.pmc) + '</span>' : '') + '<span>' + esc(row.journal || '') + '</span><span>' + esc(row.date || row.year || '') + '</span></div>' +
        '<div class="resultMeta">' + esc((row.authors || []).slice(0, 6).join(', ') || '作者未提供') + '</div>' +
        '<p class="resultAbs">' + esc(row.abstract || '（该条未返回摘要；仍可加入资料库并打开来源链接）') + '</p>' +
        '<div class="resultActions"><button class="btnMini" data-act="addSearchResult" data-kind="lit" data-index="' + idx + '">加入资料库</button><button class="btnMini" data-act="starSearchResult" data-kind="lit" data-index="' + idx + '">★ 收藏</button><button class="btnMini" data-act="searchResultTopic" data-kind="lit" data-index="' + idx + '">加入专题</button><button class="btnMini" data-act="searchResultTask" data-kind="lit" data-index="' + idx + '">建关注任务</button><button class="btnMini" data-act="openExternal" data-url="' + esc(row.url || '') + '">原文链接</button></div></div>';
    }
    if (tab === 'trials') {
      return '<div class="resultCard"><div class="resultTitle"><a href="' + esc(row.url || '#') + '" target="_blank" rel="noreferrer">' + esc(row.title) + '</a></div>' +
        '<div class="resultMeta"><span class="chip chipKey mono">' + esc(row.nctId) + '</span><span class="chip">' + esc(row.statusLabel || row.status) + '</span>' + (row.phase ? '<span class="chip">' + esc(row.phase) + '</span>' : '') + '<span>' + esc(row.sponsor || '') + '</span></div>' +
        '<div class="resultMeta"><span>开始 ' + esc(row.startDate || '—') + '</span><span>更新 ' + esc(row.lastUpdate || '—') + '</span>' + (row.enrollment ? '<span>入组 ' + esc(row.enrollment) + '</span>' : '') + '<span>' + esc((row.conditions || []).slice(0, 3).join(' / ')) + '</span></div>' +
        '<div class="resultMeta">' + esc((row.interventions || []).slice(0, 4).join('；') || '干预未返回') + '</div>' +
        '<p class="resultAbs">' + esc(row.summary || '（未返回简介）') + '</p>' +
        '<div class="resultActions"><button class="btnMini" data-act="addSearchResult" data-kind="trial" data-index="' + idx + '">加入资料库</button><button class="btnMini" data-act="starSearchResult" data-kind="trial" data-index="' + idx + '">★ 收藏</button><button class="btnMini" data-act="searchResultTopic" data-kind="trial" data-index="' + idx + '">加入专题</button><button class="btnMini" data-act="searchResultTask" data-kind="trial" data-index="' + idx + '">关注任务</button><button class="btnMini" data-act="openExternal" data-url="' + esc(row.url || '') + '">试验页面</button></div></div>';
    }
    var ids = (row.identifiers || []).map(function (x) { return '<span class="chip mono">' + esc(x[0]) + ' ' + esc(x[1]) + '</span>'; }).join('');
    var sections = row.label && row.label.sections ? row.label.sections.slice(0, 6).map(function (s) {
      return '<div style="margin-top:6px"><div class="chip chipAccent">' + esc(s.heading) + '</div><div class="sub" style="margin-top:3px;white-space:pre-wrap">' + esc(truncate(s.text, 420)) + '</div></div>';
    }).join('') : '<div class="muted">没有取到说明书正文；可能是该药未在美国 FDA 数据库中，或上游限速。</div>';
    return '<div class="resultCard"><div class="resultTitle">' + esc((row.names && row.names[0]) || row.query || '药物资料') + '</div>' +
      '<div class="resultMeta">' + ids + (row.drugClass ? '<span class="chip">' + esc(row.drugClass) + '</span>' : '') + '</div>' +
      '<div class="resultMeta">' + (row.label ? '<span class="chip chipTeal">' + esc(row.label.agency) + '</span><span>说明书更新 ' + esc(row.label.effectiveTime || '—') + '</span>' : '<span class="chip chipWarn">未取到说明书</span>') + '</div>' +
      '<div class="resultMeta">' + (row.label && row.label.genericNames && row.label.genericNames.length ? '<span>通用名：' + esc(row.label.genericNames.join(' / ')) + '</span>' : '') + (row.label && row.label.manufacturer && row.label.manufacturer.length ? '<span>厂商：' + esc(row.label.manufacturer.join(' / ')) + '</span>' : '') + '</div>' +
      sections +
      (row.warnings && row.warnings.length ? '<div class="banner bannerWarn mt8"><div class="grow">' + row.warnings.map(esc).join('<br>') + '</div></div>' : '') +
      '<div class="banner mt8"><div class="grow">' + esc(row.coverageNote || '') + '</div></div>' +
      '<div class="resultActions"><button class="btnMini" data-act="addSearchResult" data-kind="drug" data-index="' + idx + '">加入资料库</button><button class="btnMini" data-act="starSearchResult" data-kind="drug" data-index="' + idx + '">★ 收藏</button><button class="btnMini" data-act="searchResultTopic" data-kind="drug" data-index="' + idx + '">加入专题</button><button class="btnMini" data-act="searchResultTask" data-kind="drug" data-index="' + idx + '">关注任务</button>' +
      (row.links || []).slice(0, 3).map(function (l) { return '<button class="btnMini" data-act="openExternal" data-url="' + esc(l[1]) + '">' + esc(l[0]) + '</button>'; }).join('') + '</div></div>';
  }
  function setSearchTab(tab) {
    APP.ui.search.tab = tab;
    APP.search.error = '';
    render();
  }

  /* ---------------- 检索执行 ---------------- */
  function readSearchForm(tab) {
    var host = document.querySelector('[data-searchform="' + tab + '"]');
    if (!host) return {};
    var out = {};
    host.querySelectorAll('input,textarea,select').forEach(function (el) {
      if (!el.name) return;
      out[el.name] = el.value;
    });
    return out;
  }
  async function runSearch() {
    var tab = APP.ui.search.tab;
    var form = readSearchForm(tab);
    if (tab === 'lit') {
      APP.ui.search.q = str(form.q);
      APP.ui.search.yearFrom = str(form.yearFrom);
      APP.ui.search.yearTo = str(form.yearTo);
      if (!APP.ui.search.q) { toast('请输入检索词'); return; }
    } else if (tab === 'trials') {
      APP.ui.search.condition = str(form.condition);
      APP.ui.search.intervention = str(form.intervention);
      if (!APP.ui.search.condition) { toast('请输入疾病或适应症'); return; }
    } else {
      APP.ui.search.drug = str(form.query);
      if (!APP.ui.search.drug) { toast('请输入药物名称'); return; }
    }
    APP.search.loading = true;
    APP.search.error = '';
    render();
    try {
      var result;
      if (APP.bridge.online) {
        result = await runSearchViaBridge(tab, form);
      } else {
        result = await runSearchDirect(tab, form);
      }
      var label = result.queryLabel || (typeof result.query === 'string' ? result.query : '');
      APP.search.results[tab] = result.items;
      APP.search.meta[tab] = {
        source: result.source,
        at: Date.now(),
        query: label,
        total: result.total,
        returnedCount: result.items.length,
        fallback: result.fallback || null,
        complete: result.complete,
        note: result.note || ''
      };
      recordSearch(tab, label, result.params || form, result.items.length, result.source);
      APP.search.loading = false;
      render();
    } catch (err) {
      APP.search.loading = false;
      var msg = apiErrorMessage(err);
      if (/Failed to fetch|NetworkError|Load failed|network error/i.test(msg)) {
        msg = '无法连接本地服务或网络不可达。请启动本地服务、检查网络后重试；已保留本次查询条件。';
      }
      APP.search.error = msg;
      render();
    }
  }
  async function runSearchViaBridge(tab, form) {
    var url = tab === 'lit' ? '/search/pubmed' : tab === 'trials' ? '/search/trials' : '/search/drug';
    var payload = {};
    if (tab === 'lit') {
      payload = { query: APP.ui.search.q, mindate: form.yearFrom, maxdate: form.yearTo, limit: form.limit, sort: form.sort };
    } else if (tab === 'trials') {
      payload = { condition: form.condition, intervention: form.intervention, phase: form.phase, status: form.trialStatus, limit: form.limit };
    } else {
      payload = { query: APP.ui.search.drug };
    }
    var r = await fetchJsonNice(APP.bridge.url + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }, 60000);
    if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('检索失败 HTTP ' + r.status));
    var j = r.json;
    if (tab === 'drug') {
      j.items = [j];
      j.queryLabel = j.query;
    }
    return j;
  }
  async function runSearchDirect(tab, form) {
    if (tab === 'lit') return directPubMed(form);
    if (tab === 'trials') return directTrials(form);
    return directDrug(form.query || APP.ui.search.drug);
  }
  function recordSearch(type, query, params, count, source) {
    var typeMap = { lit: 'literature', trials: 'trial', drug: 'drug' };
    APP.data.searches.unshift({
      id: uid('sh'),
      type: typeMap[type] || 'literature',
      query: query,
      params: params || {},
      count: count,
      source: source,
      at: Date.now()
    });
    APP.data.searches = APP.data.searches.slice(0, 80);
    markDirty();
  }
  function applySearchHistory(query) {
    var tab = APP.ui.search.tab;
    if (tab === 'lit') APP.ui.search.q = query;
    else if (tab === 'trials') APP.ui.search.condition = query;
    else APP.ui.search.drug = query;
    render();
    setTimeout(function () { runSearch(); }, 30);
  }

  /* ---------------- 直连上游（无桥接时的兜底） ---------------- */
  async function directFetch(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 30000);
    try {
      var r = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      var text = await r.text();
      if (r.status === 429) throw new Error('上游限速（429），请稍后重试');
      if (!r.ok) throw new Error('上游返回 HTTP ' + r.status);
      return text;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('请求超时（可能是网络不可达）');
      if (/Failed to fetch|Load failed/i.test(err.message)) throw new Error('网络请求失败：可能是断网或浏览器拦截了跨域请求');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  function xmlText(el) {
    return el ? str(el.textContent).replace(/\s+/g, ' ') : '';
  }
  async function directPubMed(form) {
    var term = APP.ui.search.q;
    var parts = ['(' + term + ')'];
    if (form.yearFrom || form.yearTo) {
      parts.push('("' + (form.yearFrom || '1900') + '"[Date - Publication] : "' + (form.yearTo || '3000') + '"[Date - Publication])');
    }
    var retmax = clamp(parseInt(form.limit, 10) || 10, 1, 30);
    var searchParams = new URLSearchParams({
      db: 'pubmed',
      term: parts.join(' AND '),
      retmode: 'json',
      retmax: String(retmax),
      sort: form.sort === 'date' ? 'pub_date' : 'relevance',
      tool: 'dsh-medresearch-workbench-page'
    });
    var searchText = await directFetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?' + searchParams.toString(), {}, 25000);
    var searchJson = safeJsonParse(searchText);
    if (!searchJson || !searchJson.esearchresult) throw new Error('PubMed 返回无法解析');
    var ids = searchJson.esearchresult.idlist || [];
    var total = Number(searchJson.esearchresult.count || 0);
    if (!ids.length) return { source: 'PubMed（页面直连）', query: term, queryLabel: term, total: 0, items: [] };
    var fetchParams = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'xml', tool: 'dsh-medresearch-workbench-page' });
    var xmlText2 = await directFetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?' + fetchParams.toString(), {}, 35000);
    var doc = new DOMParser().parseFromString(xmlText2, 'text/xml');
    var articles = Array.prototype.slice.call(doc.getElementsByTagName('PubmedArticle'));
    var items = articles.map(function (a) {
      var pmid = xmlText(a.getElementsByTagName('PMID')[0]);
      var title = xmlText(a.getElementsByTagName('ArticleTitle')[0]);
      var journal = xmlText(a.getElementsByTagName('Title')[0]);
      var year = '';
      var pubDate = a.getElementsByTagName('PubDate')[0];
      if (pubDate) {
        var y = pubDate.getElementsByTagName('Year')[0];
        var md = pubDate.getElementsByTagName('MedlineDate')[0];
        year = y ? xmlText(y) : (md ? (xmlText(md).match(/\d{4}/) || [''])[0] : '');
      }
      var authors = Array.prototype.slice.call(a.getElementsByTagName('Author')).map(function (au) {
        var last = xmlText(au.getElementsByTagName('LastName')[0]);
        var first = xmlText(au.getElementsByTagName('ForeName')[0]);
        var col = xmlText(au.getElementsByTagName('CollectiveName')[0]);
        return col || [last, first].filter(Boolean).join(' ');
      }).filter(Boolean);
      var abstractParts = Array.prototype.slice.call(a.getElementsByTagName('AbstractText')).map(function (ab) {
        var label = ab.getAttribute('Label');
        return (label ? label + ': ' : '') + xmlText(ab);
      }).filter(Boolean);
      var doi = '';
      var idsEls = Array.prototype.slice.call(a.getElementsByTagName('ArticleId'));
      idsEls.forEach(function (idEl) { if (idEl.getAttribute('IdType') === 'doi') doi = xmlText(idEl); });
      if (!doi) {
        var eloc = Array.prototype.slice.call(a.getElementsByTagName('ELocationID'));
        eloc.forEach(function (e) { if (e.getAttribute('EIdType') === 'doi') doi = xmlText(e); });
      }
      var pmc = '';
      idsEls.forEach(function (idEl) { if (idEl.getAttribute('IdType') === 'pmc') pmc = xmlText(idEl); });
      return {
        pmid: pmid,
        title: title || '(未取到标题)',
        authors: authors,
        journal: journal,
        year: year,
        date: year,
        abstract: abstractParts.join('\n\n'),
        doi: doi,
        pmc: pmc,
        url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/'
      };
    });
    return { source: 'PubMed（页面直连）', query: term, queryLabel: term, total: total, items: items };
  }
  async function directTrials(form) {
    var params = new URLSearchParams();
    params.set('query.cond', form.condition);
    if (form.intervention) params.set('query.intr', form.intervention);
    if (form.phase) params.set('filter.phase', form.phase);
    if (form.trialStatus) params.set('filter.overallStatus', form.trialStatus);
    params.set('pageSize', String(clamp(parseInt(form.limit, 10) || 10, 1, 30)));
    params.set('fields', 'NCTId,BriefTitle,OfficialTitle,OverallStatus,Phase,LeadSponsorName,CollaboratorName,StartDate,LastUpdatePostDate,PrimaryCompletionDate,EnrollmentCount,EnrollmentType,Condition,InterventionName,InterventionType,BriefSummary,PrimaryOutcomeMeasure');
    var text = await directFetch('https://clinicaltrials.gov/api/v2/studies?' + params.toString(), {}, 30000);
    var j = safeJsonParse(text);
    if (!j) throw new Error('ClinicalTrials.gov 返回无法解析');
    var studies = j.studies || [];
    var items = studies.map(function (study) {
      var p = study.protocolSection || {};
      var id = p.identificationModule || {};
      var st = p.statusModule || {};
      var des = p.designModule || {};
      var sp = p.sponsorCollaboratorsModule || {};
      var cond = p.conditionsModule || {};
      var arms = p.armsInterventionsModule || {};
      var desc = p.descriptionModule || {};
      return {
        nctId: id.nctId || '',
        title: id.briefTitle || id.officialTitle || '(未取到标题)',
        status: st.overallStatus || '',
        statusLabel: (function (s) {
          return { RECRUITING: '招募中', NOT_YET_RECRUITING: '尚未招募', ACTIVE_NOT_RECRUITING: '进行中（不招募）', COMPLETED: '已完成', ENROLLING_BY_INVITATION: '邀请入组', SUSPENDED: '暂停', TERMINATED: '终止', WITHDRAWN: '撤回', UNKNOWN: '未知' }[s] || s || '';
        })(st.overallStatus),
        phase: (des.phases || []).join(' / '),
        sponsor: (sp.leadSponsor && sp.leadSponsor.name) || '',
        startDate: (st.startDateStruct && st.startDateStruct.date) || '',
        lastUpdate: (st.lastUpdatePostDateStruct && st.lastUpdatePostDateStruct.date) || '',
        enrollment: (des.enrollmentInfo && des.enrollmentInfo.count) || '',
        conditions: cond.conditions || [],
        interventions: (arms.interventions || []).map(function (x) { return [x.name, x.type].filter(Boolean).join(' / '); }),
        summary: desc.briefSummary || '',
        url: 'https://clinicaltrials.gov/study/' + (id.nctId || '')
      };
    });
    return { source: 'ClinicalTrials.gov API v2（页面直连）', query: form.condition, queryLabel: [form.condition, form.intervention].filter(Boolean).join(' / '), total: Number(j.totalCount || items.length), items: items };
  }
  async function directDrug(name) {
    var warnings = [];
    var hits = null;
    try {
      var q = new URLSearchParams({ q: name, size: '3', fields: 'chembl.pref_name,chembl.molecule_chembl_id,chembl.max_phase,drugbank.name,drugbank.drugbank_id,pubchem.iupac.name.all,unii.name,ginas.name,inchikey' });
      var t1 = await directFetch('https://mychem.info/v1/query?' + q.toString(), {}, 25000);
      var j1 = safeJsonParse(t1);
      hits = j1 && j1.hits;
    } catch (e) { warnings.push('MyChem.info：' + e.message); }
    var label = null;
    try {
      var fp = new URLSearchParams({ search: 'openfda.generic_name:"' + name.replace(/"/g, '') + '"', limit: '10' });
      var t2 = await directFetch('https://api.fda.gov/drug/label.json?' + fp.toString(), {}, 25000);
      var j2 = safeJsonParse(t2);
      if (j2 && j2.results && j2.results.length) {
        var needle = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        var best = null, bestScore = -1;
        j2.results.forEach(function (lab) {
          var names = ((lab.openfda && lab.openfda.generic_name) || []).concat((lab.openfda && lab.openfda.brand_name) || []);
          var score = 0;
          names.forEach(function (raw) {
            var g = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (g === needle) score = Math.max(score, 100);
            else if (g.indexOf(needle + ' ') === 0 || g.lastIndexOf(' ' + needle) === g.length - needle.length - 1) score = Math.max(score, 60);
            else if (g.indexOf(needle) >= 0) score = Math.max(score, 20);
          });
          score -= Math.min(names.length, 5);
          if (score > bestScore) { best = lab; bestScore = score; }
        });
        label = best;
        if (best && bestScore < 60) warnings.push('openFDA 未找到与“' + name + '”完全对应的单一成分说明书；当前为含该成分的组合/复方说明书，请核对成分与适应症。');
      }
    } catch (e) { warnings.push('openFDA：' + e.message); }
    var first = (hits && hits[0]) || {};
    var names = [first.chembl && first.chembl.pref_name, first.drugbank && first.drugbank.name].filter(Boolean);
    var identifiers = [];
    if (first.chembl && first.chembl.molecule_chembl_id) identifiers.push(['ChEMBL', first.chembl.molecule_chembl_id]);
    if (first.drugbank && first.drugbank.drugbank_id) identifiers.push(['DrugBank', first.drugbank.drugbank_id]);
    if (first.unii && first.unii.name) identifiers.push(['UNII', first.unii.name]);
    if (first.inchikey) identifiers.push(['InChIKey', first.inchikey]);
    var sectionDefs = [['boxed_warning', '黑框警告'], ['indications_and_usage', '适应症'], ['dosage_and_administration', '用法用量'], ['contraindications', '禁忌'], ['warnings', '警告与注意事项'], ['adverse_reactions', '不良反应'], ['drug_interactions', '药物相互作用'], ['use_in_specific_populations', '特殊人群'], ['pregnancy', '妊娠'], ['pediatric_use', '儿科使用'], ['geriatric_use', '老年使用'], ['overdosage', '过量'], ['description', '药物描述']];
    var sections = [];
    if (label) {
      sectionDefs.forEach(function (sd) {
        var v = label[sd[0]];
        var text = Array.isArray(v) ? v.join('\n') : (v || '');
        if (text) sections.push({ key: sd[0], heading: sd[1], text: String(text).slice(0, 1200) });
      });
    }
    return {
      source: 'MyChem.info + openFDA（页面直连）',
      query: name,
      queryLabel: name,
      total: sections.length ? 1 : 0,
      items: [{
        query: name,
        names: names,
        identifiers: identifiers,
        label: label ? {
          region: '美国',
          agency: 'FDA（openFDA 药品说明书）',
          effectiveTime: (function () { var r = String(label.effective_time || ''); return /^\d{8}$/.test(r) ? r.slice(0, 4) + '-' + r.slice(4, 6) + '-' + r.slice(6, 8) : r; })(),
          genericNames: (label.openfda && label.openfda.generic_name) || [],
          manufacturer: (label.openfda && label.openfda.manufacturer_name) || [],
          sections: sections
        } : null,
        warnings: warnings,
        links: [
          ['DailyMed 说明书检索', 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=' + encodeURIComponent(name)],
          ['PubChem 化合物', 'https://pubchem.ncbi.nlm.nih.gov/#query=' + encodeURIComponent(name)]
        ],
        coverageNote: '当前仅整合美国 FDA 说明书与化学标识；中国 NMPA 说明书、适应症差异与可及性未覆盖，临床使用前请查阅国家药监局批准的现行说明书。'
      }]
    };
  }

  /* ---------------- 结果入库 / 任务 ---------------- */
  function searchResultToItem(kind, row) {
    var now = Date.now();
    if (kind === 'lit') {
      return {
        title: row.title,
        type: '期刊文献',
        authors: row.authors || [],
        year: row.year || '',
        journal: row.journal || '',
        doi: row.doi || '',
        pmid: row.pmid || '',
        pmc: row.pmc || '',
        abstract: row.abstract || '',
        url: row.url || '',
        tags: [],
        source: { type: 'pubmed', label: 'PubMed 检索', at: now },
        extra: { retrievedAt: now, query: APP.search.meta.lit && APP.search.meta.lit.query }
      };
    }
    if (kind === 'trial') {
      return {
        title: row.title,
        type: '临床试验',
        abstract: row.summary || '',
        url: row.url || '',
        tags: [row.nctId].filter(Boolean),
        source: { type: 'trial', label: 'ClinicalTrials.gov', at: now },
        extra: {
          nctId: row.nctId, status: row.status, statusLabel: row.statusLabel, phase: row.phase,
          sponsor: row.sponsor, startDate: row.startDate, lastUpdate: row.lastUpdate,
          enrollment: row.enrollment, conditions: row.conditions, interventions: row.interventions
        }
      };
    }
    var label = row.label;
    var sections = label ? label.sections : [];
    return {
      title: ((row.names && row.names[0]) || row.query || '药物资料') + ' · 药物资料',
      type: '药物资料',
      abstract: sections.length ? sections.map(function (s) { return s.heading + '：' + s.text; }).join('\n\n') : (row.coverageNote || ''),
      url: (row.links && row.links[0] && row.links[0][1]) || '',
      tags: (row.identifiers || []).map(function (x) { return x[0] + ':' + x[1]; }),
      source: { type: 'drug', label: 'MyChem.info + openFDA', at: now },
      extra: { identifiers: row.identifiers, labelRegion: label && label.region, agency: label && label.agency, effectiveTime: label && label.effectiveTime, coverageNote: row.coverageNote }
    };
  }
  function addSearchResult(kind, index) {
    var rows = APP.search.results[APP.ui.search.tab];
    var row = rows && rows[index];
    if (!row) return;
    var res = upsertItem(searchResultToItem(kind, row));
    markDirty({ immediate: true });
    render();
    toast(res && res.merged ? '已合并到现有资料记录（保留原笔记与批注）' : '已加入资料库');
  }
  function starSearchResult(kind, index) {
    var rows = APP.search.results[APP.ui.search.tab];
    var row = rows && rows[index];
    if (!row) return;
    var raw = searchResultToItem(kind, row);
    raw.starred = true;
    var res = upsertItem(raw);
    markDirty({ immediate: true });
    render();
    toast('已收藏到资料库' + (res && res.merged ? '（合并到现有记录）' : ''));
  }
  function addSearchResultToTopic(kind, index) {
    var rows = APP.search.results[APP.ui.search.tab];
    var row = rows && rows[index];
    if (!row) return;
    var body = '<div class="field"><label>选择专题</label><select class="select" name="topicId">' + (APP.data.topics.length ? APP.data.topics.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('') : '<option value="">还没有专题</option>') + '</select></div>' +
      '<div class="field"><label>或新建专题名称</label><input class="input" name="newTopic" placeholder="留空则使用上面的专题" /></div>' +
      '<div class="hint">资料与专题是多对多关系；同一资料不会因为加入多个专题而重复。</div>';
    openModal({
      title: '加入专题',
      body: body,
      submitLabel: '确认加入',
      onSubmit: function (fd) {
        var topicId = str(fd.get('topicId'));
        var newName = str(fd.get('newTopic'));
        if (newName) {
          var tp = { id: uid('tp'), name: newName, kind: 'direction', description: '', createdAt: Date.now(), updatedAt: Date.now() };
          APP.data.topics.unshift(tp);
          topicId = tp.id;
        }
        if (!topicId) { toast('请选择或新建专题'); return false; }
        var res = upsertItem(searchResultToItem(kind, row), { topicId: topicId });
        markDirty({ immediate: true });
        closeModal();
        render();
        toast('已加入专题：' + topicName(topicId));
      }
    });
  }
  function searchResultTask(kind, index) {
    var rows = APP.search.results[APP.ui.search.tab];
    var row = rows && rows[index];
    if (!row) return;
    var title = kind === 'trial' ? '关注试验：' + row.nctId + ' · ' + row.title : kind === 'drug' ? '核对药物资料：' + ((row.names && row.names[0]) || row.query) : '阅读文献：' + truncate(row.title, 60);
    openTaskModal({
      subjectType: kind === 'trial' ? 'trial' : kind === 'drug' ? 'drug' : 'none',
      subjectId: kind === 'trial' ? row.nctId : kind === 'drug' ? ((row.names && row.names[0]) || row.query) : '',
      subjectUrl: row.url || '',
      subjectLabel: kind === 'trial' ? row.title : kind === 'drug' ? ((row.names && row.names[0]) || row.query) : '',
      title: title,
      detail: kind === 'trial' ? ('来源：ClinicalTrials.gov · ' + (row.statusLabel || row.status) + ' · 更新 ' + (row.lastUpdate || '—')) : kind === 'drug' ? ('来源：' + ((row.label && row.label.agency) || '药物资料') + ' · 更新 ' + ((row.label && row.label.effectiveTime) || '—')) : ('PMID ' + (row.pmid || '—') + ' · DOI ' + (row.doi || '—'))
    });
  }

  function openTopicPickerForSearch() {}
  function initSearchShortcuts() {}

