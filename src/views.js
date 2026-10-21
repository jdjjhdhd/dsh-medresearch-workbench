  /* ================================================================
     状态条 / 保存失败提示
     ================================================================ */
  function updateSaveBanner() {
    var show = APP.save.mode === 'local' || !!APP.save.error;
    var el = $('#saveWarn');
    if (!show) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'saveWarn';
      el.className = 'saveWarn';
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="dot"></span><span class="grow">' + (APP.save.error
      ? '保存到文件失败：' + esc(APP.save.error) + '。内容已保留在浏览器，可重试。'
      : '当前仅保存在浏览器（未写入项目文件）。启动本地服务或检查权限后可写入文件。') + '</span><button type="button" class="btn btnMini" data-act="retrySave">重试保存</button>';
  }
  function saveModeText() {
    if (APP.save.mode === 'bridge') return '本机数据文件（桥接）';
    if (APP.save.mode === 'worktable') return '工作台项目文件';
    return '浏览器 localStorage';
  }
  function bridgeStatusChip() {
    if (APP.bridge.probing) return '<span class="statusChip warn"><span class="dot"></span>检测中</span>';
    return APP.bridge.online
      ? '<span class="statusChip ok"><span class="dot"></span>已连接</span>'
      : '<span class="statusChip bad"><span class="dot"></span>未连接</span>';
  }
  function zoteroStatusChip() {
    var z = APP.bridge.online && APP.bridge.health && APP.bridge.health.zotero;
    if (!APP.bridge.online) return '<span class="statusChip"><span class="dot"></span>需本地服务</span>';
    if (!z) return '<span class="statusChip warn"><span class="dot"></span>未知</span>';
    return z.connected
      ? '<span class="statusChip ok"><span class="dot"></span>已连接</span>'
      : '<span class="statusChip warn"><span class="dot"></span>未检测到</span>';
  }
  function modelStatusChip() {
    var m = APP.model || {};
    if (m.host === false) return '<span class="statusChip bad click" data-act="modelSettings"><span class="dot"></span>宿主接口不可用</span>';
    if (m.mode === 'custom') {
      var c = m.custom || {};
      return c.hasKey && c.model
        ? '<span class="statusChip ok click" data-act="modelSettings"><span class="dot"></span>自定义 API · ' + esc(c.model) + '</span>'
        : '<span class="statusChip warn click" data-act="modelSettings"><span class="dot"></span>自定义 API 未配置</span>';
    }
    var d = m.dsh || {};
    return d.available
      ? '<span class="statusChip ok click" data-act="modelSettings"><span class="dot"></span>' + esc(d.source === 'session' ? '跟随会话 · ' + d.model : 'DSH 默认模型 · ' + d.model) + '</span>'
      : '<span class="statusChip warn click" data-act="modelSettings"><span class="dot"></span>DSH 模型未配置</span>';
  }
  function biomcpStatusChip() {
    var b = APP.bridge.online && APP.bridge.health && APP.bridge.health.search && APP.bridge.health.search.biomcp;
    if (b && b.installed) return '<span class="statusChip ok"><span class="dot"></span>BioMCP ' + esc(b.version || '') + ' 可运行</span>';
    if (!APP.bridge.online) return '<span class="statusChip"><span class="dot"></span>页面直连上游</span>';
    return '<span class="statusChip warn"><span class="dot"></span>' + (b && b.found ? 'BioMCP 启动失败' : 'BioMCP 未找到') + ' · 备用检索</span>';
  }

  /* ================================================================
     通用片段
     ================================================================ */
  function demoCount() {
    return APP.data.items.filter(function (x) { return x.demo; }).length +
      APP.data.topics.filter(function (x) { return x.demo; }).length +
      APP.data.notes.filter(function (x) { return x.demo; }).length +
      APP.data.tasks.filter(function (x) { return x.demo; }).length +
      APP.data.cases.filter(function (x) { return x.demo; }).length;
  }
  function demoBanner() {
    var n = demoCount();
    if (!n) return '';
    return '<div class="banner bannerWarn"><div class="grow"><b>当前含演示数据</b>（' + n + ' 条，均带「演示」标记）。演示条目仅用于展示结构与交互，不代表真实临床结论；清除演示数据不会影响你新增的真实资料。</div><button type="button" class="btn btnMini" data-act="demoClear">清除演示数据</button></div>';
  }
  function pageHead(title, sub, actions) {
    return '<div class="pageHead"><div><h2 class="pageTitle">' + esc(title) + '</h2>' + (sub ? '<p class="pageSub">' + sub + '</p>' : '') + '</div><div class="pageActions">' + (actions || '') + '</div></div>';
  }
  function statusPill(status) {
    var cls = READ_CLASS[status] || 'unread';
    return '<span class="statusPill ' + cls + '">' + esc(READ_STATUS[status] || '未读') + '</span>';
  }
  function itemMetaLine(item) {
    var bits = [];
    if (item.authors && item.authors.length) bits.push(esc(item.authors.slice(0, 3).join(', ') + (item.authors.length > 3 ? ' 等' : '')));
    if (item.journal) bits.push(esc(item.journal));
    if (item.year) bits.push(esc(item.year));
    return bits.join(' · ');
  }
  function idChips(item) {
    var out = '';
    if (item.pmid) out += '<span class="chip chipKey mono">PMID ' + esc(item.pmid) + '</span>';
    if (item.doi) out += '<span class="chip chipKey mono">DOI ' + esc(item.doi) + '</span>';
    if (item.zoteroKey) out += '<span class="chip chipTeal mono">Zotero ' + esc(item.zoteroKey) + '</span>';
    return out;
  }
  function sourceChip(item) {
    var s = item.source || {};
    var cls = s.type === 'zotero' ? 'chipTeal' : s.type === 'pubmed' ? 'chipAccent' : '';
    return '<span class="chip ' + cls + '" title="' + esc((s.label || '') + ' · ' + fmtDateTime(s.at)) + '">' + esc(s.label || '手动登记') + '</span>';
  }
  function emptyBox(text, action) {
    return '<div class="empty">' + text + (action || '') + '</div>';
  }
  function taskLinkLabel(t) {
    if (!t.subjectType || t.subjectType === 'none') return '';
    if (t.subjectLabel) return t.subjectLabel;
    if (t.subjectType === 'item') { var i = findItem(t.subjectId); return i ? i.title : ''; }
    if (t.subjectType === 'topic') { var p = findTopic(t.subjectId); return p ? p.name : ''; }
    if (t.subjectType === 'case') { var c = findCase(t.subjectId); return c ? c.title : ''; }
    return '';
  }
  function taskCardHtml(t) {
    var due = t.due ? '<span class="' + dueClass(t.due) + '">' + esc(t.due) + (daysUntil(t.due) != null ? ' · ' + esc(dueLabel(t.due)) : '') + '</span>' : '';
    var link = taskLinkLabel(t);
    return '<div class="taskCard">' +
      '<div class="taskTop"><span class="chip ' + (t.priority === 'high' ? 'chipDanger' : t.priority === 'med' ? 'chipWarn' : '') + '">' + esc(PRIORITY[t.priority]) + '优先</span>' +
      '<span class="taskActions"><button class="btnMini" data-act="taskCycle" data-id="' + t.id + '">' + (t.status === 'todo' ? '开始' : t.status === 'doing' ? '完成' : '重开') + '</button>' +
      '<button class="btnMini" data-act="taskEdit" data-id="' + t.id + '">编辑</button></span></div>' +
      '<div class="taskTitle" data-act="taskEdit" data-id="' + t.id + '">' + esc(t.title) + '</div>' +
      '<div class="taskMeta">' + (t.status === 'done' ? '<span class="chip chipTeal">已完成</span>' : due) + (due && link ? '<span>·</span>' : '') + (link ? '<span class="clickable" data-act="openTaskLink" data-id="' + t.id + '">↗ ' + esc(truncate(link, 30)) + '</span>' : '') + '</div>' +
      (t.detail ? '<div class="taskDetail">' + esc(t.detail) + '</div>' : '') +
      '</div>';
  }
  function noteCardHtml(n) {
    var item = n.itemId ? findItem(n.itemId) : null;
    var topic = n.topicId ? findTopic(n.topicId) : null;
    var cs = n.caseId ? findCase(n.caseId) : null;
    var page = n.sourcePage ? '<span class="chip chipAccent">第 ' + esc(n.sourcePage) + ' 页</span>' : '';
    var sourceRef = n.sourceRef ? '<span class="chip">' + esc(n.sourceRef) + '</span>' : '';
    var quote = n.quote ? '<div class="q">“' + esc(truncate(n.quote, 180)) + '”</div>' : '';
    return '<div class="noteCard">' + quote +
      '<div class="b">' + esc(n.body || '（空笔记）') + '</div>' +
      '<div class="f">' + page + sourceRef +
      (item ? '<span class="chip chipGhost clickable" data-act="read" data-id="' + item.id + '">' + esc(truncate(item.title, 26)) + '</span>' : '') +
      (topic ? '<span class="chip chipTeal clickable" data-act="openTopic" data-topic="' + topic.id + '">' + esc(topic.name) + '</span>' : '') +
      (cs ? '<span class="chip chipGhost clickable" data-act="openCase" data-case="' + cs.id + '">' + esc(cs.title) + '</span>' : '') +
      (n.demo ? '<span class="chip chipWarn">演示</span>' : '') +
      '<span style="margin-left:auto">' + esc(relTime(n.updatedAt)) + '</span></div>' +
      '<div class="taskActions"><button class="btnMini" data-act="noteEdit" data-id="' + n.id + '">编辑</button>' +
      (item ? '<button class="btnMini" data-act="locateNote" data-id="' + n.id + '">定位原文</button>' : '') +
      '<button class="btnMini btnMiniDanger" data-act="noteDelete" data-id="' + n.id + '">删除</button></div>' +
      '</div>';
  }

  /* ================================================================
     首页
     ================================================================ */
  function renderHome() {
    var items = APP.data.items;
    var recent = items.filter(function (x) { return x.lastOpenedAt; }).sort(function (a, b) { return b.lastOpenedAt - a.lastOpenedAt; }).slice(0, 5);
    if (!recent.length) recent = items.slice().sort(function (a, b) { return b.addedAt - a.addedAt; }).slice(0, 5);
    var openTasks = APP.data.tasks.filter(function (t) { return t.status !== 'done'; }).sort(function (a, b) {
      if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      if (a.due) return -1;
      if (b.due) return 1;
      return b.updatedAt - a.updatedAt;
    }).slice(0, 6);
    var topics = APP.data.topics.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var recentAdded = items.slice().sort(function (a, b) { return b.addedAt - a.addedAt; }).slice(0, 5);
    var unread = items.filter(function (x) { return x.readStatus === 'unread'; }).length;
    var todo = APP.data.tasks.filter(function (t) { return t.status !== 'done'; }).length;
    var done = APP.data.tasks.filter(function (t) { return t.status === 'done'; }).length;
    var weekRead = items.filter(function (x) { return x.lastOpenedAt && Date.now() - x.lastOpenedAt < 7 * 86400000; }).length;
    var html = '<div class="page">' + demoBanner();
    html += '<div class="homeHero"><div class="grow"><h2>医学研究工作台</h2><p>面向医生、药企医学人员与医学研究者的本地研究工作区。资料、专题、笔记、批注与任务保存在你自己的机器上；检索与阅读都保留来源与时间。</p>' +
      '<div class="flowLine"><span class="step">检索资料</span><span class="arrow">→</span><span class="step">加入专题</span><span class="arrow">→</span><span class="step">阅读原文</span><span class="arrow">→</span><span class="step">记录笔记</span><span class="arrow">→</span><span class="step">关联任务</span></div></div>' +
      '<div class="pageActions"><button class="btn btnPrimary" data-act="addLocal">＋ 导入 PDF</button><button class="btn" data-act="addZotero">连接 Zotero（可选）</button><button class="btn" data-act="nav" data-section="search">开始检索</button><button class="btn" data-act="addManual">＋ 手动登记</button></div></div>';
    html += '<div class="gridAuto">' +
      '<div class="statCard" data-act="nav" data-section="library"><div class="statLabel">资料总数</div><div class="statValue">' + items.length + '</div><div class="statHint">未读 ' + unread + ' · 已读 ' + items.filter(function (x) { return x.readStatus === 'read'; }).length + '</div></div>' +
      '<div class="statCard" data-act="openTopics"><div class="statLabel">专题项目</div><div class="statValue">' + topics.length + '</div><div class="statHint">按疾病 / 药物 / 方向组织</div></div>' +
      '<div class="statCard" data-act="nav" data-section="tasks"><div class="statLabel">待办任务</div><div class="statValue">' + todo + '</div><div class="statHint">进行中 ' + APP.data.tasks.filter(function (t) { return t.status === 'doing'; }).length + ' · 已完成 ' + done + '</div></div>' +
      '<div class="statCard" data-act="nav" data-section="library"><div class="statLabel">近 7 天阅读</div><div class="statValue">' + weekRead + '</div><div class="statHint">按最近打开时间统计</div></div>' +
      '</div>';
    html += '<div class="grid2">';
    html += '<div class="card"><div class="cardHead"><h3>最近阅读</h3><button class="btnMini" data-act="nav" data-section="library">查看全部</button></div>' +
      (recent.length ? '<div class="list">' + recent.map(function (it) {
        return '<div class="listRow" data-act="read" data-id="' + it.id + '"><div class="listRowMain"><div class="rowTitle">' + esc(it.title) + '</div><div class="rowMeta">' + statusPill(it.readStatus) + '<span>' + esc(itemMetaLine(it)) + '</span>' + (it.lastOpenedAt ? '<span>' + esc(relTime(it.lastOpenedAt)) + '</span>' : '') + '</div></div><div class="rowOps">' + idChips(it) + '</div></div>';
      }).join('') + '</div>' : emptyBox('还没有阅读记录。从资料库打开一篇论文，或先加入一篇资料。', '<br><button class="btnMini" data-act="nav" data-section="library">去资料库</button>')) + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>待办任务</h3><button class="btnMini" data-act="taskNewTop">＋ 新任务</button></div>' +
      (openTasks.length ? '<div class="list">' + openTasks.map(function (t) {
        var link = taskLinkLabel(t);
        return '<div class="listRow"><div class="listRowMain"><div class="rowTitle" data-act="taskEdit" data-id="' + t.id + '">' + esc(t.title) + '</div><div class="rowMeta"><span class="chip ' + (t.priority === 'high' ? 'chipDanger' : t.priority === 'med' ? 'chipWarn' : '') + '">' + esc(PRIORITY[t.priority]) + '优先</span>' + (t.due ? '<span class="' + dueClass(t.due) + '">' + esc(t.due) + ' · ' + esc(dueLabel(t.due)) + '</span>' : '') + (link ? '<span class="clickable" data-act="openTaskLink" data-id="' + t.id + '">↗ ' + esc(truncate(link, 24)) + '</span>' : '') + '</div></div><div class="rowOps"><button class="btnMini" data-act="taskCycle" data-id="' + t.id + '">' + (t.status === 'todo' ? '开始' : '完成') + '</button></div></div>';
      }).join('') + '</div>' : emptyBox('没有未完成任务。')) + '</div>';
    html += '</div>';
    html += '<div class="grid2">';
    html += '<div class="card"><div class="cardHead"><h3>专题项目</h3><button class="btnMini" data-act="topicNew">＋ 新建专题</button></div>' +
      (topics.length ? '<div class="gridAuto">' + topics.slice(0, 6).map(function (t) {
        var count = items.filter(function (x) { return x.topicIds.indexOf(t.id) >= 0; }).length;
        return '<div class="topicCard" data-act="openTopic" data-topic="' + t.id + '"><h4>' + esc(t.name) + '</h4><div class="chips" style="margin-top:5px"><span class="chip">' + esc(TOPIC_KINDS[t.kind]) + '</span><span class="chip chipAccent">' + count + ' 篇资料</span>' + (t.demo ? '<span class="chip chipWarn">演示</span>' : '') + '</div><div class="sub" style="margin-top:6px">' + esc(truncate(t.description || '未填写说明', 70)) + '</div></div>';
      }).join('') + '</div>' : emptyBox('还没有专题。可把资料按疾病、药物或研究方向组织。', '<br><button class="btnMini" data-act="topicNew">新建专题</button>')) + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>最近添加</h3><button class="btnMini" data-act="addManual">＋ 添加</button></div>' +
      (recentAdded.length ? '<div class="list">' + recentAdded.map(function (it) {
        return '<div class="listRow" data-act="openItem" data-id="' + it.id + '"><div class="listRowMain"><div class="rowTitle">' + esc(it.title) + '</div><div class="rowMeta">' + statusPill(it.readStatus) + '<span>' + esc(it.type) + '</span><span>' + esc(relTime(it.addedAt)) + '</span>' + sourceChip(it) + '</div></div></div>';
      }).join('') + '</div>' : emptyBox('还没有资料。')) + '</div>';
    html += '</div>';
    html += '<div class="card"><div class="cardHead"><h3>连接与保存状态</h3><button class="btnMini" data-act="settings" data-tab="conn">连接设置</button></div><div class="grid2">' +
      '<div><div class="kv"><div class="k">本地服务</div><div class="v">' + bridgeStatusChip() + ' <span class="muted">' + esc(APP.bridge.url) + '</span></div>' +
      '<div class="k">Zotero</div><div class="v">' + zoteroStatusChip() + (APP.bridge.online && APP.bridge.health && APP.bridge.health.zotero && APP.bridge.health.zotero.error ? ' <span class="muted">' + esc(APP.bridge.health.zotero.error) + '</span>' : '') + '</div>' +
      '<div class="k">检索来源</div><div class="v">' + biomcpStatusChip() + ' <span class="muted">PubMed / ClinicalTrials.gov / MyChem.info / openFDA</span></div></div></div>' +
      '<div><div class="kv"><div class="k">模型问答</div><div class="v">' + modelStatusChip() + ' <span class="muted">点击「模型」设置来源；密钥由宿主后端/凭据库处理</span></div>' +
      '<div class="k">数据保存</div><div class="v"><span class="statusChip ' + saveClass() + '"><span class="dot"></span>' + esc(saveModeText()) + '</span> <span class="muted">' + esc(APP.save.at ? fmtTime(APP.save.at) : '尚未写入') + '</span></div>' +
      '<div class="k">数据文件</div><div class="v"><span class="pathCode">' + esc(dataFilePath() || '（不在工作台站点内，仅浏览器保存）') + '</span></div></div></div>' +
      '</div></div>';
    html += '</div>';
    return html;
  }

  /* ================================================================
     医学资料库
     ================================================================ */
  function filteredItems() {
    var f = APP.ui.library;
    var q = str(f.q).toLowerCase();
    return APP.data.items.filter(function (it) {
      if (f.star && !it.starred) return false;
      if (f.type && it.type !== f.type) return false;
      if (f.status && it.readStatus !== f.status) return false;
      if (f.topic && it.topicIds.indexOf(f.topic) < 0) return false;
      if (f.tag && it.tags.indexOf(f.tag) < 0) return false;
      if (q) {
        var hay = [it.title, it.abstract, it.journal, it.doi, it.pmid, (it.authors || []).join(' '), (it.tags || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (f.sort === 'added') return b.addedAt - a.addedAt;
      if (f.sort === 'year') return (b.year || '0').localeCompare(a.year || '0');
      if (f.sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (f.sort === 'read') return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
      return (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt);
    });
  }
  function libraryRowHtml(it) {
    var tags = it.tags.slice(0, 3).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');
    return '<tr>' +
      '<td style="width:30px"><button class="star ' + (it.starred ? '' : 'starOff') + '" data-act="star" data-id="' + it.id + '" title="收藏">' + (it.starred ? '★' : '☆') + '</button></td>' +
      '<td><div class="cellTitle" data-act="openItem" data-id="' + it.id + '">' + esc(it.title) + '</div><div class="cellSub">' + esc(itemMetaLine(it)) + (it.demo ? '<span class="chip chipWarn">演示</span>' : '') + (it.sample ? '<span class="chip chipTeal">示例 PDF</span>' : '') + '</div><div class="chips" style="margin-top:4px">' + itemTopicChips(it) + tags + '</div></td>' +
      '<td><div class="chips">' + idChips(it) + '</div><div class="muted" style="margin-top:4px">' + sourceChip(it) + '</div></td>' +
      '<td>' + statusPill(it.readStatus) + '</td>' +
      '<td class="nowrap muted">' + esc(it.lastOpenedAt ? relTime(it.lastOpenedAt) : '未打开') + '</td>' +
      '<td><div class="rowOps"><button class="btnMini" data-act="read" data-id="' + it.id + '">阅读</button><button class="btnMini" data-act="noteNew" data-item="' + it.id + '">笔记</button><button class="btnMini" data-act="taskNew" data-subject="item" data-subjectid="' + it.id + '">任务</button><button class="btnMini" data-act="itemEdit" data-id="' + it.id + '">编辑</button></div></td>' +
      '</tr>';
  }
  function renderLibraryRows() {
    var rows = filteredItems();
    var tbody = $('#libTableBody');
    var count = $('#libCount');
    if (tbody) tbody.innerHTML = rows.length ? rows.map(libraryRowHtml).join('') : '<tr><td colspan="6"><div class="empty">没有匹配的资料。调整筛选条件，或添加新资料。</div></td></tr>';
    if (count) count.textContent = '共 ' + rows.length + ' 条资料' + (rows.length !== APP.data.items.length ? '（全部 ' + APP.data.items.length + '）' : '');
  }
  function renderLibrary() {
    var f = APP.ui.library;
    var html = '<div class="page">' + demoBanner();
    html += pageHead('医学资料库', '同一资料共用一条记录，优先按 PMID → DOI → Zotero Key → 标题+年份去重。无需安装 Zotero：直接导入自己的 PDF 即可阅读、批注、问答和保存；Zotero 仅作为可选来源，只读导入。',
      '<button class="btn btnPrimary" data-act="addLocal">＋ 导入 PDF</button><button class="btn" data-act="addZotero">连接 Zotero（可选）</button><button class="btn" data-act="addManual">＋ 手动登记</button>');
    html += '<div class="subtabs"><button class="subtab ' + (f.tab === 'materials' ? 'subtabOn' : '') + '" data-act="libTab" data-tab="materials">文献资料</button><button class="subtab ' + (f.tab === 'topics' ? 'subtabOn' : '') + '" data-act="libTab" data-tab="topics">专题项目</button></div>';
    if (f.tab === 'topics') {
      html += renderTopicsList();
      html += '</div>';
      return html;
    }
    var allTags = {};
    APP.data.items.forEach(function (it) { it.tags.forEach(function (t) { allTags[t] = (allTags[t] || 0) + 1; }); });
    var tagOptions = Object.keys(allTags).sort().map(function (t) { return '<option value="' + esc(t) + '"' + (f.tag === t ? ' selected' : '') + '>' + esc(t) + '（' + allTags[t] + '）</option>'; }).join('');
    var topicOptions = APP.data.topics.map(function (t) { return '<option value="' + t.id + '"' + (f.topic === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    html += '<div class="toolbar">' +
      '<input class="input grow" id="libQ" data-filter="q" placeholder="搜索标题、作者、摘要、DOI、PMID、标签…" value="' + esc(f.q) + '" />' +
      '<select class="select" data-filter="type"><option value="">全部类型</option>' + ITEM_TYPES.map(function (t) { return '<option' + (f.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
      '<select class="select" data-filter="status"><option value="">全部状态</option>' + Object.keys(READ_STATUS).map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + READ_STATUS[k] + '</option>'; }).join('') + '</select>' +
      '<select class="select" data-filter="topic"><option value="">全部专题</option>' + topicOptions + '</select>' +
      '<select class="select" data-filter="tag"><option value="">全部标签</option>' + tagOptions + '</select>' +
      '<select class="select" data-filter="sort"><option value="recent"' + (f.sort === 'recent' ? ' selected' : '') + '>最近访问</option><option value="added"' + (f.sort === 'added' ? ' selected' : '') + '>最近添加</option><option value="year"' + (f.sort === 'year' ? ' selected' : '') + '>年份</option><option value="title"' + (f.sort === 'title' ? ' selected' : '') + '>标题</option><option value="read"' + (f.sort === 'read' ? ' selected' : '') + '>最近阅读</option></select>' +
      '<button class="btnMini ' + (f.star ? 'btnMiniOn' : '') + '" data-act="libStar">★ 只看收藏</button>' +
      '<button class="btnMini" data-act="libReset">重置</button>' +
      '</div>';
    html += '<div class="flex" style="justify-content:space-between"><span class="muted" id="libCount">共 ' + APP.data.items.length + ' 条资料</span><span class="muted">提示：点击标题打开详情；「阅读」进入原文阅读台。</span></div>';
    html += '<div class="tableWrap"><table class="tbl"><thead><tr><th></th><th>资料</th><th>标识与来源</th><th>阅读状态</th><th>最近访问</th><th>操作</th></tr></thead><tbody id="libTableBody">' + (filteredItems().length ? filteredItems().map(libraryRowHtml).join('') : '<tr><td colspan="6"><div class="empty">没有匹配的资料。</div></td></tr>') + '</tbody></table></div>';
    html += '</div>';
    return html;
  }
  function renderTopicsList() {
    var topics = APP.data.topics.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (!topics.length) return '<div class="card">' + emptyBox('还没有专题。专题用于集中展示相关资料、笔记与任务。', '<br><button class="btnMini" data-act="topicNew">新建专题</button>') + '</div>';
    return '<div class="gridAuto">' + topics.map(function (t) {
      var items = APP.data.items.filter(function (x) { return x.topicIds.indexOf(t.id) >= 0; });
      var notes = notesFor({ topicId: t.id });
      var tasks = tasksFor({ subjectType: 'topic', subjectId: t.id });
      var read = items.filter(function (x) { return x.readStatus === 'read'; }).length;
      return '<div class="card"><div class="cardHead"><h3 class="clickable" data-act="openTopic" data-topic="' + t.id + '">' + esc(t.name) + '</h3><span class="chip">' + esc(TOPIC_KINDS[t.kind]) + '</span></div>' +
        '<div class="sub">' + esc(t.description || '未填写说明') + '</div>' +
        '<div class="chips" style="margin-top:8px"><span class="chip chipAccent">' + items.length + ' 篇资料</span><span class="chip">' + read + ' 已读</span><span class="chip">' + notes.length + ' 条笔记</span><span class="chip">' + tasks.length + ' 个任务</span>' + (t.demo ? '<span class="chip chipWarn">演示</span>' : '') + '</div>' +
        '<div class="progress mt8"><div class="progressBar" style="width:' + (items.length ? Math.round(read / items.length * 100) : 0) + '%"></div></div>' +
        '<div class="taskActions" style="margin-top:9px"><button class="btnMini" data-act="openTopic" data-topic="' + t.id + '">打开专题</button><button class="btnMini" data-act="topicEdit" data-id="' + t.id + '">编辑</button><button class="btnMini btnMiniDanger" data-act="topicDelete" data-id="' + t.id + '">删除</button></div>' +
        '</div>';
    }).join('') + '</div>';
  }
  function renderTopicPage() {
    var t = findTopic(APP.route.topicId);
    if (!t) return '<div class="page"><div class="banner bannerBad"><div class="grow">专题不存在或已删除。</div><button class="btn btnMini" data-act="nav" data-section="library">返回资料库</button></div></div>';
    var items = APP.data.items.filter(function (x) { return x.topicIds.indexOf(t.id) >= 0; });
    var notes = notesFor({ topicId: t.id });
    var tasks = tasksFor({ subjectType: 'topic', subjectId: t.id });
    var html = '<div class="page">' + demoBanner();
    html += pageHead(t.name, '<span class="chip">' + esc(TOPIC_KINDS[t.kind]) + '</span> ' + esc(t.description || '未填写说明'),
      '<button class="btn" data-act="nav" data-section="library">← 资料库</button><button class="btn" data-act="topicEdit" data-id="' + t.id + '">编辑专题</button><button class="btn" data-act="addItem" data-topic="' + t.id + '">＋ 添加资料</button>');
    html += '<div class="grid3">' +
      '<div class="statCard"><div class="statLabel">相关资料</div><div class="statValue">' + items.length + '</div><div class="statHint">已读 ' + items.filter(function (x) { return x.readStatus === 'read'; }).length + '</div></div>' +
      '<div class="statCard"><div class="statLabel">专题笔记</div><div class="statValue">' + notes.length + '</div><div class="statHint">含资料内笔记</div></div>' +
      '<div class="statCard"><div class="statLabel">关联任务</div><div class="statValue">' + tasks.length + '</div><div class="statHint">待办 ' + tasks.filter(function (x) { return x.status !== 'done'; }).length + '</div></div>' +
      '</div>';
    html += '<div class="grid2"><div class="card"><div class="cardHead"><h3>相关资料</h3><button class="btnMini" data-act="addItem" data-topic="' + t.id + '">＋ 添加</button></div>' +
      (items.length ? '<div class="list">' + items.map(function (it) {
        return '<div class="listRow" data-act="openItem" data-id="' + it.id + '"><div class="listRowMain"><div class="rowTitle">' + esc(it.title) + '</div><div class="rowMeta">' + statusPill(it.readStatus) + '<span>' + esc(itemMetaLine(it)) + '</span>' + sourceChip(it) + '</div></div><div class="rowOps"><button class="btnMini" data-act="read" data-id="' + it.id + '">阅读</button></div></div>';
      }).join('') + '</div>' : emptyBox('这个专题还没有资料。', '<br><button class="btnMini" data-act="addItem" data-topic="' + t.id + '">添加资料</button>')) + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>专题笔记</h3><button class="btnMini" data-act="noteNew" data-topic="' + t.id + '">＋ 写笔记</button></div>' +
      (notes.length ? notes.map(function (n) { return noteCardHtml(n); }).join('') : emptyBox('还没有专题笔记。')) + '</div></div>';
    html += '<div class="grid2"><div class="card"><div class="cardHead"><h3>任务</h3><button class="btnMini" data-act="taskNew" data-subject="topic" data-subjectid="' + t.id + '">＋ 创建任务</button></div>' +
      (tasks.length ? tasks.map(taskCardHtml).join('') : emptyBox('还没有关联任务。')) + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>说明</h3></div><div class="kv"><div class="k">专题类型</div><div class="v">' + esc(TOPIC_KINDS[t.kind]) + '</div><div class="k">创建时间</div><div class="v">' + esc(fmtDateTime(t.createdAt)) + '</div><div class="k">更新时间</div><div class="v">' + esc(fmtDateTime(t.updatedAt)) + '</div><div class="k">演示数据</div><div class="v">' + (t.demo ? '是（可清除）' : '否') + '</div></div>' +
      '<div class="divider"></div><div class="sub">专题只是资料的归类视图，不复制资料。同一篇资料可以同时属于多个专题；笔记与任务通过专题、资料或病例相互跳转。</div></div></div>';
    html += '</div>';
    return html;
  }

  /* ================================================================
     资料详情（抽屉）
     ================================================================ */
  function itemDetailHtml(item) {
    var notes = notesFor({ itemId: item.id });
    var tasks = APP.data.tasks.filter(function (t) { return (t.subjectType === 'item' && t.subjectId === item.id); });
    var annotations = item.annotations || [];
    var html = '';
    if (item.demo || item.sample) html += '<div class="banner bannerWarn"><div class="grow"><b>' + (item.sample ? '示例开放获取论文' : '演示资料') + '</b>：' + (item.sample ? '该 PDF 来自 PLOS Medicine 开放获取论文，可用于测试真实阅读与批注。' : '此条目用于展示功能，不代表真实临床结论。') + '</div></div>';
    html += '<div class="chips">' + statusPill(item.readStatus) + '<span class="chip">' + esc(item.type) + '</span>' + (item.starred ? '<span class="chip chipWarn">★ 收藏</span>' : '') + sourceChip(item) + itemTopicChips(item) + '</div>';
    html += '<div class="kv">' +
      '<div class="k">作者</div><div class="v">' + esc(item.authors.join(', ') || '未提供') + '</div>' +
      '<div class="k">期刊</div><div class="v">' + esc(item.journal || '未提供') + '</div>' +
      '<div class="k">年份</div><div class="v">' + esc(item.year || '未提供') + '</div>' +
      '<div class="k">DOI</div><div class="v">' + (item.doi ? '<a href="https://doi.org/' + esc(item.doi) + '" target="_blank" rel="noreferrer">' + esc(item.doi) + '</a>' : '未提供') + '</div>' +
      '<div class="k">PMID</div><div class="v">' + (item.pmid ? '<a href="https://pubmed.ncbi.nlm.nih.gov/' + esc(item.pmid) + '/" target="_blank" rel="noreferrer">' + esc(item.pmid) + '</a>' : '未提供') + '</div>' +
      '<div class="k">Zotero</div><div class="v">' + esc(item.zoteroRef || item.zoteroKey || '未关联') + '</div>' +
      '<div class="k">来源</div><div class="v">' + esc((item.source && item.source.label) || '手动登记') + ' · ' + esc(fmtDateTime(item.source && item.source.at)) + '</div>' +
      '<div class="k">添加时间</div><div class="v">' + esc(fmtDateTime(item.addedAt)) + ' · 最近打开 ' + esc(item.lastOpenedAt ? fmtDateTime(item.lastOpenedAt) : '未打开') + '</div>' +
      '<div class="k">原文/文件</div><div class="v">' + (item.filePath ? '<span class="pathCode">' + esc(item.filePath) + '</span>' : (item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noreferrer">' + esc(item.url) + '</a>' : '未提供')) + '</div>' +
      '</div>';
    html += '<div><div class="cardHead"><h3>摘要</h3>' + (item.abstract ? '<span class="chip">' + item.abstract.length + ' 字符</span>' : '') + '</div><div class="sub" style="white-space:pre-wrap">' + esc(item.abstract || '未提供摘要。可打开原文阅读，或手动粘贴全文后再提问。') + '</div></div>';
    html += '<div><div class="cardHead"><h3>标签</h3><button class="btnMini" data-act="itemEdit" data-id="' + item.id + '">编辑</button></div><div class="chips">' + (item.tags.length ? item.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') : '<span class="muted">无标签</span>') + '</div></div>';
    html += '<div><div class="cardHead"><h3>笔记（' + notes.length + '）</h3><button class="btnMini" data-act="noteNew" data-item="' + item.id + '">＋ 新增笔记</button></div>' + (notes.length ? notes.map(function (n) { return noteCardHtml(n); }).join('') : '<div class="muted">还没有笔记。阅读时选中原文可记录页码与引文。</div>') + '</div>';
    html += '<div><div class="cardHead"><h3>批注（' + annotations.length + '）</h3></div>' + (annotations.length ? annotations.slice(-8).reverse().map(function (a) {
      return '<div class="noteCard"><div class="q">“' + esc(truncate(a.quote || a.comment, 140)) + '”</div><div class="f"><span class="chip chipAccent">第 ' + esc(a.page || '?') + ' 页</span>' + (a.sourceRef ? '<span class="chip">' + esc(a.sourceRef) + '</span>' : '') + (a.comment ? '<span>' + esc(a.comment) + '</span>' : '') + '<span style="margin-left:auto">' + esc(relTime(a.createdAt)) + '</span></div></div>';
    }).join('') : '<div class="muted">还没有批注。在阅读台选中文本即可高亮并写下评论。</div>') + '</div>';
    html += '<div><div class="cardHead"><h3>关联任务（' + tasks.length + '）</h3><button class="btnMini" data-act="taskNew" data-subject="item" data-subjectid="' + item.id + '" data-subjectlabel="' + esc(item.title) + '">＋ 创建任务</button></div>' + (tasks.length ? tasks.map(taskCardHtml).join('') : '<div class="muted">还没有任务。</div>') + '</div>';
    html += '<div class="taskActions"><button class="btnMini" data-act="itemDelete" data-id="' + item.id + '">删除资料</button></div>';
    return html;
  }

  /* ================================================================
     任务
     ================================================================ */
  function renderTasks() {
    var f = APP.ui.tasks;
    var q = str(f.q).toLowerCase();
    var tasks = APP.data.tasks.filter(function (t) {
      if (f.priority && t.priority !== f.priority) return false;
      if (f.status && t.status !== f.status) return false;
      if (q && (t.title + ' ' + t.detail).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var done = APP.data.tasks.filter(function (t) { return t.status === 'done'; }).length;
    var pct = APP.data.tasks.length ? Math.round(done / APP.data.tasks.length * 100) : 0;
    var html = '<div class="page">' + demoBanner();
    html += pageHead('学术任务', '任务可关联专题、资料或病例；点击关联标签直接回到对应内容，减少重复录入。',
      '<button class="btn btnPrimary" data-act="taskNewTop">＋ 新建任务</button>');
    html += '<div class="card"><div class="flex" style="justify-content:space-between"><span class="sub">总体完成度 <b>' + done + '</b> / ' + APP.data.tasks.length + '（' + pct + '%）</span><span class="muted">逾期 ' + APP.data.tasks.filter(function (t) { return t.status !== 'done' && t.due && daysUntil(t.due) < 0; }).length + ' 个</span></div><div class="progress mt8"><div class="progressBar" style="width:' + pct + '%"></div></div></div>';
    html += '<div class="toolbar"><input class="input grow" id="taskQ" data-taskfilter="q" placeholder="搜索任务…" value="' + esc(f.q) + '" />' +
      '<select class="select" data-taskfilter="priority"><option value="">全部优先级</option>' + Object.keys(PRIORITY).map(function (k) { return '<option value="' + k + '"' + (f.priority === k ? ' selected' : '') + '>' + PRIORITY[k] + '</option>'; }).join('') + '</select>' +
      '<select class="select" data-taskfilter="status"><option value="">全部状态</option>' + TASK_STATUS_ORDER.map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + TASK_STATUS[k] + '</option>'; }).join('') + '</select>' +
      '<button class="btnMini" data-act="taskResetFilter">重置</button></div>';
    html += '<div class="board">' + TASK_STATUS_ORDER.map(function (s) {
      var list = tasks.filter(function (t) { return t.status === s; });
      return '<div class="boardCol"><div class="boardHead"><span>' + TASK_STATUS[s] + '</span><span class="navCount">' + list.length + '</span></div>' +
        (list.length ? list.map(taskCardHtml).join('') : '<div class="muted" style="padding:6px 2px">暂无任务</div>') + '</div>';
    }).join('') + '</div>';
    html += '</div>';
    return html;
  }
  function taskSubjectOptions(current, extra) {
    var opts = '<option value="none:">无关联</option>' + (extra || '');
    if (APP.data.topics.length) {
      opts += '<optgroup label="专题">' + APP.data.topics.map(function (t) { return '<option value="topic:' + t.id + '"' + (current === 'topic:' + t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</optgroup>';
    }
    if (APP.data.items.length) {
      opts += '<optgroup label="资料">' + APP.data.items.map(function (i) { return '<option value="item:' + i.id + '"' + (current === 'item:' + i.id ? ' selected' : '') + '>' + esc(truncate(i.title, 60)) + '</option>'; }).join('') + '</optgroup>';
    }
    if (APP.data.cases.length) {
      opts += '<optgroup label="病例">' + APP.data.cases.map(function (c) { return '<option value="case:' + c.id + '"' + (current === 'case:' + c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('') + '</optgroup>';
    }
    return opts;
  }
  function openTaskModal(prefill) {
    prefill = prefill || {};
    var t = prefill.id ? findTask(prefill.id) : null;
    var current = t ? (t.subjectType + ':' + t.subjectId) : ((prefill.subjectType && prefill.subjectType !== 'none') ? prefill.subjectType + ':' + (prefill.subjectId || '') : 'none:');
    var extraSubject = '';
    if (!t && (prefill.subjectType === 'trial' || prefill.subjectType === 'drug') && prefill.subjectUrl) {
      extraSubject = '<option value="' + prefill.subjectType + ':' + esc(prefill.subjectUrl) + '" selected>' + (prefill.subjectType === 'trial' ? '试验：' : '药物：') + esc(truncate(prefill.subjectLabel || prefill.title || '', 60)) + '</option>';
    } else if (t && (t.subjectType === 'trial' || t.subjectType === 'drug') && t.subjectUrl) {
      extraSubject = '<option value="' + t.subjectType + ':' + esc(t.subjectUrl) + '" selected>' + (t.subjectType === 'trial' ? '试验：' : '药物：') + esc(truncate(t.subjectLabel || '', 60)) + '</option>';
    }
    var body = '<div class="formGrid">' +
      '<div class="field span2"><label>任务标题</label><input class="input" name="title" required maxlength="160" value="' + esc(t ? t.title : (prefill.title || '')) + '" placeholder="例如：核对某篇 Meta 分析的异质性与终点定义" /></div>' +
      '<div class="field"><label>状态</label><select class="select" name="status">' + TASK_STATUS_ORDER.map(function (s) { return '<option value="' + s + '"' + (t && t.status === s ? ' selected' : (!t && s === 'todo' ? ' selected' : '')) + '>' + TASK_STATUS[s] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>优先级</label><select class="select" name="priority">' + Object.keys(PRIORITY).map(function (p) { return '<option value="' + p + '"' + (t && t.priority === p ? ' selected' : (!t && p === 'med' ? ' selected' : '')) + '>' + PRIORITY[p] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>截止日期</label><input class="input" type="date" name="due" value="' + esc(t ? t.due : '') + '" /></div>' +
      '<div class="field"><label>关联内容</label><select class="select" name="subject">' + taskSubjectOptions(current, extraSubject) + '</select><span class="hint">任务保存后可从任务卡直接跳回关联内容。</span></div>' +
      '<div class="field span2"><label>说明</label><textarea class="textarea" name="detail" rows="3" maxlength="1000">' + esc(t ? t.detail : (prefill.detail || '')) + '</textarea></div>' +
      '</div>';
    openModal({
      title: t ? '编辑任务' : '新建任务',
      body: body,
      submitLabel: t ? '保存任务' : '创建任务',
      onDelete: t ? function () {
        APP.data.tasks = APP.data.tasks.filter(function (x) { return x.id !== t.id; });
        APP.data.cases.forEach(function (c) { c.taskIds = c.taskIds.filter(function (x) { return x !== t.id; }); });
        markDirty({ immediate: true });
        closeModal();
        render();
        toast('已删除任务');
      } : null,
      onSubmit: function (fd) {
        var title = str(fd.get('title'));
        if (!title) { toast('请填写任务标题'); return false; }
        var subject = str(fd.get('subject')) || 'none:';
        var sp = subject.indexOf(':');
        var stype = sp >= 0 ? subject.slice(0, sp) : 'none';
        var sid = sp >= 0 ? subject.slice(sp + 1) : '';
        var subjectLabel = '';
        var subjectUrl = '';
        if (stype === 'topic') { var tp = findTopic(sid); subjectLabel = tp ? tp.name : ''; }
        else if (stype === 'item') { var it = findItem(sid); subjectLabel = it ? it.title : ''; }
        else if (stype === 'case') { var cs = findCase(sid); subjectLabel = cs ? cs.title : ''; }
        else if (stype === 'trial' || stype === 'drug') {
          subjectLabel = (prefill && prefill.subjectLabel) || (t && t.subjectLabel) || '外部来源';
          subjectUrl = sid;
        }
        var row = t || { id: uid('tk'), createdAt: Date.now() };
        row.title = title;
        row.status = TASK_STATUS[fd.get('status')] ? fd.get('status') : 'todo';
        row.priority = PRIORITY[fd.get('priority')] ? fd.get('priority') : 'med';
        row.due = str(fd.get('due'));
        row.detail = str(fd.get('detail'));
        row.subjectType = stype;
        row.subjectId = (stype === 'trial' || stype === 'drug') ? ((prefill && prefill.subjectId) || (t && t.subjectId) || '') : sid;
        row.subjectLabel = subjectLabel;
        row.subjectUrl = subjectUrl;
        row.updatedAt = Date.now();
        if (!t) APP.data.tasks.unshift(row);
        if (stype === 'case' && findCase(sid)) { var c = findCase(sid); if (c.taskIds.indexOf(row.id) < 0) c.taskIds.push(row.id); }
        markDirty({ immediate: true });
        closeModal();
        render();
        toast(t ? '任务已更新' : '任务已创建');
      }
    });
  }
  function cycleTaskStatus(id) {
    var t = findTask(id);
    if (!t) return;
    t.status = t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo';
    t.updatedAt = Date.now();
    markDirty();
    render();
    toast('任务状态：' + TASK_STATUS[t.status]);
  }
  function setTaskStatus(id, status) {
    var t = findTask(id);
    if (!t || !TASK_STATUS[status]) return;
    t.status = status;
    t.updatedAt = Date.now();
    markDirty();
    render();
  }

  /* ================================================================
     笔记 / 专题 / 手动登记 弹窗
     ================================================================ */
  function openNoteModal(prefill) {
    prefill = prefill || {};
    var n = prefill.id ? findNote(prefill.id) : null;
    var itemId = n ? n.itemId : (prefill.itemId || '');
    var topicId = n ? n.topicId : (prefill.topicId || '');
    var caseId = n ? n.caseId : (prefill.caseId || '');
    var item = itemId ? findItem(itemId) : null;
    var body = '<div class="formGrid">' +
      (item ? '<div class="field span2"><label>关联资料</label><div class="banner"><div class="grow"><b>' + esc(item.title) + '</b></div></div></div>' : '') +
      '<div class="field span2"><label>笔记内容</label><textarea class="textarea" name="body" rows="5" required placeholder="记录结论、方法学要点、疑问或下一步…">' + esc(n ? n.body : '') + '</textarea></div>' +
      '<div class="field"><label>来源页码</label><input class="input" name="page" value="' + esc(n ? n.sourcePage : (prefill.page || '')) + '" placeholder="例如 3 或 3-4" /></div>' +
      '<div class="field"><label>表图号（可选）</label><input class="input" name="sourceRef" value="' + esc(n ? n.sourceRef : (prefill.sourceRef || '')) + '" placeholder="例如 图 2 / 表 1" /></div>' +
      '<div class="field"><label>关联专题</label><select class="select" name="topicId"><option value="">不关联</option>' + APP.data.topics.map(function (t) { return '<option value="' + t.id + '"' + (topicId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field span2"><label>原文片段（可选）</label><textarea class="textarea" name="quote" rows="3" placeholder="从原文复制的句子；页码无法确定时请留空">' + esc(n ? n.quote : (prefill.quote || '')) + '</textarea></div>' +
      '<div class="field"><label>关联病例（可选）</label><select class="select" name="caseId"><option value="">不关联</option>' + APP.data.cases.map(function (c) { return '<option value="' + c.id + '"' + (caseId === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>标签（逗号分隔）</label><input class="input" name="tags" value="' + esc(n ? n.tags.join(', ') : '') + '" /></div>' +
      '</div>';
    openModal({
      title: n ? '编辑笔记' : '新增笔记',
      body: body,
      submitLabel: '保存笔记',
      onDelete: n ? function () {
        APP.data.notes = APP.data.notes.filter(function (x) { return x.id !== n.id; });
        markDirty({ immediate: true });
        closeModal();
        render();
        toast('已删除笔记');
      } : null,
      onSubmit: function (fd) {
        var text = str(fd.get('body'));
        if (!text) { toast('请填写笔记内容'); return false; }
        var row = n || { id: uid('nt'), itemId: itemId, createdAt: Date.now(), origin: 'user' };
        row.body = text;
        row.sourcePage = str(fd.get('page'));
        row.sourceRef = str(fd.get('sourceRef'));
        row.quote = str(fd.get('quote'));
        row.topicId = str(fd.get('topicId'));
        row.caseId = str(fd.get('caseId'));
        row.tags = str(fd.get('tags')).split(/[,，;；]/).map(str).filter(Boolean);
        row.updatedAt = Date.now();
        if (!n) APP.data.notes.unshift(row);
        if (row.caseId && findCase(row.caseId)) {
          var c = findCase(row.caseId);
          if (c.itemIds.indexOf(itemId) < 0 && itemId && findItem(itemId)) c.itemIds.push(itemId);
        }
        markDirty({ immediate: true });
        closeModal();
        render();
        toast(n ? '笔记已更新' : '笔记已保存');
      }
    });
  }
  function openTopicModal(prefill) {
    prefill = prefill || {};
    var t = prefill.id ? findTopic(prefill.id) : null;
    var body = '<div class="formGrid">' +
      '<div class="field span2"><label>专题名称</label><input class="input" name="name" required maxlength="80" value="' + esc(t ? t.name : '') + '" placeholder="例如：GLP-1RA 心血管结局" /></div>' +
      '<div class="field"><label>类型</label><select class="select" name="kind">' + Object.keys(TOPIC_KINDS).map(function (k) { return '<option value="' + k + '"' + (t && t.kind === k ? ' selected' : '') + '>' + TOPIC_KINDS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field span2"><label>说明</label><textarea class="textarea" name="description" rows="3" maxlength="500" placeholder="这个专题要回答什么问题？">' + esc(t ? t.description : '') + '</textarea></div>' +
      '</div>';
    openModal({
      title: t ? '编辑专题' : '新建专题',
      body: body,
      submitLabel: '保存专题',
      onSubmit: function (fd) {
        var name = str(fd.get('name'));
        if (!name) { toast('请填写专题名称'); return false; }
        var row = t || { id: uid('tp'), createdAt: Date.now() };
        row.name = name;
        row.kind = TOPIC_KINDS[fd.get('kind')] ? fd.get('kind') : 'direction';
        row.description = str(fd.get('description'));
        row.updatedAt = Date.now();
        if (!t) APP.data.topics.unshift(row);
        markDirty({ immediate: true });
        closeModal();
        if (!t) { APP.ui.library.tab = 'topics'; APP.section = 'library'; }
        render();
        toast(t ? '专题已更新' : '专题已创建');
      }
    });
  }
  function openItemModal(prefill) {
    prefill = prefill || {};
    var it = prefill.id ? findItem(prefill.id) : null;
    var topicChecks = APP.data.topics.map(function (t) {
      var checked = it ? it.topicIds.indexOf(t.id) >= 0 : (prefill.topicId === t.id);
      return '<label class="checkRow"><input type="checkbox" name="topic" value="' + t.id + '"' + (checked ? ' checked' : '') + ' /> ' + esc(t.name) + '</label>';
    }).join('');
    var body = '<div class="formGrid">' +
      '<div class="field span2"><label>标题</label><input class="input" name="title" required maxlength="300" value="' + esc(it ? it.title : (prefill.title || '')) + '" /></div>' +
      '<div class="field"><label>类型</label><select class="select" name="type">' + ITEM_TYPES.map(function (t) { return '<option' + (it && it.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>阅读状态</label><select class="select" name="readStatus">' + Object.keys(READ_STATUS).map(function (k) { return '<option value="' + k + '"' + (it && it.readStatus === k ? ' selected' : '') + '>' + READ_STATUS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>作者（逗号分隔）</label><input class="input" name="authors" value="' + esc(it ? it.authors.join(', ') : (prefill.authors || '')) + '" /></div>' +
      '<div class="field"><label>年份</label><input class="input" name="year" maxlength="4" value="' + esc(it ? it.year : (prefill.year || '')) + '" /></div>' +
      '<div class="field"><label>期刊 / 来源</label><input class="input" name="journal" value="' + esc(it ? it.journal : (prefill.journal || '')) + '" /></div>' +
      '<div class="field"><label>DOI</label><input class="input" name="doi" value="' + esc(it ? it.doi : (prefill.doi || '')) + '" /></div>' +
      '<div class="field"><label>PMID</label><input class="input" name="pmid" value="' + esc(it ? it.pmid : (prefill.pmid || '')) + '" /></div>' +
      '<div class="field"><label>来源链接</label><input class="input" name="url" value="' + esc(it ? it.url : (prefill.url || '')) + '" /></div>' +
      '<div class="field"><label>本地文件路径（可选）</label><input class="input" name="filePath" value="' + esc(it ? it.filePath : (prefill.filePath || '')) + '" placeholder="绝对路径，或项目内相对路径 fixtures/paper.pdf" /></div>' +
      '<div class="field span2"><label>摘要</label><textarea class="textarea" name="abstract" rows="4">' + esc(it ? it.abstract : (prefill.abstract || '')) + '</textarea></div>' +
      '<div class="field span2"><label>标签（逗号分隔）</label><input class="input" name="tags" value="' + esc(it ? it.tags.join(', ') : (prefill.tags || '')) + '" /></div>' +
      '<div class="field span2"><label>加入专题</label><div class="chips">' + (topicChecks || '<span class="muted">还没有专题，可先保存资料后创建。</span>') + '</div></div>' +
      '<div class="field span2"><label class="checkRow"><input type="checkbox" name="starred"' + (it && it.starred ? ' checked' : '') + ' /> 收藏这篇资料</label></div>' +
      '</div>';
    openModal({
      title: it ? '编辑资料' : '手动登记资料',
      body: body,
      submitLabel: it ? '保存资料' : '加入资料库',
      onSubmit: function (fd) {
        var title = str(fd.get('title'));
        if (!title) { toast('请填写标题'); return false; }
        var topics = fd.getAll('topic').map(str).filter(Boolean);
        if (it) {
          it.title = title;
          it.type = ITEM_TYPES.indexOf(fd.get('type')) >= 0 ? fd.get('type') : '其他';
          it.authors = str(fd.get('authors')).split(/[,，;；]/).map(str).filter(Boolean);
          it.year = str(fd.get('year'));
          it.journal = str(fd.get('journal'));
          it.doi = str(fd.get('doi'));
          it.pmid = str(fd.get('pmid'));
          it.url = str(fd.get('url'));
          it.filePath = str(fd.get('filePath'));
          it.abstract = str(fd.get('abstract'));
          it.tags = str(fd.get('tags')).split(/[,，;；]/).map(str).filter(Boolean);
          it.topicIds = topics;
          it.starred = !!fd.get('starred');
          it.readStatus = READ_STATUS[fd.get('readStatus')] ? fd.get('readStatus') : it.readStatus;
          it.updatedAt = Date.now();
          markDirty({ immediate: true });
          closeModal();
          render();
          toast('资料已更新');
          return;
        }
        var res = upsertItem({
          title: title,
          type: ITEM_TYPES.indexOf(fd.get('type')) >= 0 ? fd.get('type') : '其他',
          authors: str(fd.get('authors')).split(/[,，;；]/).map(str).filter(Boolean),
          year: str(fd.get('year')),
          journal: str(fd.get('journal')),
          doi: str(fd.get('doi')),
          pmid: str(fd.get('pmid')),
          url: str(fd.get('url')),
          filePath: str(fd.get('filePath')),
          abstract: str(fd.get('abstract')),
          tags: str(fd.get('tags')).split(/[,，;；]/).map(str).filter(Boolean),
          topicIds: topics,
          starred: !!fd.get('starred'),
          readStatus: READ_STATUS[fd.get('readStatus')] ? fd.get('readStatus') : 'unread',
          source: { type: 'manual', label: '手动登记', at: Date.now() }
        });
        markDirty({ immediate: true });
        closeModal();
        render();
        toast(res && res.merged ? '检测到重复资料，已合并到现有记录' : '已加入资料库');
      }
    });
  }

  /* ================================================================
     添加资料 / Zotero 导入 / 本地文件
     ================================================================ */
  function openAddMenu(topicId) {
    var body = '<div class="sub">选择一种方式把资料加入资料库。所有方式都会按 PMID / DOI / Zotero Key / 标题+年份去重。</div>' +
      '<div class="gridAuto">' +
      '<div class="card clickable" data-act="addManual" data-topic="' + esc(topicId) + '"><h3 style="margin:0 0 5px;font-size:13px">手动登记</h3><div class="muted">录入题录、摘要、链接，适合指南、说明书或暂无数码文件的资料。</div></div>' +
      '<div class="card clickable" data-act="addLocal" data-topic="' + esc(topicId) + '"><h3 style="margin:0 0 5px;font-size:13px">＋ 导入 PDF（无需 Zotero）</h3><div class="muted">选择或拖入本机 PDF，自动保存到项目文件；进入阅读台后可翻页、批注、笔记与提问。</div></div>' +
      '<div class="card clickable" data-act="addZotero" data-topic="' + esc(topicId) + '"><h3 style="margin:0 0 5px;font-size:13px">连接 Zotero（可选）</h3><div class="muted">已有 Zotero 7+ 时只读导入条目、附件、笔记与批注；未安装不影响本地 PDF。</div></div>' +
      '</div>';
    openModal({ title: '添加资料', body: body, hideSubmit: true, focus: false });
  }
  function openLocalFileModal(topicId) {
    var body = '<div class="formGrid">' +
      '<div class="field span2"><label>本地文件</label><input class="input" name="filePath" required placeholder="绝对路径，例如 D:\\papers\\paper.pdf；或点击下方选择文件上传到项目" /></div>' +
      '<div class="field span2"><div class="flex"><button type="button" class="btn btnPrimary" data-act="pickPdf">选择 PDF 文件并保存到本机</button><span class="muted">本地文件服务会自动检测/启动；也可直接粘贴路径。</span></div></div>' +
      '<div class="field"><label>标题（可选）</label><input class="input" name="title" /></div>' +
      '<div class="field"><label>类型</label><select class="select" name="type">' + ITEM_TYPES.map(function (t) { return '<option' + (t === '期刊文献' ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>DOI / PMID（可选）</label><input class="input" name="ids" placeholder="DOI 或 PMID" /></div>' +
      '<div class="field"><label>加入专题（可选）</label><select class="select" name="topicId"><option value="">不加入</option>' + APP.data.topics.map(function (t) { return '<option value="' + t.id + '"' + (topicId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field span2 hint">PDF 会在阅读台中由本机 PDF.js 解析；提取到的文本只用于本地阅读与提问，不会自动上传病例或其他资料。</div>' +
      '</div>';
    openModal({
      title: '添加本地 PDF',
      body: body,
      submitLabel: '加入资料库',
      onSubmit: function (fd) {
        var p = str(fd.get('filePath'));
        if (!p) { toast('请填写文件路径'); return false; }
        var title = str(fd.get('title')) || p.split(/[\\/]/).pop().replace(/\.pdf$/i, '');
        var ids = str(fd.get('ids'));
        var doi = /^10\./.test(ids) ? ids : '';
        var pmid = /^\d{5,9}$/.test(ids) ? ids : '';
        var res = upsertItem({
          title: title,
          type: ITEM_TYPES.indexOf(fd.get('type')) >= 0 ? fd.get('type') : '其他',
          filePath: p,
          doi: doi,
          pmid: pmid,
          topicIds: str(fd.get('topicId')) ? [str(fd.get('topicId'))] : [],
          source: { type: 'local', label: '本地文件', at: Date.now() }
        });
        markDirty({ immediate: true });
        closeModal();
        render();
        toast(res && res.merged ? '已合并到现有资料' : '已添加本地 PDF');
      }
    });
  }
  function openZoteroModal(topicId) {
    var z = APP.bridge.online && APP.bridge.health && APP.bridge.health.zotero;
    var body = '';
    if (!APP.bridge.online) {
      body += '<div class="banner bannerBad"><div class="grow"><b>本地服务未连接</b><br>Zotero 本地 API 不允许浏览器跨域访问，需要先启动项目内的本地桥接服务。</div><button class="btn btnMini" data-act="settings" data-tab="conn">连接设置</button></div>';
    } else if (!z || !z.connected) {
      body += '<div class="banner bannerWarn"><div class="grow"><b>未检测到 Zotero 本地 API</b><br>' + esc((z && z.error) || '请确认 Zotero 7+ 已启动，并在「设置 → 高级」勾选“允许此计算机上的其他应用程序与 Zotero 通信”。') + '</div><button class="btn btnMini" data-act="refreshConnections">重新检测</button></div>';
    } else {
      body += '<div class="banner bannerOk"><div class="grow"><b>Zotero 已连接</b> · ' + esc(APP.bridge.health.zotero.serverId || '本地库') + ' · 只读</div></div>' +
        '<div class="toolbar"><input class="input grow" id="zoteroQ" placeholder="按标题、作者、年份检索 Zotero 本地库…" value="" /><button class="btn btnPrimary" data-act="zoteroSearch">检索</button></div>' +
        '<div class="muted">检索结果来自 Zotero 本地 API；导入时读取条目、附件、笔记与批注。写入 Zotero 不在首版范围。</div>' +
        '<div id="zoteroResults"><div class="empty">输入关键词后检索，或留空浏览最近条目。</div></div>';
    }
    body += '<div class="divider"></div><div class="sub"><b>前置条件</b>：Zotero 7 及以上桌面版运行中；已在 Zotero 设置中允许本机其他应用通信。若没有 Zotero，可先使用「手动登记」或「添加本地 PDF」。</div>';
    openModal({ title: '从 Zotero 导入', body: body, hideSubmit: true, focus: false });
    if (APP.bridge.online && z && z.connected) {
      APP.zoteroTopicId = topicId || '';
      setTimeout(function () { zoteroSearch(); }, 120);
    }
  }
  async function zoteroSearch() {
    var box = $('#zoteroResults');
    var q = $('#zoteroQ') ? $('#zoteroQ').value : '';
    if (!box) return;
    box.innerHTML = '<div class="loadingRow"><span class="spin"></span>正在读取 Zotero 本地库…</div>';
    try {
      var r = await fetchJsonNice(APP.bridge.url + '/zotero/search?q=' + encodeURIComponent(q) + '&limit=30&mode=everything', {}, 15000);
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      var items = (r.json && r.json.items) || [];
      if (!items.length) {
        box.innerHTML = '<div class="empty">Zotero 中没有匹配的条目。确认本地库已建立索引，或换一个关键词。</div>';
        return;
      }
      box.innerHTML = '<div class="muted" style="margin-bottom:6px">共 ' + items.length + ' 条（最多显示 30 条）</div>' + items.map(function (it) {
        return '<div class="listRow"><div class="listRowMain"><div class="rowTitle">' + esc(it.title) + '</div><div class="rowMeta"><span>' + esc(it.authors.slice(0, 3).join(', ') || '未知作者') + '</span><span>' + esc(it.year || '') + '</span>' + (it.journal ? '<span>' + esc(it.journal) + '</span>' : '') + (it.doi ? '<span class="mono">DOI ' + esc(it.doi) + '</span>' : '') + (it.pmid ? '<span class="mono">PMID ' + esc(it.pmid) + '</span>' : '') + '<span class="chip chipTeal">Zotero ' + esc(it.zoteroKey) + '</span></div></div><div class="rowOps"><button class="btnMini" data-act="zoteroImport" data-key="' + esc(it.zoteroKey) + '">导入</button></div></div>';
      }).join('');
    } catch (err) {
      box.innerHTML = '<div class="banner bannerBad"><div class="grow">读取 Zotero 失败：' + esc(apiErrorMessage(err)) + '</div><button class="btn btnMini" data-act="zoteroSearch">重试</button></div>';
    }
  }
  async function importZoteroItem(key) {
    if (!key) return;
    toast('正在读取 Zotero 条目…');
    try {
      var r = await fetchJsonNice(APP.bridge.url + '/zotero/item?key=' + encodeURIComponent(key), {}, 20000);
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      var z = r.json.item;
      var pdf = (z.children.attachments || []).filter(function (a) { return /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename); })[0];
      var res = upsertItem({
        title: z.title,
        type: z.zoteroItemType === 'journalArticle' ? '期刊文献' : z.zoteroItemType === 'conferencePaper' ? '会议摘要' : '其他',
        authors: z.authors,
        year: z.year,
        journal: z.journal,
        doi: z.doi,
        pmid: z.pmid,
        abstract: z.abstract,
        url: z.url,
        zoteroKey: z.zoteroKey,
        zoteroRef: z.zoteroRef,
        zoteroItemType: z.zoteroItemType,
        attachmentKey: pdf ? pdf.key : '',
        tags: z.tags,
        annotations: (z.children.annotations || []).map(function (a) {
          return {
            id: uid('an'), page: a.page, quote: a.text, comment: a.comment, color: a.color,
            origin: 'user', source: 'zotero', zoteroKey: a.key || '', createdAt: Date.now()
          };
        }),
        topicIds: APP.zoteroTopicId ? [APP.zoteroTopicId] : [],
        source: { type: 'zotero', label: 'Zotero 本地库', at: Date.now() }
      });
      var importedNotes = 0;
      (z.children.notes || []).forEach(function (n) {
        if (!n.body) return;
        var duplicate = APP.data.notes.some(function (x) { return x.itemId === res.item.id && x.body === n.body; });
        if (duplicate) return;
        APP.data.notes.unshift(normalizeNote({
          body: n.body,
          itemId: res.item.id,
          origin: 'user',
          tags: ['Zotero']
        }));
        importedNotes++;
      });
      markDirty({ immediate: true });
      closeModal();
      render();
      toast('已导入：' + truncate(z.title, 30) + '（批注 ' + (z.children.annotations || []).length + ' 条，笔记 ' + importedNotes + ' 条）');
    } catch (err) {
      toast('导入失败：' + apiErrorMessage(err));
    }
  }

  /* ================================================================
     设置 / 数据
     ================================================================ */
  function settingsTabs(tab) {
    return '<div class="tabs"><button class="tab ' + (tab === 'conn' ? 'tabOn' : '') + '" data-act="settingsTab" data-tab="conn">连接状态</button><button class="tab ' + (tab === 'data' ? 'tabOn' : '') + '" data-act="settingsTab" data-tab="data">数据与备份</button><button class="tab ' + (tab === 'about' ? 'tabOn' : '') + '" data-act="settingsTab" data-tab="about">关于与许可</button></div>';
  }
  function settingsBody(tab) {
    if (tab === 'data') return settingsDataBody();
    if (tab === 'about') return settingsAboutBody();
    return settingsConnBody();
  }
  function openSettings(tab) {
    APP.settingsTab = tab || 'conn';
    openModal({
      title: '连接与数据设置',
      body: '<div id="settingsBody">' + settingsTabs(APP.settingsTab) + '<div style="margin-top:11px">' + settingsBody(APP.settingsTab) + '</div></div>',
      hideSubmit: true,
      focus: false
    });
    if (APP.settingsTab === 'data') setTimeout(loadBackupList, 60);
  }
  function switchSettingsTab(tab) {
    APP.settingsTab = tab;
    var host = $('#settingsBody');
    if (!host) return;
    host.innerHTML = settingsTabs(tab) + '<div style="margin-top:11px">' + settingsBody(tab) + '</div>';
    if (tab === 'data') loadBackupList();
  }
  function settingsConnBody() {
    var h = APP.bridge.health;
    var z = h && h.zotero;
    var l = h && h.llm;
    var s = h && h.search;
    var bm = s && s.biomcp;
    return '<div class="field"><label>本地文件服务地址</label><div class="flex"><input class="input grow" id="bridgeUrlInput" value="' + esc(APP.bridge.url) + '" /><button class="btn" data-act="saveBridgeUrl">保存地址</button><button class="btn btnAccent" data-act="testBridge">测试连接</button><button class="btn btnPrimary" data-act="ensureBridge">启动 / 重试服务</button></div><span class="hint">默认 http://127.0.0.1:8765。首次打开会自动启动；后台启动成功后可以关闭启动窗口。Zotero 未连接不影响 PDF 与保存。</span></div>' +
      '<div class="banner ' + (APP.bridge.online ? 'bannerOk' : 'bannerWarn') + '"><div class="grow"><b>本地文件服务：' + (APP.bridge.online ? '已连接' : '未启动') + '</b><br>' +
      (APP.bridge.online ? '版本 ' + esc(h.version) + ' · 数据文件 ' + '<span class="pathCode">' + esc(h.dataFile) + '</span>' + (APP.bridge.note ? '<br>' + esc(APP.bridge.note) : '') : esc(APP.bridge.error || '未启动或端口被占用')) + '</div><button class="btn btnMini" data-act="ensureBridge">自动启动</button><button class="btn btnMini" data-act="refreshConnections">重新检测</button></div>' +
      '<div class="grid2">' +
      '<div class="card"><div class="cardHead"><h3>Zotero</h3>' + zoteroStatusChip() + '</div><div class="kv"><div class="k">本地 API</div><div class="v mono">' + esc((z && z.base) || 'http://127.0.0.1:23119/api') + '</div><div class="k">Server ID</div><div class="v mono">' + esc((z && z.serverId) || '—') + '</div><div class="k">状态</div><div class="v">' + esc(z && z.connected ? '只读连接正常' : (z && z.error) || '需本地服务后检测') + '</div></div><div class="sub mt8">启用方法：Zotero 7+ → 设置 → 高级 → 勾选“允许此计算机上的其他应用程序与 Zotero 通信”。</div></div>' +
      '<div class="card"><div class="cardHead"><h3>检索来源</h3>' + biomcpStatusChip() + '</div><div class="kv">' +
      (bm && bm.installed
        ? '<div class="k">文献</div><div class="v">BioMCP ' + esc(bm.version || '') + ' · PubMed/EuropePMC/PubTator</div><div class="k">试验</div><div class="v">BioMCP ' + esc(bm.version || '') + ' · ClinicalTrials.gov</div><div class="k">药物</div><div class="v">BioMCP ' + esc(bm.version || '') + ' label · DailyMed/openFDA + DrugBank/ChEMBL</div>'
        : '<div class="k">文献</div><div class="v">NCBI PubMed E-utilities' + (s && s.pubmed && s.pubmed.apiKey ? '（已配置 API Key）' : '（无密钥，公共额度）') + '</div><div class="k">试验</div><div class="v">ClinicalTrials.gov API v2</div><div class="k">药物</div><div class="v">MyChem.info + openFDA' + (s && s.drug && s.drug.openFdaKey ? '（已配置 Key）' : '') + '</div>') +
      '</div><div class="sub mt8">' + (bm && bm.installed
        ? '本地 BioMCP ' + esc(bm.version || '') + ' 程序可运行；检索需要联网，实际来源、回退原因与查询时间随结果返回。'
        : esc((bm && bm.note) || 'BioMCP 尚未就绪，当前使用公开数据源备用检索。') + '<br>Windows x64 客户包已包含 tools/biomcp.exe；请保留整个交付目录。程序启动失败时，可查看 <a href="https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist" target="_blank" rel="noreferrer">微软官方 Visual C++ x64 运行库说明</a>，安装后重新检测。运行库缺失只是可能原因，具体以检测提示为准。') + '</div></div>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="card"><div class="cardHead"><h3>模型问答</h3>' + modelStatusChip() + '</div><div class="kv">' +
      '<div class="k">模式</div><div class="v">' + esc(APP.model.mode === 'custom' ? '自定义 API' : '使用 DSH 模型') + '</div>' +
      '<div class="k">Provider / Model</div><div class="v mono">' + esc(APP.model.mode === 'custom' ? ((APP.model.custom && APP.model.custom.provider) || '—') + ' / ' + ((APP.model.custom && APP.model.custom.model) || '未配置') : ((APP.model.dsh && APP.model.dsh.provider) || '—') + ' / ' + ((APP.model.dsh && APP.model.dsh.model) || '未配置')) + '</div>' +
      '<div class="k">来源</div><div class="v">' + esc(APP.model.mode === 'custom' ? '自定义 OpenAI 兼容 API' : (APP.model.dsh && APP.model.dsh.source === 'session' ? '当前工作台绑定会话' : 'DSH 默认模型')) + '</div>' +
      '<div class="k">测试状态</div><div class="v">' + esc(modelStatusLabel(APP.model.status && APP.model.status.status)) + (APP.model.status && APP.model.status.at ? ' · ' + esc(fmtDateTime(APP.model.status.at)) : '') + '</div>' +
      '</div><div class="sub mt8">密钥只由宿主后端/凭据库处理，不进入页面 localStorage、数据文件、日志或导出备份。</div><div class="mt8"><button class="btn" data-act="modelSettings">打开模型设置</button></div></div>' +
      '<div class="card"><div class="cardHead"><h3>数据保存</h3><span class="statusChip ' + saveClass() + '"><span class="dot"></span>' + esc(saveModeText()) + '</span></div><div class="kv"><div class="k">桥接文件</div><div class="v">' + (APP.bridge.online ? '可用（优先）' : '不可用') + '</div><div class="k">项目文件</div><div class="v">' + (projectDir() ? '可用（兜底）' : '不可用') + '</div><div class="k">浏览器缓存</div><div class="v">始终写入（防丢）</div><div class="k">最近保存</div><div class="v">' + esc(APP.save.at ? fmtDateTime(APP.save.at) : '尚未保存') + '</div></div>' + (APP.save.error ? '<div class="banner bannerBad mt8"><div class="grow">' + esc(APP.save.error) + '</div></div>' : '') + '</div>' +
      '</div>' +
      '<div class="divider"></div><div class="flex"><button class="btn" data-act="copyStartCmd">复制启动命令</button><button class="btn" data-act="openStartFolder">打开项目文件夹</button><span class="muted">服务只监听 127.0.0.1；密钥只在服务进程环境中。</span></div>';
  }
  function settingsDataBody() {
    var pathWarnings = APP.bridge.pathWarnings || [];
    return (APP.legacyCacheUnassigned ? '<div class="banner bannerWarn"><div class="grow">旧版浏览器缓存仍保留，因未记录所属项目，未自动导入。若以前仅存于缓存，请从旧版导出备份，再恢复到本项目。</div></div>' : '') + (pathWarnings.length ? '<div class="banner bannerWarn"><div class="grow"><b>部分 PDF 需要重新定位</b><br>' + pathWarnings.map(function (message) { return esc(message); }).join('<br>') + '</div></div>' : '') + '<div class="kv">' +
      '<div class="k">数据文件</div><div class="v"><span class="pathCode">' + esc(dataFilePath() || '（不可用）') + '</span></div>' +
      '<div class="k">保存方式</div><div class="v">' + esc(saveModeText()) + ' · 最近 ' + esc(APP.save.at ? fmtDateTime(APP.save.at) : '尚未保存') + '</div>' +
      '<div class="k">记录数量</div><div class="v">资料 ' + APP.data.items.length + ' · 专题 ' + APP.data.topics.length + ' · 笔记 ' + APP.data.notes.length + ' · 任务 ' + APP.data.tasks.length + ' · 病例 ' + APP.data.cases.length + '</div>' +
      '<div class="k">演示数据</div><div class="v">' + demoCount() + ' 条（有独立标记）</div>' +
      '</div>' +
      '<div class="flex mt12"><button class="btn btnPrimary" data-act="exportBackup">导出备份 JSON</button><button class="btn" data-act="importBackup">从备份恢复…</button><button class="btn" data-act="retrySave">立即重试保存</button></div>' +
      '<div class="banner mt12"><div class="grow"><b>恢复规则</b>：导入前会校验版本、数组字段、id 完整性与重复；确认后先自动备份当前数据，再替换。格式不符时不会改动现有数据。</div></div>' +
      '<div class="flex mt12"><button class="btn btnMini" data-act="demoClear">清除演示数据</button><button class="btn btnMini" data-act="demoAdd">重新载入演示数据</button></div>' +
      '<div class="divider"></div><div class="cardHead"><h3>本机备份</h3><button class="btnMini" data-act="loadBackups">刷新</button></div><div id="backupList" class="muted">' + (APP.bridge.online ? '加载中…' : '需要本地服务才能列出备份文件。') + '</div>';
  }
  function settingsAboutBody() {
    return '<div class="kv"><div class="k">工作台</div><div class="v">医学研究工作台 ' + VERSION + ' · 自定义窗口</div>' +
      '<div class="k">宿主</div><div class="v">DeepSeek Harness · dsh-worktable 0.4.0 皮肤</div>' +
      '<div class="k">PDF 引擎</div><div class="v">PDF.js 3.11.174（Apache-2.0，本地 vendor）</div>' +
      '<div class="k">数据格式</div><div class="v">JSON v1 · 项目 data/workbench-data.json</div></div>' +
      '<div class="divider"></div><div class="sub"><b>参考项目与许可证</b><br>' +
      '· Open Paper（khoj-ai/openpaper，AGPL-3.0）：仅参考阅读、批注、笔记与出处回跳交互，未复制其代码。<br>' +
      '· dsh-zotero（Vncntvx/dsh-zotero，MIT）：参考其 Zotero 本地 API 读取协议；本窗口只读接入，不安装其插件。<br>' +
      '· BioMCP（genomoncology/biomcp，MIT）：本项目 `tools/biomcp.exe` 0.9.3 真实调用文献/试验/药物通道；失败时回退公开上游。<br>' +
      '· DSH Medical（Proton1917/dsh-harness-plugin，BSD-3-Clause）：参考结构化病例字段与会话交接；真实工作台窗口通过同源父页面把交接稿写入原生输入框草稿，不自动发送。</div>' +
      '<div class="banner mt12"><div class="grow">医学内容仅供研究与决策辅助，不替代执业医师判断。AI 生成内容会单独标记；未配置模型时不会伪造 AI 回答。</div></div>' +
      '<div class="flex mt12"><button class="btn" data-act="openLicense">查看第三方许可说明</button></div>';
  }
  async function loadBackupList() {
    var host = $('#backupList');
    if (!host) return;
    if (!APP.bridge.online) { host.textContent = '需要本地服务才能列出备份文件。'; return; }
    try {
      var r = await fetchJsonNice(APP.bridge.url + '/data/backups', {}, 8000);
      if (!r.ok || !r.json) throw new Error('读取失败');
      var files = r.json.files || [];
      host.innerHTML = files.length ? files.slice(0, 12).map(function (f) {
        return '<div class="historyRow"><span class="mono">' + esc(f.name) + '</span><span>' + Math.round(f.bytes / 1024) + ' KB · ' + esc(fmtDateTime(f.mtime)) + '</span></div>';
      }).join('') : '还没有本机备份。保存数据或点击导出后会生成备份。';
    } catch (err) {
      host.textContent = '读取备份失败：' + apiErrorMessage(err);
    }
  }
  function openLicenses() {
    var body = '<pre style="white-space:pre-wrap;font:11px/1.7 ui-monospace,Consolas,monospace;color:var(--txt2);margin:0">' +
      esc('本窗口未打包第三方源码。\n\nPDF.js 3.11.174\nLicense: Apache-2.0\nhttps://github.com/mozilla/pdf.js\n\nDSH 原生皮肤：由 dsh-worktable 运行时提供（/api/worktable/template/dshell.css），本窗口仅引用，未复制。\n\n参考项目：\n- Open Paper: AGPL-3.0（仅交互参考）\n- dsh-zotero: MIT（协议参考）\n- BioMCP: MIT（上游数据源说明）\n- DSH Medical: BSD-3-Clause（字段与会话交接参考）\n\n数据来源条款：PubMed/NCBI、ClinicalTrials.gov、MyChem.info、openFDA 各自的服务条款适用；使用前请核对原始来源。') +
      '</pre>';
    openModal({ title: '第三方许可与来源说明', body: body, hideSubmit: true, focus: false });
  }
  async function testBridgeSetting() {
    var input = $('#bridgeUrlInput');
    if (input) APP.bridge.url = str(input.value) || DEFAULT_BRIDGE;
    localStorage.setItem(projectStorageKey(LS_BRIDGE_KEY), APP.bridge.url);
    toast('正在测试连接…');
    await probeBridge();
    if (APP.bridge.online) {
      toast('已连接本地服务');
      switchSettingsTab(APP.settingsTab || 'conn');
      await syncFromBridge();
    } else {
      toast('未连接：请先启动本地服务');
    }
  }
  function saveBridgeSetting() {
    var input = $('#bridgeUrlInput');
    APP.bridge.url = str(input && input.value) || DEFAULT_BRIDGE;
    localStorage.setItem(projectStorageKey(LS_BRIDGE_KEY), APP.bridge.url);
    toast('地址已保存，正在检测…');
    probeBridge();
  }
  async function refreshConnections() {
    APP.bridge.checkedAt = 0;
    await probeBridge();
    toast(APP.bridge.online ? '连接状态已刷新' : '本地服务未连接');
    if ($('#modalMask').hidden === false && APP.settingsTab) switchSettingsTab(APP.settingsTab);
  }
  async function syncFromBridge() {
    if (!APP.bridge.online) return;
    try {
      var r = await fetchJsonNice(APP.bridge.url + '/data/load', {}, 6000);
      if (r.ok && r.json && r.json.version === 1) {
        var remote = normalizeState(r.json);
        if (remote.updatedAt > APP.data.updatedAt) {
          if (window.confirm('本机数据文件比当前窗口更新。是否载入文件中的数据？')) {
            APP.data = remote;
            writeLocalState();
            render();
            toast('已载入本机文件数据');
          }
        } else if (APP.data.updatedAt > remote.updatedAt) {
          saveNow('settings-sync');
        }
      }
    } catch (e) {}
  }
  function copyStartCommand() {
    copyText('cd /d "' + (projectDir() || '') + '" && node bridge\\server.mjs').then(function (ok) {
      toast(ok ? '启动命令已复制' : '复制失败');
    });
  }
  function openStartFolder() {
    var dir = projectDir();
    if (!dir) { toast('当前不在项目文件夹中'); return; }
    window.open('/api/worktable/site/' + encodeURIComponent(dir) + '/', '_blank');
  }

  /* ================================================================
     备份导出 / 恢复 / 演示数据
     ================================================================ */
  async function exportBackup() {
    if (APP.bridge.online) {
      try { await fetchJsonNice(APP.bridge.url + '/data/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'manual' }) }, 8000); } catch (e) {}
    }
    var payload = Object.assign({}, APP.data, { exportedAt: new Date().toISOString(), app: 'medresearch-workbench', version: 1 });
    downloadText('medresearch-backup-' + todayStr().replace(/-/g, '') + '-' + Date.now().toString(36) + '.json', JSON.stringify(payload, null, 2));
    toast('备份已导出');
  }
  async function importBackupFile(file) {
    var text = await file.text();
    var raw = safeJsonParse(text);
    var check = validateBackup(raw);
    if (!check.ok) {
      openModal({
        title: '备份格式校验失败',
        body: '<div class="banner bannerBad"><div class="grow"><b>未改动现有数据</b><br>' + check.problems.map(esc).join('<br>') + '</div></div>',
        hideSubmit: true
      });
      return;
    }
    var body = '<div class="banner bannerWarn"><div class="grow"><b>即将恢复备份</b><br>当前数据会先自动备份（如可用），然后用下列内容替换。</div></div>' +
      '<div class="kv"><div class="k">资料</div><div class="v">' + check.counts.items + ' 条</div><div class="k">专题</div><div class="v">' + check.counts.topics + ' 个</div><div class="k">笔记</div><div class="v">' + check.counts.notes + ' 条</div><div class="k">任务</div><div class="v">' + check.counts.tasks + ' 个</div><div class="k">病例</div><div class="v">' + check.counts.cases + ' 个</div><div class="k">导出时间</div><div class="v">' + esc(raw.exportedAt || raw.updatedAt || '未知') + '</div></div>' +
      '<label class="checkRow"><input type="checkbox" id="restoreConfirm" /> 我已确认要替换当前数据（会先备份当前文件）</label>';
    openModal({
      title: '从备份恢复',
      body: body,
      submitLabel: '确认恢复',
      onSubmit: async function () {
        if (!$('#restoreConfirm') || !$('#restoreConfirm').checked) { toast('请先勾选确认'); return false; }
        var normalized = normalizeState(raw);
        if (APP.bridge.online) {
          var r = await fetchJsonNice(APP.bridge.url + '/data/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: normalized, confirm: true })
          }, 15000);
          if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || '恢复失败');
        } else {
          var current = JSON.stringify(APP.data, null, 2);
          downloadText('pre-restore-' + Date.now() + '.json', current);
          var file2 = dataFilePath();
          if (file2) {
            await fetchJsonNice('/api/worktable/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: file2, content: JSON.stringify(normalized, null, 2) }) }, 15000);
          }
        }
        APP.data = normalized;
        writeLocalState();
        setSaveMode(APP.bridge.online ? 'bridge' : (dataFilePath() ? 'worktable' : 'local'));
        applyFontSize();
        render();
        toast('已恢复备份（原数据已自动备份/导出）');
      }
    });
  }
  function clearDemoData() {
    var n = demoCount();
    if (!n) { toast('没有演示数据'); return; }
    if (!window.confirm('清除 ' + n + ' 条演示数据？真实资料、笔记、任务与病例不会被删除。')) return;
    APP.data.items = APP.data.items.filter(function (x) { return !x.demo; });
    APP.data.topics = APP.data.topics.filter(function (x) { return !x.demo; });
    APP.data.notes = APP.data.notes.filter(function (x) { return !x.demo; });
    APP.data.tasks = APP.data.tasks.filter(function (x) { return !x.demo; });
    APP.data.cases = APP.data.cases.filter(function (x) { return !x.demo; });
    var ids = {};
    APP.data.items.forEach(function (x) { ids[x.id] = 1; });
    var tids = {};
    APP.data.topics.forEach(function (x) { tids[x.id] = 1; });
    var cids = {};
    APP.data.cases.forEach(function (x) { cids[x.id] = 1; });
    APP.data.notes.forEach(function (n2) {
      if (n2.itemId && !ids[n2.itemId]) n2.itemId = '';
      if (n2.topicId && !tids[n2.topicId]) n2.topicId = '';
      if (n2.caseId && !cids[n2.caseId]) n2.caseId = '';
    });
    APP.data.items.forEach(function (it) { it.topicIds = it.topicIds.filter(function (id) { return tids[id]; }); });
    APP.data.tasks.forEach(function (t2) {
      if (t2.subjectType === 'item' && !ids[t2.subjectId]) { t2.subjectType = 'none'; t2.subjectId = ''; t2.subjectLabel = ''; }
      if (t2.subjectType === 'topic' && !tids[t2.subjectId]) { t2.subjectType = 'none'; t2.subjectId = ''; t2.subjectLabel = ''; }
      if (t2.subjectType === 'case' && !cids[t2.subjectId]) { t2.subjectType = 'none'; t2.subjectId = ''; t2.subjectLabel = ''; }
    });
    markDirty({ immediate: true });
    render();
    toast('演示数据已清除');
  }
  function addDemoData() {
    var seed = seedData();
    var existing = {};
    APP.data.items.forEach(function (x) { existing[x.id] = 1; });
    var added = 0;
    ['items', 'topics', 'notes', 'tasks', 'cases'].forEach(function (k) {
      seed[k].forEach(function (row) {
        if (!existing[row.id]) { APP.data[k].unshift(row); added++; }
      });
    });
    markDirty({ immediate: true });
    render();
    toast(added ? '已重新载入演示数据' : '演示数据已存在');
  }
