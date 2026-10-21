
  /* ================================================================
     常量与全局状态
     ================================================================ */
  var LS_KEY = 'dsh.medresearch.v1';
  var LS_BRIDGE_KEY = 'dsh.medresearch.bridge';
  var DEFAULT_BRIDGE = 'http://127.0.0.1:8765';
  var VERSION = '0.2.3';
  var READ_STATUS = { unread: '未读', reading: '在读', read: '已读' };
  var READ_CLASS = { unread: 'unread', reading: 'reading', read: 'read' };
  var TASK_STATUS = { todo: '待办', doing: '进行中', done: '已完成' };
  var TASK_STATUS_ORDER = ['todo', 'doing', 'done'];
  var PRIORITY = { high: '高', med: '中', low: '低' };
  var PRIORITY_CLASS = { high: 'prioHigh', med: 'prioMed', low: 'prioLow' };
  var ITEM_TYPES = ['期刊文献', '指南', '综述', 'Meta 分析', '临床试验', '药物资料', '说明书', '会议摘要', '其他'];
  var TOPIC_KINDS = { disease: '疾病', drug: '药物', direction: '研究方向' };
  var SECTIONS = [
    { id: 'home', label: '首页概览', icon: 'home' },
    { id: 'library', label: '医学资料库', icon: 'library' },
    { id: 'reader', label: '文献阅读台', icon: 'reader' },
    { id: 'search', label: '医学数据检索', icon: 'search' },
    { id: 'cases', label: '病例与医学问题', icon: 'case' },
    { id: 'tasks', label: '学术任务', icon: 'task' }
  ];
  var ICON = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M3 10.2 12 3l9 7.2"/><path d="M5.5 9.3V21h13V9.3"/><path d="M9.5 21v-6h5v6"/></svg>',
    library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v20H7.5A2.5 2.5 0 0 1 5 19.5z"/><path d="M9 7h7M9 11h5"/></svg>',
    reader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 4.5h7a2 2 0 0 1 2 2V21a2.5 2.5 0 0 0-2.5-2.5H3z"/><path d="M21 4.5h-7a2 2 0 0 0-2 2V21a2.5 2.5 0 0 1 2.5-2.5H21z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="M8 10.5h5M10.5 8v5"/></svg>',
    case: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="6.5" width="18" height="14" rx="2.5"/><path d="M8.5 6.5V4h7v2.5"/><path d="M8 13h8M12 9.5v7"/></svg>',
    task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/><path d="M8.5 15l2 2 4-4"/></svg>'
  };

  var APP = {
    data: null,
    source: '',
    section: 'home',
    route: { section: 'home' },
    bridge: {
      url: localStorage.getItem(projectStorageKey(LS_BRIDGE_KEY)) || DEFAULT_BRIDGE,
      online: false,
      health: null,
      error: '',
      checkedAt: 0,
      probing: false
    },
    save: { mode: 'local', at: 0, saving: false, error: '', dirty: false },
    ui: {
      library: { tab: 'materials', q: '', type: '', status: '', topic: '', tag: '', sort: 'recent', star: false },
      reader: { q: '', filter: 'all', tab: 'notes', showList: false, aside: false },
      search: { tab: 'lit', q: '', disease: '', drug: '', yearFrom: '', yearTo: '', phase: '', trialStatus: '', status: '', intervention: '', condition: '' },
      cases: {},
      tasks: { q: '', priority: '', status: '' }
    },
    search: { loading: false, error: '', results: { lit: null, trials: null, drug: null }, meta: { lit: null, trials: null, drug: null } },
    drawer: { type: '', id: '' },
    modal: { onSubmit: null, onDelete: null, busy: false },
    model: { loading: true, host: null, mode: 'dsh', dsh: {}, custom: {}, status: { status: 'untested', at: 0, message: '尚未测试' } },
    modelForm: null,
    modelSettingsOpen: false,
    selection: null,
    toastTimer: null
  };
  window.__MEDWB__ = APP;

  var READER = {
    itemId: '',
    tab: 'notes',
    pdf: null,
    docToken: 0,
    numPages: 0,
    page: 1,
    scale: 1.15,
    lastScale: 1.15,
    fit: true,
    status: 'idle',
    error: '',
    loading: false,
    pageTextCache: {},
    textChunks: [],
    selection: null,
    noteQuote: '',
    notePage: '',
    qaBusy: false,
    qaError: '',
    renderBusy: false,
    renderToken: 0
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ================================================================
     基础工具
     ================================================================ */
  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) { return String(v == null ? '' : v).trim(); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function uniq(list) {
    var seen = {};
    return arr(list).filter(function (x) {
      var k = String(x);
      if (!k || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    return fmtDate(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function relTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - Number(ts);
    if (diff < 0) return fmtDateTime(ts);
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    return fmtDate(ts);
  }
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T23:59:59');
    if (isNaN(d.getTime())) return null;
    var today = new Date();
    var a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    var b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((b - a) / 86400000);
  }
  function dueLabel(dateStr) {
    var n = daysUntil(dateStr);
    if (n == null) return '';
    if (n < 0) return '逾期 ' + Math.abs(n) + ' 天';
    if (n === 0) return '今天到期';
    if (n === 1) return '明天到期';
    return '还剩 ' + n + ' 天';
  }
  function dueClass(dateStr) {
    var n = daysUntil(dateStr);
    if (n == null) return '';
    if (n < 0) return 'dueOver';
    if (n <= 3) return 'dueSoon';
    return '';
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }
  function findNativeComposer() {
    try {
      if (!window.parent || window.parent === window) return null;
      var doc = window.parent.document;
      var list = doc.querySelectorAll('[contenteditable="true"], textarea');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el || el.disabled || el.readOnly) continue;
        if (el.offsetParent === null && el.getClientRects().length === 0) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 16) continue;
        return { doc: doc, el: el, editable: el.getAttribute('contenteditable') === 'true' };
      }
    } catch (e) {}
    return null;
  }
  // 把交接稿放入同一 DSH 原生输入框，只生成草稿，不点击发送。
  async function putNativeDraft(text) {
    var t = findNativeComposer();
    if (!t) {
      var copied = await copyText(text);
      return { ok: false, copied: copied, reason: 'not-embedded' };
    }
    try {
      var doc = t.doc;
      var el = t.el;
      try { window.parent.focus(); } catch (e0) {}
      el.focus();
      var existing = String(t.editable ? el.innerText : el.value || '').trim();
      var payload = existing ? existing + '\n\n---\n\n' + text : text;
      if (t.editable) {
        var range = doc.createRange();
        range.selectNodeContents(el);
        var sel = window.parent.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        var ok = doc.execCommand('insertText', false, payload);
        if (!ok) {
          el.textContent = payload;
        }
        el.dispatchEvent(new window.parent.InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload }));
      } else {
        el.value = payload;
        el.dispatchEvent(new window.parent.Event('input', { bubbles: true }));
      }
      return { ok: true, keptExisting: !!existing };
    } catch (e) {
      var copied2 = await copyText(text);
      return { ok: false, copied: copied2, reason: e.message || 'failed' };
    }
  }
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(APP.toastTimer);
    APP.toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2400);
  }
  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function normalizeDoi(v) {
    return str(v).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim().toLowerCase();
  }
  function normalizeTitle(v) {
    return str(v).toLowerCase().replace(/[\s\u3000]+/g, ' ').replace(/[“”"'’‘]/g, '').replace(/[.,;:!?。，；：！？]/g, '').trim();
  }
  function projectDir() {
    var m = location.pathname.match(/^\/api\/worktable\/site\/([^/]+)\//);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }
  function joinPath(dir) {
    var rest = Array.prototype.slice.call(arguments, 1);
    var sep = dir.indexOf('\\') >= 0 ? '\\' : '/';
    return String(dir).replace(/[\\/]+$/, '') + sep + rest.join(sep);
  }
  function dataFilePath() {
    var dir = projectDir();
    return dir ? joinPath(dir, 'data', 'workbench-data.json') : '';
  }
  function fetchJsonNice(url, options, timeoutMs) {
    options = Object.assign({}, options || {});
    var bridgePath = bridgeRequestPath(url);
    if (bridgePath) {
      var root = projectDir();
      var isProbe = bridgePath === '/health' || bridgePath === '/status';
      if (!isProbe && (!bridgeIdentityMatches(APP.bridge.health) || APP.bridge.verifiedUrl !== APP.bridge.url)) {
        return Promise.reject(new Error('本地文件服务尚未通过当前项目目录校验，已阻止跨项目请求'));
      }
      options.headers = Object.assign({}, options.headers || {});
      if (root) options.headers['x-medresearch-project-root'] = encodeURIComponent(root);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 8000);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then(function (r) {
        return r.text().then(function (text) {
          var json = safeJsonParse(text);
          if (bridgePath && json && Array.isArray(json.pathWarnings)) {
            APP.bridge.pathWarnings = json.pathWarnings.map(function (row) {
              return typeof row === 'string' ? row : String((row && row.message) || 'PDF 路径需要重新定位');
            });
            var warningText = APP.bridge.pathWarnings.join('\n');
            if (warningText && warningText !== APP.bridge.lastPathWarning) {
              APP.bridge.lastPathWarning = warningText;
              toast('部分 PDF 路径无法确认，请在“设置 → 数据与备份”查看并重新定位文件');
            }
          }
          if (bridgePath && r.status === 403) {
            APP.bridge.online = false;
            APP.bridge.verifiedUrl = '';
            APP.bridge.error = (json && json.error && json.error.message) || '本地服务项目目录校验失败';
          }
          return { ok: r.ok, status: r.status, json: json, text: text };
        });
      })
      .finally(function () { clearTimeout(timer); });
  }
  function apiErrorMessage(err) {
    if (!err) return '未知错误';
    if (err.name === 'AbortError') return '请求超时';
    return err.message || String(err);
  }
  function normalizedProjectRoot(value) {
    var root = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!/^(?:[a-z]:\/|\/)/i.test(root)) return '';
    var unc = root.slice(0, 2) === '//';
    var clean = [];
    root.split('/').forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') { if (clean.length > 1) clean.pop(); return; }
      clean.push(part);
    });
    return (unc ? '//' : (/^\//.test(root) ? '/' : '')) + clean.join('/').toLowerCase();
  }
  function projectStorageKey(base) {
    var root = normalizedProjectRoot(projectDir());
    return base + ':' + encodeURIComponent(root || ('page:' + location.pathname));
  }
  function bridgeIdentityMatches(health) {
    var expected = normalizedProjectRoot(projectDir());
    return Boolean(expected && health && health.ok === true && health.service === 'medresearch-workbench-bridge'
      && normalizedProjectRoot(health.projectRoot) === expected);
  }
  function bridgeRequestPath(url) {
    try {
      var base = new URL(APP.bridge.url);
      var target = new URL(url, location.href);
      if (target.origin !== base.origin) return '';
      return target.pathname;
    } catch (e) { return ''; }
  }

  /* ================================================================
     数据模型
     ================================================================ */
  function emptyState() {
    return {
      version: 1,
      updatedAt: Date.now(),
      seeded: false,
      settings: { fontSize: 14, lastSection: 'home' },
      items: [],
      topics: [],
      notes: [],
      tasks: [],
      cases: [],
      searches: []
    };
  }
  function normSource(x) {
    var s = x && typeof x === 'object' ? x : {};
    return {
      type: str(s.type) || 'manual',
      label: str(s.label) || '手动登记',
      at: num(s.at, Date.now())
    };
  }
  function normalizeItem(x) {
    if (!x || typeof x !== 'object') return null;
    var id = str(x.id) || uid('it');
    var title = str(x.title) || '(未命名资料)';
    var status = READ_STATUS[x.readStatus] ? x.readStatus : 'unread';
    return {
      id: id,
      title: title,
      type: ITEM_TYPES.indexOf(x.type) >= 0 ? x.type : '其他',
      authors: arr(x.authors).map(str).filter(Boolean),
      year: str(x.year),
      journal: str(x.journal),
      doi: str(x.doi),
      pmid: str(x.pmid),
      pmc: str(x.pmc),
      zoteroKey: str(x.zoteroKey),
      zoteroRef: str(x.zoteroRef),
      zoteroItemType: str(x.zoteroItemType),
      attachmentKey: str(x.attachmentKey),
      abstract: str(x.abstract),
      url: str(x.url),
      filePath: str(x.filePath),
      fulltext: str(x.fulltext),
      source: normSource(x.source),
      topicIds: uniq(arr(x.topicIds).map(str).filter(Boolean)),
      tags: uniq(arr(x.tags).map(str).filter(Boolean)),
      starred: !!x.starred,
      readStatus: status,
      addedAt: num(x.addedAt, Date.now()),
      lastOpenedAt: num(x.lastOpenedAt, 0),
      annotations: arr(x.annotations).filter(function (a) { return a && typeof a === 'object'; }).map(function (a) {
        return {
          id: str(a.id) || uid('an'),
          page: str(a.page),
          sourceRef: str(a.sourceRef),
          quote: str(a.quote),
          comment: str(a.comment),
          color: str(a.color) || '#ffd600',
          origin: a.origin === 'ai' ? 'ai' : 'user',
          source: a.source === 'zotero' ? 'zotero' : '',
          zoteroKey: str(a.zoteroKey),
          createdAt: num(a.createdAt, Date.now())
        };
      }),
      qa: arr(x.qa).filter(function (a) { return a && typeof a === 'object'; }).slice(-30).map(function (a) {
        return {
          id: str(a.id) || uid('qa'),
          question: str(a.question),
          answer: str(a.answer),
          citations: arr(a.citations).map(function (c) { return { label: str(c.label), page: str(c.page), preview: str(c.preview) }; }),
          grounded: !!a.grounded,
          origin: a.origin === 'ai' ? 'ai' : 'local',
          provider: str(a.provider),
          providerLabel: str(a.providerLabel),
          model: str(a.model),
          mode: str(a.mode),
          source: str(a.source),
          truncated: !!a.truncated,
          finishReason: str(a.finishReason),
          notice: str(a.notice),
          configNote: str(a.configNote),
          createdAt: num(a.createdAt, Date.now())
        };
      }),
      extra: x.extra && typeof x.extra === 'object' ? x.extra : {},
      demo: !!x.demo,
      sample: !!x.sample,
      createdAt: num(x.createdAt, Date.now()),
      updatedAt: num(x.updatedAt, Date.now())
    };
  }
  function normalizeTopic(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: str(x.id) || uid('tp'),
      name: str(x.name) || '(未命名专题)',
      kind: TOPIC_KINDS[x.kind] ? x.kind : 'direction',
      description: str(x.description),
      createdAt: num(x.createdAt, Date.now()),
      updatedAt: num(x.updatedAt, Date.now()),
      demo: !!x.demo
    };
  }
  function normalizeNote(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: str(x.id) || uid('nt'),
      body: str(x.body),
      itemId: str(x.itemId),
      topicId: str(x.topicId),
      caseId: str(x.caseId),
      sourcePage: str(x.sourcePage),
      sourceRef: str(x.sourceRef),
      quote: str(x.quote),
      tags: uniq(arr(x.tags).map(str).filter(Boolean)),
      origin: x.origin === 'ai' ? 'ai' : 'user',
      createdAt: num(x.createdAt, Date.now()),
      updatedAt: num(x.updatedAt, Date.now()),
      demo: !!x.demo
    };
  }
  function normalizeTask(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: str(x.id) || uid('tk'),
      title: str(x.title) || '(未命名任务)',
      status: TASK_STATUS[x.status] ? x.status : 'todo',
      priority: PRIORITY[x.priority] ? x.priority : 'med',
      due: str(x.due),
      detail: str(x.detail),
      subjectType: ['topic', 'item', 'case', 'trial', 'drug', 'none'].indexOf(x.subjectType) >= 0 ? x.subjectType : 'none',
      subjectId: str(x.subjectId),
      subjectLabel: str(x.subjectLabel),
      subjectUrl: str(x.subjectUrl),
      createdAt: num(x.createdAt, Date.now()),
      updatedAt: num(x.updatedAt, Date.now()),
      demo: !!x.demo
    };
  }
  function normalizeCase(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: str(x.id) || uid('cs'),
      code: str(x.code) || '匿名-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      title: str(x.title) || '(未命名病例)',
      chief: str(x.chief),
      present: str(x.present),
      past: str(x.past),
      exams: str(x.exams),
      questions: str(x.questions),
      keywords: str(x.keywords),
      aiSummary: str(x.aiSummary),
      aiAt: num(x.aiAt, 0),
      aiTruncated: !!x.aiTruncated,
      aiFinishReason: str(x.aiFinishReason),
      itemIds: uniq(arr(x.itemIds).map(str).filter(Boolean)),
      taskIds: uniq(arr(x.taskIds).map(str).filter(Boolean)),
      createdAt: num(x.createdAt, Date.now()),
      updatedAt: num(x.updatedAt, Date.now()),
      demo: !!x.demo
    };
  }
  function normalizeSearch(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: str(x.id) || uid('sh'),
      type: ['literature', 'trial', 'drug'].indexOf(x.type) >= 0 ? x.type : 'literature',
      query: str(x.query),
      params: x.params && typeof x.params === 'object' ? x.params : {},
      count: num(x.count, 0),
      source: str(x.source),
      at: num(x.at, Date.now())
    };
  }
  function normalizeState(raw) {
    var out = emptyState();
    if (!raw || typeof raw !== 'object') return out;
    out.updatedAt = num(raw.updatedAt, Date.now());
    out.seeded = !!raw.seeded;
    out.settings = {
      fontSize: clamp(num(raw.settings && raw.settings.fontSize, 14), 12, 22),
      lastSection: str(raw.settings && raw.settings.lastSection) || 'home'
    };
    out.items = arr(raw.items).map(normalizeItem).filter(Boolean);
    out.topics = arr(raw.topics).map(normalizeTopic).filter(Boolean);
    out.notes = arr(raw.notes).map(normalizeNote).filter(Boolean);
    out.tasks = arr(raw.tasks).map(normalizeTask).filter(Boolean);
    out.cases = arr(raw.cases).map(normalizeCase).filter(Boolean);
    out.searches = arr(raw.searches).map(normalizeSearch).filter(Boolean).slice(0, 80);
    var itemIds = {}, topicIds = {}, caseIds = {}, taskIds = {};
    out.items.forEach(function (x) { itemIds[x.id] = 1; });
    out.topics.forEach(function (x) { topicIds[x.id] = 1; });
    out.cases.forEach(function (x) { caseIds[x.id] = 1; });
    out.tasks.forEach(function (x) { taskIds[x.id] = 1; });
    out.items.forEach(function (x) { x.topicIds = x.topicIds.filter(function (id) { return topicIds[id]; }); });
    out.notes.forEach(function (n) {
      if (n.itemId && !itemIds[n.itemId]) n.itemId = '';
      if (n.topicId && !topicIds[n.topicId]) n.topicId = '';
      if (n.caseId && !caseIds[n.caseId]) n.caseId = '';
    });
    out.cases.forEach(function (c) {
      c.itemIds = c.itemIds.filter(function (id) { return itemIds[id]; });
      c.taskIds = c.taskIds.filter(function (id) { return taskIds[id]; });
    });
    return out;
  }
  function validateBackup(raw) {
    var problems = [];
    if (!raw || typeof raw !== 'object') return { ok: false, problems: ['文件不是 JSON 对象'] };
    if (Number(raw.version) !== 1) problems.push('version 不是 1');
    ['items', 'topics', 'notes', 'tasks', 'cases', 'searches'].forEach(function (k) {
      if (!Array.isArray(raw[k])) problems.push('缺少数组字段 ' + k);
    });
    if (!problems.length) {
      var ids = {};
      ['items', 'topics', 'notes', 'tasks', 'cases'].forEach(function (k) {
        raw[k].forEach(function (row) {
          if (!row || typeof row.id !== 'string' || !row.id) problems.push(k + ' 中存在缺少 id 的记录');
          else if (ids[row.id]) problems.push('重复 id：' + row.id);
          else ids[row.id] = 1;
        });
      });
    }
    var counts = {
      items: arr(raw.items).length,
      topics: arr(raw.topics).length,
      notes: arr(raw.notes).length,
      tasks: arr(raw.tasks).length,
      cases: arr(raw.cases).length
    };
    return { ok: problems.length === 0, problems: problems.slice(0, 8), counts: counts };
  }
  function identityKeys(item) {
    var keys = [];
    if (item.pmid) keys.push('pmid:' + item.pmid);
    if (item.doi) keys.push('doi:' + normalizeDoi(item.doi));
    if (item.zoteroKey) keys.push('zotero:' + item.zoteroKey);
    var t = normalizeTitle(item.title);
    if (t.length >= 12) keys.push('title:' + t + '|' + str(item.year));
    return keys;
  }
  function findDuplicate(item) {
    var target = {};
    identityKeys(item).forEach(function (k) { target[k] = 1; });
    for (var i = 0; i < APP.data.items.length; i++) {
      var row = APP.data.items[i];
      if (row.id === item.id) continue;
      // 演示数据与真实导入不互相合并，避免真实条目继承“演示”徽标或演示内容。
      if (!!row.demo !== !!item.demo) continue;
      var keys = identityKeys(row);
      for (var j = 0; j < keys.length; j++) {
        if (target[keys[j]]) return row;
      }
    }
    return null;
  }
  function mergeItem(existing, incoming) {
    existing.title = incoming.title || existing.title;
    existing.type = incoming.type || existing.type;
    if (incoming.authors && incoming.authors.length) existing.authors = uniq(existing.authors.concat(incoming.authors));
    existing.year = existing.year || incoming.year;
    existing.journal = existing.journal || incoming.journal;
    existing.doi = existing.doi || incoming.doi;
    existing.pmid = existing.pmid || incoming.pmid;
    existing.pmc = existing.pmc || incoming.pmc;
    existing.url = existing.url || incoming.url;
    existing.abstract = existing.abstract || incoming.abstract;
    existing.filePath = existing.filePath || incoming.filePath;
    existing.fulltext = existing.fulltext || incoming.fulltext;
    existing.attachmentKey = existing.attachmentKey || incoming.attachmentKey;
    existing.zoteroKey = existing.zoteroKey || incoming.zoteroKey;
    existing.zoteroRef = existing.zoteroRef || incoming.zoteroRef;
    existing.zoteroItemType = existing.zoteroItemType || incoming.zoteroItemType;
    existing.topicIds = uniq(existing.topicIds.concat(incoming.topicIds || []));
    existing.tags = uniq(existing.tags.concat(incoming.tags || []));
    existing.starred = existing.starred || incoming.starred;
    if (incoming.readStatus === 'read') existing.readStatus = 'read';
    else if (existing.readStatus === 'unread' && incoming.readStatus === 'reading') existing.readStatus = 'reading';
    var annMap = {};
    var annMerged = [];
    (existing.annotations || []).concat(incoming.annotations || []).forEach(function (a) {
      var k = String(a.page || '') + '|' + String(a.quote || a.comment || '').slice(0, 120);
      if (!annMap[k]) {
        annMap[k] = a;
        annMerged.push(a);
        return;
      }
      var t = annMap[k];
      // 重复批注只补齐来源/评论/表图号，避免真实 Zotero 来源被旧记录覆盖。
      if (!t.source && a.source) t.source = a.source;
      if (!t.zoteroKey && a.zoteroKey) t.zoteroKey = a.zoteroKey;
      if (!t.comment && a.comment) t.comment = a.comment;
      if (!t.sourceRef && a.sourceRef) t.sourceRef = a.sourceRef;
    });
    existing.annotations = annMerged.slice(-300);
    existing.qa = (existing.qa || []).concat(incoming.qa || []).slice(-30);
    existing.extra = Object.assign({}, existing.extra || {}, incoming.extra || {});
    existing.source = incoming.source || existing.source;
    existing.updatedAt = Date.now();
    return existing;
  }
  function upsertItem(item, opts) {
    opts = opts || {};
    var incoming = normalizeItem(item);
    if (!incoming) return null;
    if (opts.topicId && incoming.topicIds.indexOf(opts.topicId) < 0) incoming.topicIds.push(opts.topicId);
    var dup = findDuplicate(incoming);
    if (dup) {
      var before = dup.updatedAt;
      mergeItem(dup, incoming);
      return { item: dup, created: false, merged: true, before: before };
    }
    APP.data.items.unshift(incoming);
    return { item: incoming, created: true, merged: false };
  }
  function findItem(id) { return APP.data.items.filter(function (x) { return x.id === id; })[0] || null; }
  function findTopic(id) { return APP.data.topics.filter(function (x) { return x.id === id; })[0] || null; }
  function findNote(id) { return APP.data.notes.filter(function (x) { return x.id === id; })[0] || null; }
  function findTask(id) { return APP.data.tasks.filter(function (x) { return x.id === id; })[0] || null; }
  function findCase(id) { return APP.data.cases.filter(function (x) { return x.id === id; })[0] || null; }
  function topicName(id) { var t = findTopic(id); return t ? t.name : ''; }
  function itemTopicChips(item) {
    return item.topicIds.map(function (id) {
      var t = findTopic(id);
      return t ? '<span class="chip chipTeal">' + esc(t.name) + '</span>' : '';
    }).join('');
  }
  function notesFor(opts) {
    return APP.data.notes.filter(function (n) {
      if (opts.itemId && n.itemId !== opts.itemId) return false;
      if (opts.topicId && n.topicId !== opts.topicId) return false;
      if (opts.caseId && n.caseId !== opts.caseId) return false;
      return true;
    });
  }
  function tasksFor(opts) {
    return APP.data.tasks.filter(function (t) {
      if (opts.subjectType && t.subjectType !== opts.subjectType) return false;
      if (opts.subjectId && t.subjectId !== opts.subjectId) return false;
      return true;
    });
  }
  function caseTasks(c) {
    return APP.data.tasks.filter(function (t) { return c.taskIds.indexOf(t.id) >= 0 || (t.subjectType === 'case' && t.subjectId === c.id); });
  }

  /* ================================================================
     示例 / 演示数据（全部标记 demo:true）
     ================================================================ */
  function seedData() {
    var now = Date.now();
    var day = 86400000;
    var topics = [
      { id: 'tp-demo-cv', name: '2 型糖尿病 · 心血管结局', kind: 'disease', description: 'T2DM 患者的心血管风险、降糖药物心血管结局与指南推荐。', createdAt: now - 9 * day, updatedAt: now - day, demo: true },
      { id: 'tp-demo-met', name: 'Metformin 证据再评价', kind: 'drug', description: '二甲双胍的疗效、安全性、异质性与指南地位。', createdAt: now - 7 * day, updatedAt: now - 2 * day, demo: true },
      { id: 'tp-demo-glp1', name: 'GLP-1RA 与代谢', kind: 'drug', description: 'GLP-1 受体激动剂在糖尿病、肥胖与心血管结局中的证据。', createdAt: now - 5 * day, updatedAt: now - day, demo: true }
    ];
    var items = [
      {
        id: 'it-demo-pmed', title: 'Reappraisal of metformin efficacy in the treatment of type 2 diabetes: a meta-analysis of randomised controlled trials',
        type: 'Meta 分析', authors: ['Boussageon R', 'Bejan-Angoulvant T', 'Saadatian-Elahi M'], year: '2012', journal: 'PLoS Medicine',
        doi: '10.1371/journal.pmed.1001204', pmid: '22509138', abstract: 'The UK Prospective Diabetes Study showed that metformin decreases mortality compared to diet alone in overweight patients with type 2 diabetes mellitus. This meta-analysis of randomised controlled trials evaluated metformin efficacy against cardiovascular morbidity or mortality in patients with type 2 diabetes, and examined heterogeneity across trials.',
        url: 'https://doi.org/10.1371/journal.pmed.1001204', filePath: 'fixtures/sample-paper.pdf',
        source: { type: 'local', label: '示例：开放获取 PDF（PLOS，CC BY）', at: now - 6 * day },
        topicIds: ['tp-demo-met', 'tp-demo-cv'], tags: ['metformin', 'meta-analysis', 'T2DM', 'heterogeneity'],
        starred: true, readStatus: 'reading', addedAt: now - 6 * day, lastOpenedAt: now - 2 * 3600000,
        demo: true, sample: true
      },
      {
        id: 'it-demo-esc', title: '2023 ESC Guidelines for the management of cardiovascular disease in patients with diabetes',
        type: '指南', authors: ['ESC Scientific Document Group'], year: '2023', journal: 'European Heart Journal',
        doi: '10.1093/eurheartj/ehad192', pmid: '37622663', abstract: 'European Society of Cardiology clinical practice guidelines for the management of cardiovascular disease in patients with diabetes, covering risk assessment, glucose-lowering therapies with cardiovascular benefit, and multidisciplinary management.',
        url: 'https://doi.org/10.1093/eurheartj/ehad192',
        source: { type: 'manual', label: '演示数据 · 公开题录', at: now - 8 * day },
        topicIds: ['tp-demo-cv', 'tp-demo-glp1'], tags: ['ESC', '指南', 'SGLT2i', 'GLP-1RA'],
        starred: true, readStatus: 'read', addedAt: now - 8 * day, lastOpenedAt: now - 1 * day, demo: true
      },
      {
        id: 'it-demo-select', title: 'Semaglutide and Cardiovascular Outcomes in Obesity without Diabetes',
        type: '期刊文献', authors: ['Lincoff AM', 'Brown-Frandsen K', 'Colhoun HM'], year: '2023', journal: 'The New England Journal of Medicine',
        doi: '10.1056/NEJMoa2307563', pmid: '37952131', abstract: 'Semaglutide, a glucagon-like peptide-1 receptor agonist, was tested in patients with preexisting cardiovascular disease and overweight or obesity but without diabetes. This multicentre, double-blind, randomised, placebo-controlled trial evaluated cardiovascular outcomes with once-weekly subcutaneous semaglutide.',
        url: 'https://doi.org/10.1056/NEJMoa2307563',
        source: { type: 'manual', label: '演示数据 · 公开题录', at: now - 4 * day },
        topicIds: ['tp-demo-glp1', 'tp-demo-cv'], tags: ['semaglutide', 'obesity', 'MACE'],
        starred: false, readStatus: 'unread', addedAt: now - 4 * day, lastOpenedAt: 0, demo: true
      },
      {
        id: 'it-demo-dapa', title: 'Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction',
        type: '期刊文献', authors: ['McMurray JJV', 'Solomon SD', 'Inzucchi SE'], year: '2019', journal: 'The New England Journal of Medicine',
        doi: '10.1056/NEJMoa1911303', pmid: '31535829', abstract: 'In this phase 3, placebo-controlled trial, 4744 patients with New York Heart Association class II, III, or IV heart failure and an ejection fraction of 40% or less were randomly assigned to receive dapagliflozin 10 mg once daily or placebo, in addition to recommended therapy.',
        url: 'https://doi.org/10.1056/NEJMoa1911303',
        source: { type: 'manual', label: '演示数据 · 公开题录', at: now - 3 * day },
        topicIds: ['tp-demo-cv'], tags: ['SGLT2i', 'HFrEF', 'DAPA-HF'],
        starred: false, readStatus: 'unread', addedAt: now - 3 * day, lastOpenedAt: 0, demo: true
      },
      {
        id: 'it-demo-cn', title: '中国 2 型糖尿病防治指南（2020 年版）',
        type: '指南', authors: ['中华医学会糖尿病学分会'], year: '2021', journal: '中华糖尿病杂志',
        abstract: '中国 2 型糖尿病防治指南，覆盖诊断、生活方式干预、降糖药物治疗、心血管风险管理和并发症筛查。演示数据仅用于展示资料库结构。',
        source: { type: 'manual', label: '演示数据 · 手动登记', at: now - 10 * day },
        topicIds: ['tp-demo-cv'], tags: ['T2DM', '中国指南', 'HbA1c'],
        starred: false, readStatus: 'unread', addedAt: now - 10 * day, lastOpenedAt: 0, demo: true
      }
    ];
    var notes = [
      {
        id: 'nt-demo-1', body: '阅读计划：先核对纳入试验的数量、异质性与主要终点定义，再与 2023 ESC 指南中二甲双胍的定位对照。\n注意：这是演示笔记，不代表真实阅读结论。',
        itemId: 'it-demo-pmed', topicId: 'tp-demo-met', sourcePage: '', quote: '',
        origin: 'user', createdAt: now - 5 * day, updatedAt: now - 5 * day, demo: true
      },
      {
        id: 'nt-demo-2', body: '待核对：指南对 T2DM 合并 ASCVD 患者优先推荐哪类降糖药？证据等级与推荐类别分别是什么？',
        itemId: 'it-demo-esc', topicId: 'tp-demo-cv', sourcePage: '', quote: '',
        origin: 'user', createdAt: now - 2 * day, updatedAt: now - 2 * day, demo: true
      },
      {
        id: 'nt-demo-3', body: '专题假设：GLP-1RA 的心血管获益是否独立于降糖幅度？需要区分机制研究与结局试验。',
        itemId: '', topicId: 'tp-demo-glp1', sourcePage: '', quote: '',
        origin: 'user', createdAt: now - day, updatedAt: now - day, demo: true
      }
    ];
    var tasks = [
      {
        id: 'tk-demo-1', title: '核对二甲双胍 Meta 分析的异质性与终点定义', status: 'doing', priority: 'high',
        due: fmtDate(now + 2 * day), detail: '重点看 I²、随机效应模型与心血管死亡的合并结果。',
        subjectType: 'item', subjectId: 'it-demo-pmed', subjectLabel: 'Reappraisal of metformin efficacy…',
        createdAt: now - 4 * day, updatedAt: now - day, demo: true
      },
      {
        id: 'tk-demo-2', title: '整理 2023 ESC 指南的降糖药物推荐表', status: 'todo', priority: 'med',
        due: fmtDate(now + 5 * day), detail: '按合并 ASCVD / HF / CKD 分层，记录推荐类别与证据等级。',
        subjectType: 'topic', subjectId: 'tp-demo-cv', subjectLabel: '2 型糖尿病 · 心血管结局',
        createdAt: now - 3 * day, updatedAt: now - 3 * day, demo: true
      },
      {
        id: 'tk-demo-3', title: '为演示病例补充鉴别诊断资料', status: 'todo', priority: 'med',
        due: fmtDate(now + 1 * day), detail: '仅使用资料库中已有文献，不自动上传病例全文。',
        subjectType: 'case', subjectId: 'cs-demo-1', subjectLabel: '演示病例：反复胸闷 3 个月',
        createdAt: now - 2 * day, updatedAt: now - 2 * day, demo: true
      },
      {
        id: 'tk-demo-4', title: '删除或替换演示数据', status: 'done', priority: 'low',
        due: fmtDate(now - day), detail: '在「连接与数据」中可一键清除全部演示数据。',
        subjectType: 'none', subjectId: '', subjectLabel: '',
        createdAt: now - 6 * day, updatedAt: now - day, demo: true
      }
    ];
    var cases = [
      {
        id: 'cs-demo-1', code: 'DEMO-2026-001', title: '演示病例：反复胸闷 3 个月',
        chief: '反复胸闷 3 个月，加重 1 周。',
        present: '患者 58 岁男性（虚构），3 个月前开始活动后胸闷，休息数分钟缓解；近 1 周发作频率增加。无晕厥，无持续胸痛。',
        past: '2 型糖尿病 8 年，二甲双胍 + 格列美脲治疗；高血压 5 年。否认吸烟。',
        exams: '血压 148/92 mmHg；BMI 27.4；HbA1c 8.1%；LDL-C 3.2 mmol/L；肌酐 88 µmol/L；心电图示窦性心律，未见急性 ST 段改变（演示数据，非真实检查）。',
        questions: '1. 该患者胸闷的鉴别诊断与下一步检查优先级？\n2. 合并 ASCVD 风险的 T2DM 患者，降糖方案如何调整？\n3. 现有证据中，哪些结局试验可支持治疗决策？',
        keywords: 'type 2 diabetes cardiovascular risk chest pain',
        aiSummary: '',
        itemIds: ['it-demo-esc', 'it-demo-dapa'],
        taskIds: ['tk-demo-3'],
        createdAt: now - 2 * day, updatedAt: now - 2 * day, demo: true
      }
    ];
    return {
      version: 1,
      updatedAt: now,
      seeded: true,
      settings: { fontSize: 14, lastSection: 'home' },
      items: items,
      topics: topics,
      notes: notes,
      tasks: tasks,
      cases: cases,
      searches: []
    };
  }

  /* ================================================================
     持久化：本地桥接 → 工作台项目文件 → 浏览器
     ================================================================ */
  function readLocalState() {
    try {
      var raw = localStorage.getItem(projectStorageKey(LS_KEY));
      if (!raw) {
        APP.legacyCacheUnassigned = Boolean(localStorage.getItem(LS_KEY));
        return null;
      }
      var parsed = safeJsonParse(raw);
      return parsed ? normalizeState(parsed) : null;
    } catch (e) { return null; }
  }
  function writeLocalState() {
    try { localStorage.setItem(projectStorageKey(LS_KEY), JSON.stringify(APP.data)); } catch (e) {}
  }
  function setSaveMode(mode, error) {
    APP.save.mode = mode;
    APP.save.at = Date.now();
    APP.save.error = error || '';
    APP.save.saving = false;
    renderHead();
    updateSaveBanner();
  }
  var saveChain = Promise.resolve();
  function saveNow(reason) {
    if (!APP.data) return Promise.resolve(false);
    APP.data.updatedAt = Date.now();
    writeLocalState();
    APP.save.saving = true;
    APP.save.error = '';
    renderHead();
    var stamp = APP.data.updatedAt;
    var payload = JSON.stringify(APP.data, null, 2);
    var run = function () { return doSave(payload, stamp); };
    saveChain = saveChain.then(run, run);
    return saveChain;
  }
  function doSave(payload, stamp) {
    var data = JSON.parse(payload);
    var bridgeTry = APP.bridge.online
      ? fetchJsonNice(APP.bridge.url + '/data/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: data })
        }, 12000).then(function (r) {
          if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
          return true;
        })
      : Promise.reject(new Error('桥接未连接'));
    return bridgeTry
      .then(function () {
        setSaveMode('bridge');
        if (APP.data.updatedAt <= stamp) APP.save.dirty = false;
        else saveSoon();
        return true;
      })
      .catch(function (bridgeErr) {
        var file = dataFilePath();
        if (!file) throw bridgeErr;
        return ensureDataDir().then(function () {
          return fetchJsonNice('/api/worktable/write', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: file, content: payload })
          }, 15000);
        }).then(function (r) {
          if (!r.ok) throw new Error((r.json && r.json.error) || ('写入失败 HTTP ' + r.status));
          setSaveMode('worktable');
          if (APP.data.updatedAt <= stamp) APP.save.dirty = false;
          else saveSoon();
          return true;
        });
      })
      .catch(function (err) {
        setSaveMode('local', apiErrorMessage(err));
        APP.save.dirty = true;
        updateSaveBanner();
        return false;
      });
  }
  var saveSoon = debounce(function () { saveNow('debounce'); }, 700);
  function markDirty(opts) {
    opts = opts || {};
    APP.data.updatedAt = Date.now();
    writeLocalState();
    APP.save.dirty = true;
    APP.save.saving = true;
    renderHead();
    updateSaveBanner();
    if (opts.immediate) saveNow('immediate');
    else saveSoon();
  }
  var dataDirEnsured = false;
  function ensureDataDir() {
    if (dataDirEnsured) return Promise.resolve(true);
    var dir = projectDir();
    if (!dir) return Promise.resolve(false);
    return fetchJsonNice('/api/worktable/mkdir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: joinPath(dir, 'data') })
    }, 8000).then(function () {
      dataDirEnsured = true;
      return true;
    }).catch(function () { return false; });
  }
  function probeBridge() {
    APP.bridge.probing = true;
    return fetchJsonNice(APP.bridge.url + '/health', {}, 2600)
      .then(function (r) {
        if (!r.ok || !bridgeIdentityMatches(r.json)) throw new Error('本地服务身份或项目目录不匹配，已停止使用该服务');
        APP.bridge.online = true;
        APP.bridge.verifiedUrl = APP.bridge.url;
        APP.bridge.health = r.json;
        APP.bridge.error = '';
        APP.bridge.checkedAt = Date.now();
        return true;
      })
      .catch(function (err) {
        APP.bridge.online = false;
        APP.bridge.verifiedUrl = '';
        APP.bridge.health = null;
        APP.bridge.error = err.name === 'AbortError' ? '连接超时' : apiErrorMessage(err);
        APP.bridge.checkedAt = Date.now();
        return false;
      })
      .finally(function () {
        APP.bridge.probing = false;
        renderHead();
      });
  }
  function ensureLocalService() {
    return fetchJsonNice('/api/medresearch/model/service/ensure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }, 60000).then(function (r) {
      var bridge = r && r.json && r.json.bridge;
      if (!r.ok || !bridge || !bridge.online || !bridgeIdentityMatches(bridge.health)) {
        throw new Error((bridge && bridge.error) || (r.json && r.json.error && r.json.error.message) || '本地文件服务未启动');
      }
      if (bridge.url) APP.bridge.url = bridge.url;
      localStorage.setItem(projectStorageKey(LS_BRIDGE_KEY), APP.bridge.url);
      APP.bridge.health = bridge.health;
      APP.bridge.online = true;
      APP.bridge.verifiedUrl = APP.bridge.url;
      APP.bridge.error = '';
      APP.bridge.note = bridge.note || '';
      return bridge;
    }).catch(function (err) {
      APP.bridge.online = false;
      APP.bridge.verifiedUrl = '';
      APP.bridge.error = '本地文件服务未启动：' + apiErrorMessage(err);
      return null;
    });
  }
  async function bootData() {
    var local = readLocalState();
    var candidates = [];
    if (local) candidates.push({ data: local, source: 'local', at: local.updatedAt || 0 });
    var worktable = null;
    var file = dataFilePath();
    if (file) {
      try {
        var r = await fetchJsonNice('/api/worktable/file?path=' + encodeURIComponent(file), {}, 5000);
        if (r.ok && r.json && r.json.version === 1) {
          worktable = normalizeState(r.json);
          candidates.push({ data: worktable, source: 'worktable', at: worktable.updatedAt || 0 });
        }
      } catch (e) {}
    }
    await probeBridge();
    if (!APP.bridge.online && !APP.bridge.autoStartTried) {
      APP.bridge.autoStartTried = true;
      await ensureLocalService();
      await probeBridge();
    }
    var bridgeData = null;
    if (APP.bridge.online) {
      try {
        var br = await fetchJsonNice(APP.bridge.url + '/data/load', {}, 6000);
        if (br.ok && br.json && br.json.version === 1) {
          bridgeData = normalizeState(br.json);
          candidates.push({ data: bridgeData, source: 'bridge', at: bridgeData.updatedAt || 0 });
        }
      } catch (e) {}
    }
    var chosen = null;
    candidates.forEach(function (c) { if (!chosen || c.at > chosen.at) chosen = c; });
    if (chosen) {
      APP.data = chosen.data;
      APP.source = chosen.source;
      APP.data.seeded = true;
      APP.save.mode = chosen.source === 'bridge' ? 'bridge' : chosen.source === 'worktable' ? 'worktable' : 'local';
      APP.save.at = chosen.at || Date.now();
      APP.save.dirty = false;
    } else {
      APP.data = emptyState();
      APP.source = 'new';
      markDirty({ immediate: true });
    }
    APP.data.settings.fontSize = clamp(num(APP.data.settings.fontSize, 14), 12, 22);
    applyFontSize();
    // 浏览器数据比文件新时，启动后补写文件，避免两处不一致。
    if (chosen && chosen.source === 'local' && (APP.bridge.online || file)) {
      saveNow('boot-sync');
    }
    if (chosen && chosen.source === 'worktable' && APP.bridge.online && bridgeData && bridgeData.updatedAt < chosen.at) {
      saveNow('boot-sync-bridge');
    }
  }

  /* ================================================================
     顶栏 / 导航 / 字体
     ================================================================ */
  function saveLabel() {
    if (APP.save.saving) return '保存中…';
    if (APP.save.mode === 'bridge') return '已存本机文件';
    if (APP.save.mode === 'worktable') return '已存项目文件';
    return '仅存浏览器';
  }
  function saveClass() {
    if (APP.save.saving) return 'warn';
    if (APP.save.mode === 'bridge' || APP.save.mode === 'worktable') return 'ok';
    return 'bad';
  }
  function renderHead() {
    var host = $('#headRight');
    if (!host) return;
    var z = APP.bridge.online && APP.bridge.health && APP.bridge.health.zotero;
    var zOk = z && z.connected;
    var biomcp = APP.bridge.online && APP.bridge.health && APP.bridge.health.search && APP.bridge.health.search.biomcp;
    var html = '';
    html += '<span class="statusChip keep ' + saveClass() + ' click" data-act="settings" data-tab="data" title="' + esc(APP.save.error || saveLabel()) + '"><span class="dot"></span>' + esc(saveLabel()) + '</span>';
    html += '<span class="statusChip ' + (APP.bridge.online ? 'ok' : 'bad') + ' click" data-act="settings" data-tab="conn" title="' + esc(APP.bridge.online ? '已连接 ' + APP.bridge.url : (APP.bridge.error || '本地文件服务未启动')) + '"><span class="dot"></span>' + (APP.bridge.online ? '本地文件服务' : '本地服务未启动') + '</span>';
    html += '<span class="statusChip keep warn click" data-act="addZotero" title="' + esc(zOk ? 'Zotero 本地 API 已连接（只读）' : 'Zotero 是可选来源；未连接不影响本地 PDF') + '"><span class="dot"></span>' + (zOk ? 'Zotero 已连接' : '连接 Zotero（可选）') + '</span>';
    html += (typeof modelChipHtml === 'function' ? modelChipHtml() : '');
    if (biomcp && !biomcp.installed) {
      html += '<span class="statusChip warn click" data-act="settings" data-tab="conn" title="' + esc(biomcp.note || 'BioMCP 未就绪；当前使用公开数据源备用检索，点击查看原因') + '"><span class="dot"></span>BioMCP 未就绪</span>';
    } else if (biomcp && biomcp.installed) {
      html += '<span class="statusChip ok click" data-act="settings" data-tab="conn" title="本地程序可运行；实际检索来源与网络状态以每次结果为准"><span class="dot"></span>BioMCP ' + esc(biomcp.version || '') + '</span>';
    }
    html += '<button type="button" class="iconBtn" data-act="fontDec" title="正文减小字号" aria-label="减小字号">A-</button>';
    html += '<button type="button" class="iconBtn" data-act="fontInc" title="正文增大字号" aria-label="增大字号">A+</button>';
    html += '<button type="button" class="iconBtn" data-act="settings" data-tab="conn" title="连接与数据设置" aria-label="设置">⚙</button>';
    host.innerHTML = html;
  }
  function renderNav() {
    var counts = {
      library: APP.data.items.length,
      reader: APP.data.items.filter(function (x) { return x.readStatus !== 'read'; }).length,
      search: 0,
      cases: APP.data.cases.length,
      tasks: APP.data.tasks.filter(function (t) { return t.status !== 'done'; }).length
    };
    var html = '<div class="navLabel">研究工作流</div>';
    SECTIONS.forEach(function (s) {
      var on = APP.section === s.id;
      var count = counts[s.id];
      html += '<button type="button" class="navItem ' + (on ? 'navItemOn' : '') + '" data-act="nav" data-section="' + s.id + '" aria-current="' + (on ? 'page' : 'false') + '">' + ICON[s.icon] + '<span>' + esc(s.label) + '</span>' + (count ? '<span class="navCount">' + count + '</span>' : '') + '</button>';
    });
    html += '<div class="railFoot"><b>数据</b> 本机文件 / 项目文件<br><b>检索</b> 公开上游 · 只读<br><b>版本</b> ' + VERSION + '</div>';
    $('#navRail').innerHTML = html;
    var tabs = SECTIONS.map(function (s) {
      return '<button type="button" class="topTab ' + (APP.section === s.id ? 'topTabOn' : '') + '" data-act="nav" data-section="' + s.id + '">' + esc(s.label) + '</button>';
    }).join('');
    $('#topTabs').innerHTML = tabs;
  }
  function setSection(section) {
    if (!SECTIONS.some(function (s) { return s.id === section; })) return;
    if (typeof flushCaseForm === 'function') flushCaseForm();
    APP.section = section;
    APP.data.settings.lastSection = section;
    writeLocalState();
    navigateHash();
    renderNav();
    render();
    var view = $('#view');
    if (view) view.scrollTop = 0;
  }
  function applyFontSize() {
    var size = clamp(num(APP.data && APP.data.settings && APP.data.settings.fontSize, 14), 12, 22);
    document.documentElement.style.setProperty('--readerFont', size + 'px');
  }
  function changeFont(delta) {
    APP.data.settings.fontSize = clamp(num(APP.data.settings.fontSize, 14) + delta, 12, 22);
    applyFontSize();
    writeLocalState();
    markDirty();
    toast('正文字号 ' + APP.data.settings.fontSize + 'px');
  }

  /* ================================================================
     路由（hash）与渲染入口
     ================================================================ */
  function navigateHash() {
    var h = '#' + APP.section;
    if (APP.section === 'reader' && APP.route.itemId) h = '#reader/' + encodeURIComponent(APP.route.itemId);
    else if (APP.section === 'library' && APP.route.topicId) h = '#library/topic/' + encodeURIComponent(APP.route.topicId);
    else if (APP.section === 'cases' && APP.route.caseId) h = '#cases/' + encodeURIComponent(APP.route.caseId);
    try { history.replaceState(null, '', h); } catch (e) {}
  }
  function applyHash() {
    var raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return;
    var seg = raw.split('/');
    var section = seg[0];
    if (!SECTIONS.some(function (s) { return s.id === section; })) return;
    APP.section = section;
    APP.route = { section: section };
    if (section === 'reader' && seg[1]) APP.route.itemId = decodeURIComponent(seg[1]);
    if (section === 'library' && seg[1] === 'topic' && seg[2]) { APP.section = 'library'; APP.route.topicId = decodeURIComponent(seg[2]); }
    if (section === 'cases' && seg[1]) APP.route.caseId = decodeURIComponent(seg[1]);
  }
  function render() {
    renderNav();
    var view = $('#view');
    if (!view) return;
    var html = '';
    try {
      if (APP.section === 'home') html = renderHome();
      else if (APP.section === 'library') html = APP.route.topicId ? renderTopicPage() : renderLibrary();
      else if (APP.section === 'reader') html = renderReader();
      else if (APP.section === 'search') html = renderSearch();
      else if (APP.section === 'cases') html = APP.route.caseId ? renderCasePage() : renderCases();
      else if (APP.section === 'tasks') html = renderTasks();
      else html = renderHome();
    } catch (err) {
      html = '<div class="page"><div class="banner bannerBad"><div class="grow"><b>界面渲染出错</b><br>' + esc(err && err.message) + '</div><button class="btn btnMini" data-act="reload">刷新窗口</button></div></div>';
      console.error('[medwb] render failed', err);
    }
    view.innerHTML = html;
    afterRender();
  }
  function afterRender() {
    if (APP.section === 'reader') {
      if (READER.pdf && READER.status === 'ready') requestAnimationFrame(function () { renderPdfPage(READER.page, false); });
      else if (READER.itemId && !READER.pdf && !READER.loading && READER.status === 'idle') tryOpenReaderItem(READER.itemId);
    }
  }

  /* ================================================================
     弹窗 / 抽屉 / 提示
     ================================================================ */
  function openModal(cfg) {
    var mask = $('#modalMask');
    $('#modalTitle').textContent = cfg.title || '编辑';
    $('#modalBody').innerHTML = cfg.body || '';
    $('#modalSubmit').textContent = cfg.submitLabel || '保存';
    $('#modalSubmit').hidden = cfg.hideSubmit === true;
    $('#modalDanger').hidden = !cfg.onDelete;
    $('#modalDanger').textContent = cfg.deleteLabel || '删除';
    APP.modal.onSubmit = cfg.onSubmit || null;
    APP.modal.onDelete = cfg.onDelete || null;
    APP.modal.busy = false;
    mask.hidden = false;
    var first = mask.querySelector('input,textarea,select,button');
    if (first && cfg.focus !== false) setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
  }
  function closeModal() {
    $('#modalMask').hidden = true;
    APP.modal.onSubmit = null;
    APP.modal.onDelete = null;
    APP.modelSettingsOpen = false;
  }
  function openDrawer(type, id) {
    APP.drawer.type = type;
    APP.drawer.id = id;
    $('#overlay').hidden = false;
    $('#drawer').hidden = false;
    renderDrawer();
  }
  function closeDrawer() {
    APP.drawer.type = '';
    APP.drawer.id = '';
    $('#overlay').hidden = true;
    $('#drawer').hidden = true;
  }
  function renderDrawer() {
    if (!APP.drawer.type) return;
    var body = $('#drawerBody');
    var foot = $('#drawerFoot');
    if (APP.drawer.type === 'item') {
      var item = findItem(APP.drawer.id);
      if (!item) { closeDrawer(); return; }
      $('#drawerTitle').textContent = item.title;
      body.innerHTML = itemDetailHtml(item);
      foot.innerHTML = '<button class="btn btnPrimary" data-act="read" data-id="' + item.id + '">打开阅读台</button><button class="btn" data-act="noteNew" data-item="' + item.id + '">新增笔记</button><button class="btn" data-act="taskNew" data-subject="item" data-subjectid="' + item.id + '">创建任务</button>';
    }
  }

  /* ================================================================
     事件委托
     ================================================================ */
  function onAction(act, el, ev) {
    var id = el.getAttribute('data-id') || '';
    switch (act) {
      case 'nav': setSection(el.getAttribute('data-section')); break;
      case 'settings': openSettings(el.getAttribute('data-tab') || 'conn'); break;
      case 'modelSettings': openModelSettings(); break;
      case 'modelMode': setModelMode(el.getAttribute('data-mode')); break;
      case 'modelSave': modelSave(); break;
      case 'modelTest': modelTest(); break;
      case 'modelClear': modelClear(); break;
      case 'modelClearKey': modelClearKey(); break;
      case 'modelRefresh': modelRefresh({ force: true, paint: true }); break;
      case 'fontInc': changeFont(1); break;
      case 'fontDec': changeFont(-1); break;
      case 'reload': location.reload(); break;
      case 'closeDrawer': closeDrawer(); break;
      case 'closeModal': closeModal(); break;
      case 'setRead': setReadStatus(id, el.getAttribute('data-status')); break;
      case 'star': toggleStar(id); break;
      case 'read': openReader(id); break;
      case 'openItem': openDrawer('item', id); break;
      case 'noteNew': openNoteModal({ itemId: el.getAttribute('data-item') || '', topicId: el.getAttribute('data-topic') || '', caseId: el.getAttribute('data-case') || '', quote: el.getAttribute('data-quote') || '', page: el.getAttribute('data-page') || '' }); break;
      case 'noteEdit': openNoteModal({ id: id }); break;
      case 'noteDelete': deleteNote(id); break;
      case 'taskNew': openTaskModal({ subjectType: el.getAttribute('data-subject') || 'none', subjectId: el.getAttribute('data-subjectid') || '', subjectLabel: el.getAttribute('data-subjectlabel') || '' }); break;
      case 'taskEdit': openTaskModal({ id: id }); break;
      case 'taskDelete': deleteTask(id); break;
      case 'taskCycle': cycleTaskStatus(id); break;
      case 'taskStatus': setTaskStatus(id, el.getAttribute('data-status')); break;
      case 'openTaskLink': openTaskLink(id); break;
      case 'openTopic': openTopic(el.getAttribute('data-topic')); break;
      case 'openCase': openCase(el.getAttribute('data-case')); break;
      case 'topicNew': openTopicModal({}); break;
      case 'topicEdit': openTopicModal({ id: id }); break;
      case 'topicDelete': deleteTopic(id); break;
      case 'itemEdit': openItemModal({ id: id }); break;
      case 'itemDelete': deleteItem(id); break;
      case 'addItem': openAddMenu(el.getAttribute('data-topic') || ''); break;
      case 'addZotero': openZoteroModal(el.getAttribute('data-topic') || ''); break;
      case 'addLocal': openLocalFileModal(el.getAttribute('data-topic') || ''); break;
      case 'addManual': openItemModal({ topicId: el.getAttribute('data-topic') || '' }); break;
      case 'demoClear': clearDemoData(); break;
      case 'demoAdd': addDemoData(); break;
      case 'exportBackup': exportBackup(); break;
      case 'importBackup': $('#fileImport').click(); break;
      case 'retrySave': saveNow('retry'); break;
      case 'testBridge': testBridgeSetting(); break;
      case 'ensureBridge': toast('正在启动本地文件服务…'); ensureLocalService().then(function (bridge) { if (bridge) { probeBridge(); toast('本地文件服务已就绪'); } else { toast(APP.bridge.error || '本地文件服务启动失败'); } }); break;
      case 'saveBridgeUrl': saveBridgeSetting(); break;
      case 'copyStartCmd': copyStartCommand(); break;
      case 'openStartFolder': openStartFolder(); break;
      case 'locateNote': locateNote(id); break;
      case 'locatePage': locatePage(el.getAttribute('data-page')); break;
      case 'readerTab': setReaderTab(el.getAttribute('data-tab')); break;
      case 'readerSelect': selectReaderItem(id); break;
      case 'readerPrev': pageStep(-1); break;
      case 'readerNext': pageStep(1); break;
      case 'zoomIn': zoomStep(0.12); break;
      case 'zoomOut': zoomStep(-0.12); break;
      case 'zoomFit': toggleFit(); break;
      case 'toggleDocList': $('#readerShell').classList.toggle('readerShowList'); break;
      case 'toggleAside': toggleReaderAside(); break;
      case 'reloadPdf': reloadPdf(); break;
      case 'saveSelectionNote': saveSelectionNote(); break;
      case 'saveSelectionHighlight': saveSelectionHighlight(); break;
      case 'explainSelection': explainSelection(); break;
      case 'clearSelection': hideSelectionBar(); break;
      case 'askPaper': askPaperQuestion(); break;
      case 'askSuggestion': setAskInput(el.getAttribute('data-q')); break;
      case 'sendNative': sendReaderToNative(); break;
      case 'pasteFulltext': openPasteFulltextModal(); break;
      case 'openPdfFile': openPdfFile(); break;
      case 'deleteAnnotation': deleteAnnotation(id); break;
      case 'locateAnnotation': locateAnnotation(id); break;
      case 'searchTab': setSearchTab(el.getAttribute('data-tab')); break;
      case 'runSearch': runSearch(); break;
      case 'searchHistory': applySearchHistory(el.getAttribute('data-query')); break;
      case 'addSearchResult': addSearchResult(el.getAttribute('data-kind'), num(el.getAttribute('data-index'), 0)); break;
      case 'searchResultTopic': addSearchResultToTopic(el.getAttribute('data-kind'), num(el.getAttribute('data-index'), 0)); break;
      case 'searchResultTask': searchResultTask(el.getAttribute('data-kind'), num(el.getAttribute('data-index'), 0)); break;
      case 'starSearchResult': starSearchResult(el.getAttribute('data-kind'), num(el.getAttribute('data-index'), 0)); break;
      case 'caseNew': newCase(); break;
      case 'caseOpen': openCase(id); break;
      case 'caseSave': saveCaseForm(); break;
      case 'caseDelete': deleteCase(id); break;
      case 'caseBack': backToCases(); break;
      case 'caseAi': organizeCaseWithAi(); break;
      case 'caseNative': sendCaseToNative(); break;
      case 'caseSearch': caseToSearch(); break;
      case 'caseLinkItem': openCaseItemPicker(); break;
      case 'caseUnlinkItem': unlinkCaseItem(el.getAttribute('data-item')); break;
      case 'caseNoteNew': openNoteModal({ caseId: id }); break;
      case 'taskBoard': setTaskFilter('status', el.getAttribute('data-status')); break;
      case 'taskNewTop': openTaskModal({}); break;
      case 'openExternal': openExternal(el.getAttribute('data-url')); break;
      case 'copyText': copyFromData(el); break;
      case 'closeSelBar': hideSelectionBar(); break;
      case 'settingsTab': switchSettingsTab(el.getAttribute('data-tab')); break;
      case 'refreshConnections': refreshConnections(); break;
      case 'openLicense': openLicenses(); break;
      default: break;
    }
  }
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (!act) return;
    if (act === 'closeModal') return;
    if (el.tagName === 'A') ev.preventDefault();
    onAction(act, el, ev);
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#overlay').addEventListener('click', function () { closeDrawer(); hideSelectionBar(); });
  $('#modalForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (APP.modal.busy) return;
    if (!APP.modal.onSubmit) { closeModal(); return; }
    var result = APP.modal.onSubmit(new FormData(ev.target));
    if (result === false) return;
    if (result && typeof result.then === 'function') {
      APP.modal.busy = true;
      $('#modalSubmit').disabled = true;
      result.then(function (keep) {
        if (keep !== true) closeModal();
      }).catch(function (err) {
        toast('操作失败：' + apiErrorMessage(err));
      }).finally(function () {
        APP.modal.busy = false;
        $('#modalSubmit').disabled = false;
      });
    } else {
      closeModal();
    }
  });
  $('#modalDanger').addEventListener('click', function () {
    if (!APP.modal.onDelete) return;
    var r = APP.modal.onDelete();
    if (r && typeof r.then === 'function') r.catch(function (err) { toast('删除失败：' + apiErrorMessage(err)); });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!$('#modalMask').hidden) closeModal();
      else if (!$('#drawer').hidden) closeDrawer();
      hideSelectionBar();
    }
  });
  window.addEventListener('hashchange', function () {
    applyHash();
    APP.section = APP.route.section;
    renderNav();
    render();
  });

  /* ================================================================
     通用动作
     ================================================================ */
  function openReader(id) {
    var item = findItem(id);
    if (!item) return;
    if (typeof flushCaseForm === 'function') flushCaseForm();
    if (READER.pdf) { try { READER.pdf.destroy(); } catch (e) {} }
    APP.route.itemId = id;
    APP.section = 'reader';
    READER.itemId = id;
    READER.pdf = null;
    READER.docToken++;
    READER.status = 'idle';
    READER.error = '';
    READER.page = 1;
    READER.textChunks = [];
    READER.pageTextCache = {};
    READER.loading = false;
    item.lastOpenedAt = Date.now();
    if (item.readStatus === 'unread') item.readStatus = 'reading';
    markDirty();
    closeDrawer();
    navigateHash();
    renderNav();
    render();
  }
  function setReadStatus(id, status) {
    var item = findItem(id);
    if (!item || !READ_STATUS[status]) return;
    item.readStatus = status;
    item.updatedAt = Date.now();
    markDirty();
    render();
    if (APP.drawer.id === id) renderDrawer();
  }
  function toggleStar(id) {
    var item = findItem(id);
    if (!item) return;
    item.starred = !item.starred;
    item.updatedAt = Date.now();
    markDirty();
    render();
    if (APP.drawer.id === id) renderDrawer();
  }
  function deleteItem(id) {
    var item = findItem(id);
    if (!item) return;
    if (!window.confirm('删除资料「' + truncate(item.title, 40) + '」？关联笔记会保留，但不再有资料关联。')) return;
    APP.data.items = APP.data.items.filter(function (x) { return x.id !== id; });
    APP.data.notes.forEach(function (n) { if (n.itemId === id) n.itemId = ''; });
    APP.data.tasks.forEach(function (t) { if (t.subjectType === 'item' && t.subjectId === id) { t.subjectType = 'none'; t.subjectId = ''; } });
    APP.data.cases.forEach(function (c) { c.itemIds = c.itemIds.filter(function (x) { return x !== id; }); });
    markDirty({ immediate: true });
    closeDrawer();
    render();
    toast('已删除资料');
  }
  function deleteNote(id) {
    if (!window.confirm('删除这条笔记？')) return;
    APP.data.notes = APP.data.notes.filter(function (n) { return n.id !== id; });
    APP.data.tasks.forEach(function (t) { if (t.subjectType === 'note' && t.subjectId === id) { t.subjectType = 'none'; t.subjectId = ''; } });
    markDirty({ immediate: true });
    render();
    toast('已删除笔记');
  }
  function deleteTask(id) {
    if (!window.confirm('删除这个任务？')) return;
    APP.data.tasks = APP.data.tasks.filter(function (t) { return t.id !== id; });
    APP.data.cases.forEach(function (c) { c.taskIds = c.taskIds.filter(function (x) { return x !== id; }); });
    markDirty({ immediate: true });
    render();
    toast('已删除任务');
  }
  function deleteTopic(id) {
    var t = findTopic(id);
    if (!t) return;
    if (!window.confirm('删除专题「' + t.name + '」？资料本身不会被删除。')) return;
    APP.data.topics = APP.data.topics.filter(function (x) { return x.id !== id; });
    APP.data.items.forEach(function (it) { it.topicIds = it.topicIds.filter(function (x) { return x !== id; }); });
    APP.data.notes.forEach(function (n) { if (n.topicId === id) n.topicId = ''; });
    APP.data.tasks.forEach(function (tk) { if (tk.subjectType === 'topic' && tk.subjectId === id) { tk.subjectType = 'none'; tk.subjectId = ''; } });
    if (APP.route.topicId === id) APP.route.topicId = '';
    markDirty({ immediate: true });
    render();
    toast('已删除专题');
  }
  function openTopic(id) {
    var t = findTopic(id);
    if (!t) return;
    if (typeof flushCaseForm === 'function') flushCaseForm();
    APP.section = 'library';
    APP.route.topicId = id;
    APP.ui.library.tab = 'topics';
    navigateHash();
    renderNav();
    render();
  }
  function openCase(id) {
    if (!findCase(id)) return;
    if (typeof flushCaseForm === 'function' && APP.route.caseId !== id) flushCaseForm();
    APP.section = 'cases';
    APP.route.caseId = id;
    navigateHash();
    renderNav();
    render();
  }
  function backToCases() {
    if (typeof flushCaseForm === 'function') flushCaseForm();
    APP.route.caseId = '';
    APP.section = 'cases';
    navigateHash();
    render();
  }
  function openTaskLink(id) {
    var t = findTask(id);
    if (!t) return;
    if (t.subjectType === 'item' && findItem(t.subjectId)) return openReader(t.subjectId);
    if (t.subjectType === 'topic' && findTopic(t.subjectId)) return openTopic(t.subjectId);
    if (t.subjectType === 'case' && findCase(t.subjectId)) return openCase(t.subjectId);
    if (t.subjectUrl) return openExternal(t.subjectUrl);
    toast('这个任务没有可打开的关联内容');
  }
  function openExternal(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }
  async function copyFromData(el) {
    var text = el.getAttribute('data-copy') || '';
    var ok = await copyText(text);
    toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本');
  }
  function hideSelectionBar() {
    var bar = $('#selBar');
    if (bar) bar.remove();
    var sel = window.getSelection();
    if (sel) { try { sel.removeAllRanges(); } catch (e) {} }
    APP.selection = null;
    READER.selection = null;
  }



