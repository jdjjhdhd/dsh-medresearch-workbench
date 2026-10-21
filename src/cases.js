  /* ================================================================
     病例与医学问题
     ================================================================ */
  function renderCases() {
    var cases = APP.data.cases.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var html = '<div class="page">' + demoBanner();
    html += pageHead('病例与医学问题', '病例独立保存；用户提供的信息与 AI 生成内容分开展示。外部检索只发送你明确填写的“研究关键词”，不会自动上传病例全文。',
      '<button class="btn btnPrimary" data-act="caseNew">＋ 新建病例</button>');
    html += '<div class="banner"><div class="grow"><b>隐私提示</b>：请先去标识化（姓名、身份证号、电话、住址、住院号等）。本窗口不会把病例自动发送到外部服务；只有你点击“复制并打开会话”或“用关键词检索”时，相应文本才会离开本页。</div></div>';
    if (!cases.length) {
      html += '<div class="card">' + emptyBox('还没有病例。可以新建一个虚构病例做流程演练，或录入已去标识化的真实病例。', '<br><button class="btnMini" data-act="caseNew">新建病例</button>') + '</div>';
      html += '</div>';
      return html;
    }
    html += '<div class="gridAuto">' + cases.map(function (c) {
      var items = c.itemIds.map(findItem).filter(Boolean);
      var notes = notesFor({ caseId: c.id });
      var tasks = caseTasks(c);
      return '<div class="card"><div class="cardHead"><h3 class="clickable" data-act="caseOpen" data-id="' + c.id + '">' + esc(c.title) + '</h3>' + (c.demo ? '<span class="chip chipWarn">演示</span>' : '') + '</div>' +
        '<div class="chips"><span class="chip chipKey mono">' + esc(c.code) + '</span><span class="chip chipAccent">' + items.length + ' 篇资料</span><span class="chip">' + notes.length + ' 笔记</span><span class="chip">' + tasks.length + ' 任务</span></div>' +
        '<div class="sub" style="margin-top:8px">主诉：' + esc(truncate(c.chief || '未填写', 80)) + '</div>' +
        '<div class="sub" style="margin-top:4px">问题：' + esc(truncate((c.questions || '未填写').replace(/\n/g, ' '), 90)) + '</div>' +
        '<div class="taskActions" style="margin-top:9px"><button class="btnMini" data-act="caseOpen" data-id="' + c.id + '">打开病例</button><button class="btnMini btnMiniDanger" data-act="caseDelete" data-id="' + c.id + '">删除</button></div>' +
        '</div>';
    }).join('') + '</div></div>';
    return html;
  }
  function newCase() {
    var c = normalizeCase({
      id: uid('cs'),
      code: '匿名-' + new Date().getFullYear() + '-' + String(APP.data.cases.length + 1).padStart(3, '0'),
      title: '未命名病例',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    APP.data.cases.unshift(c);
    markDirty({ immediate: true });
    openCase(c.id);
    setTimeout(function () {
      var el = document.getElementById('caseTitle');
      if (el) { el.focus(); el.select(); }
    }, 80);
  }
  function caseField(name, label, value, rows, placeholder) {
    return '<div class="field span2"><label>' + esc(label) + '</label>' +
      (rows ? '<textarea class="textarea" rows="' + rows + '" data-casefield="' + name + '" id="case_' + name + '" placeholder="' + esc(placeholder || '') + '">' + esc(value || '') + '</textarea>'
        : '<input class="input" data-casefield="' + name + '" id="case_' + name + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" />') + '</div>';
  }
  function renderCasePage() {
    var c = findCase(APP.route.caseId);
    if (!c) return '<div class="page"><div class="banner bannerBad"><div class="grow">病例不存在或已删除。</div><button class="btn btnMini" data-act="caseBack">返回列表</button></div></div>';
    var items = c.itemIds.map(findItem).filter(Boolean);
    var notes = notesFor({ caseId: c.id });
    var tasks = caseTasks(c);
    var html = '<div class="page" style="max-width:none">' + demoBanner();
    html += pageHead(c.title, '匿名编号 <span class="chip chipKey mono">' + esc(c.code) + '</span> · ' + (c.demo ? '<span class="chip chipWarn">演示病例</span> ' : '') + '用户提供的信息与 AI 生成内容分开保存。',
      '<button class="btn" data-act="caseBack">← 病例列表</button><button class="btn" data-act="caseSave">保存</button><button class="btn" data-act="caseNative">交给原生会话</button>');
    html += '<div class="caseLayout"><div class="caseForm">';
    html += '<div class="banner"><div class="grow"><b>来源标记</b>：下面各栏是你提供的信息（<span class="originBadge originUser">用户</span>），AI 不会自动改写。需要 AI 整理时，结果单独放在右侧标记为 <span class="originBadge originAi">AI</span>。</div></div>';
    html += '<div class="caseSection"><h3>基本信息 <span class="originBadge originUser">用户</span></h3><div class="formGrid">' +
      caseField('code', '匿名编号', c.code, 0, '不含姓名、住院号等直接标识') +
      caseField('title', '病例标题', c.title, 0, '例如：反复胸闷 3 个月') +
      caseField('chief', '主诉', c.chief, 2, '主要症状 + 持续时间') +
      '</div></div>';
    html += '<div class="caseSection"><h3>现病史 <span class="originBadge originUser">用户</span></h3>' + caseField('present', '现病史', c.present, 5, '起病、演变、伴随症状、诊疗经过…') + '</div>';
    html += '<div class="caseSection"><h3>既往史与检查 <span class="originBadge originUser">用户</span></h3><div class="formGrid">' +
      caseField('past', '既往史 / 用药 / 过敏史', c.past, 4, '慢病、用药、手术、过敏…') +
      caseField('exams', '检查资料', c.exams, 4, '体征、化验、影像、病理；注明单位和参考范围') +
      '</div></div>';
    html += '<div class="caseSection"><h3>待讨论的医学问题 <span class="originBadge originUser">用户</span></h3>' + caseField('questions', '问题列表', c.questions, 4, '每行一个问题；越具体越便于文献检索与讨论') + '</div>';
    html += '<div class="caseSection"><h3>研究关键词（仅此项可用于外部检索） <span class="originBadge originUser">用户</span></h3><div class="formGrid">' +
      caseField('keywords', '研究关键词', c.keywords, 2, '例如：type 2 diabetes cardiovascular risk；不要填写患者姓名或住院号') +
      '<div class="field span2"><div class="flex"><button class="btn btnMini" data-act="caseSearch">只用这些关键词检索文献</button><span class="muted">不会发送病例全文、检查结果或其他字段。</span></div></div>' +
      '</div></div>';
    html += '<div class="flex"><button class="btn btnPrimary" data-act="caseSave">保存病例</button><button class="btn" data-act="caseAi">AI 整理（可选）</button><button class="btn" data-act="caseNative">复制整理稿并打开会话</button></div>';
    html += '</div>';

    html += '<aside style="display:flex;flex-direction:column;gap:10px">';
    html += '<div class="card"><div class="cardHead"><h3>AI 整理结果</h3>' + (c.aiAt ? '<span class="chip chipTeal">AI</span>' : '<span class="chip">未生成</span>') + '</div>' +
      (c.aiSummary ? '<div class="aiBox">' + esc(c.aiSummary) + '</div>' + (c.aiTruncated ? '<div class="banner bannerWarn mt8"><div class="grow"><b>回答被截断</b>（' + esc(c.aiFinishReason || 'max-tokens') + '）；请缩短病例信息或提高服务端输出上限后重新整理。</div></div>' : '') + '<div class="muted" style="margin-top:6px">生成于 ' + esc(fmtDateTime(c.aiAt)) + '；AI 生成内容，需核对。</div>' : '<div class="muted">未配置模型或尚未生成。AI 只整理本页已提供的信息，不会补写缺失字段。</div>') +
      '<div class="taskActions" style="margin-top:8px"><button class="btnMini" data-act="caseAi">' + (c.aiSummary ? '重新整理' : '生成整理稿') + '</button></div></div>';
    html += '<div class="card"><div class="cardHead"><h3>相关资料（' + items.length + '）</h3><button class="btnMini" data-act="caseLinkItem">＋ 关联</button></div>' +
      (items.length ? items.map(function (it) {
        return '<div class="noteCard"><div class="b" style="font-size:11.5px">' + esc(it.title) + '</div><div class="f"><span class="chip">' + esc(it.type) + '</span><span class="chip chipKey mono">' + esc(it.pmid ? 'PMID ' + it.pmid : it.doi ? 'DOI ' + it.doi : '') + '</span><button class="btnMini" data-act="read" data-id="' + it.id + '">阅读</button><button class="btnMini btnMiniDanger" data-act="caseUnlinkItem" data-item="' + it.id + '">移除</button></div></div>';
      }).join('') : '<div class="muted">还没有关联文献。可把研究问题关联到资料库中的证据。</div>') + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>病例笔记（' + notes.length + '）</h3><button class="btnMini" data-act="caseNoteNew" data-id="' + c.id + '">＋ 笔记</button></div>' +
      (notes.length ? notes.map(function (n) { return noteCardHtml(n); }).join('') : '<div class="muted">还没有病例笔记。</div>') + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>关联任务（' + tasks.length + '）</h3><button class="btnMini" data-act="taskNew" data-subject="case" data-subjectid="' + c.id + '" data-subjectlabel="' + esc(c.title) + '">＋ 任务</button></div>' +
      (tasks.length ? tasks.map(taskCardHtml).join('') : '<div class="muted">还没有任务。</div>') + '</div>';
    html += '<div class="card"><div class="cardHead"><h3>隐私与边界</h3></div><div class="sub">· 本窗口不会把病例自动发送到外部检索或模型；<br>· 「交给原生会话」会把下方整理稿复制到剪贴板，是否发送由你决定；<br>· AI 输出仅供研究与讨论，不替代执业医师对患者的直接评估。</div></div>';
    html += '</aside></div></div>';
    return html;
  }
  function collectCaseForm() {
    var c = findCase(APP.route.caseId);
    if (!c) return null;
    document.querySelectorAll('[data-casefield]').forEach(function (el) {
      var key = el.getAttribute('data-casefield');
      if (key === 'code') c.code = str(el.value) || c.code;
      else if (key === 'title') c.title = str(el.value) || '未命名病例';
      else c[key] = str(el.value);
    });
    c.updatedAt = Date.now();
    return c;
  }
  function saveCaseForm() {
    var c = collectCaseForm();
    if (!c) return;
    markDirty({ immediate: true });
    render();
    toast('病例已保存');
  }
  function flushCaseForm() {
    if (APP.section !== 'cases' || !APP.route.caseId) return;
    var c = collectCaseForm();
    if (c) markDirty({ immediate: true });
  }
  var caseSaveTimer = null;
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el.matches || !el.matches('[data-casefield]')) return;
    clearTimeout(caseSaveTimer);
    caseSaveTimer = setTimeout(function () {
      var c = collectCaseForm();
      if (!c) return;
      markDirty();
    }, 600);
  });
  function deleteCase(id) {
    var c = findCase(id);
    if (!c) return;
    if (!window.confirm('删除病例「' + c.title + '」？关联笔记与任务会保留，但不再关联此病例。')) return;
    APP.data.cases = APP.data.cases.filter(function (x) { return x.id !== id; });
    APP.data.notes.forEach(function (n) { if (n.caseId === id) n.caseId = ''; });
    APP.data.tasks.forEach(function (t) { if (t.subjectType === 'case' && t.subjectId === id) { t.subjectType = 'none'; t.subjectId = ''; } });
    if (APP.route.caseId === id) APP.route.caseId = '';
    markDirty({ immediate: true });
    render();
    toast('病例已删除');
  }
  function openCaseItemPicker() {
    var c = findCase(APP.route.caseId);
    if (!c) return;
    var options = APP.data.items.filter(function (it) { return c.itemIds.indexOf(it.id) < 0; });
    if (!options.length) { toast('资料库中没有可关联的其他资料'); return; }
    var body = '<div class="field"><label>选择要关联的资料</label><select class="select" name="itemId">' + options.map(function (it) { return '<option value="' + it.id + '">' + esc(truncate(it.title, 90)) + '</option>'; }).join('') + '</select></div><div class="hint">关联只保存文献题录关系，不复制全文。</div>';
    openModal({
      title: '关联资料',
      body: body,
      submitLabel: '关联',
      onSubmit: function (fd) {
        var id = str(fd.get('itemId'));
        if (id && c.itemIds.indexOf(id) < 0) c.itemIds.push(id);
        c.updatedAt = Date.now();
        markDirty({ immediate: true });
        closeModal();
        render();
        toast('已关联资料');
      }
    });
  }
  function unlinkCaseItem(itemId) {
    var c = findCase(APP.route.caseId);
    if (!c) return;
    c.itemIds = c.itemIds.filter(function (x) { return x !== itemId; });
    c.updatedAt = Date.now();
    markDirty({ immediate: true });
    render();
  }
  function caseToSearch() {
    var c = collectCaseForm();
    if (!c) return;
    var kw = str(c.keywords);
    if (!kw) { toast('请先填写研究关键词'); return; }
    APP.section = 'search';
    APP.route = { section: 'search' };
    APP.ui.search.tab = 'lit';
    APP.ui.search.q = kw;
    navigateHash();
    render();
    setTimeout(function () { runSearch(); }, 50);
    toast('仅使用研究关键词检索，未发送病例内容');
  }
  function buildCasePack(c) {
    var items = c.itemIds.map(findItem).filter(Boolean);
    var notes = notesFor({ caseId: c.id });
    var tasks = caseTasks(c);
    return '# 医学病例讨论交接单（医学研究工作台）\n\n' +
      '- 匿名编号：' + c.code + '\n- 标题：' + c.title + '\n- 整理时间：' + fmtDateTime(Date.now()) + '\n\n' +
      '## 用户提供的信息（未经 AI 改写）\n\n### 主诉\n' + (c.chief || '未提供') + '\n\n### 现病史\n' + (c.present || '未提供') + '\n\n### 既往史 / 用药 / 过敏史\n' + (c.past || '未提供') + '\n\n### 检查资料\n' + (c.exams || '未提供') + '\n\n### 待讨论的医学问题\n' + (c.questions || '未提供') + '\n\n' +
      '## 相关资料（仅题录）\n' + (items.length ? items.map(function (it) { return '- ' + it.title + (it.doi ? ' · DOI ' + it.doi : '') + (it.pmid ? ' · PMID ' + it.pmid : ''); }).join('\n') : '（无）') + '\n\n' +
      '## 我的笔记\n' + (notes.length ? notes.map(function (n) { return '- ' + n.body; }).join('\n') : '（无）') + '\n\n' +
      '## 待办任务\n' + (tasks.length ? tasks.map(function (t) { return '- [' + TASK_STATUS[t.status] + '] ' + t.title + (t.due ? '（截止 ' + t.due + '）' : ''); }).join('\n') : '（无）') + '\n\n' +
      '## 请协助\n请先确认哪些信息缺失，再围绕上述问题给出循证讨论要点。不得补写未提供的症状、体征、检查或用药；涉及具体患者决策时，请提示由执业医师结合现场评估。\n';
  }
  function sendCaseToNative() {
    var c = collectCaseForm();
    if (!c) return;
    var pack = buildCasePack(c);
    var embedded = !!findNativeComposer();
    var body = '<div class="banner"><div class="grow">' + (embedded
      ? '检测到同一 DSH 窗口的原生输入框。点击下方按钮会把病例整理稿放入输入框，<b>不会自动发送</b>；请先检查隐私与措辞再决定是否发送。'
      : '当前不在 DSH 原生窗口内（或未找到输入框）。点击按钮会复制整理稿；请粘贴到原生会话并自行确认是否发送。') + '</div></div>' +
      '<div class="field"><label>整理稿预览（含病例信息，请确认可对外发送）</label><textarea class="textarea" rows="14" readonly>' + esc(pack) + '</textarea></div>';
    openModal({
      title: '交给原生会话',
      body: body,
      submitLabel: embedded ? '放入原生草稿（不发送）' : '复制整理稿',
      onSubmit: async function () {
        var res = await putNativeDraft(pack);
        if (res.ok) {
          toast('病例整理稿已放入原生输入框，请检查后自行发送（未自动发送）。');
          return true;
        }
        var ok = res.copied;
        if (!ok) ok = await copyText(pack);
        if (!embedded) {
          try { window.open('/', '_blank', 'noopener'); } catch (e) {}
        }
        toast(ok ? '未找到可写入的原生输入框，已复制病例整理稿；请粘贴到原生会话。' : '复制失败，请手动复制上方内容');
        return true;
      }
    });
  }
  async function organizeCaseWithAi() {
    var c = collectCaseForm();
    if (!c) return;
    var text = buildCasePack(c);
    toast('正在生成 AI 整理稿…');
    try {
      var result = await askHostModel({
        question: '请整理这份病例：列出信息缺口、需要澄清的矛盾点，并围绕待讨论问题给出循证讨论框架。',
        itemTitle: '病例整理：' + c.title,
        kind: 'case',
        chunks: [{ label: 'C1', page: '', text: text }]
      });
      c.aiSummary = result.answer;
      c.aiAt = Date.now();
      c.aiTruncated = !!result.truncated;
      c.aiFinishReason = result.finishReason || '';
      c.updatedAt = Date.now();
      markDirty({ immediate: true });
      render();
      toast(result.truncated ? 'AI 整理稿已生成，但输出被截断（' + (result.finishReason || 'max-tokens') + '），请核对' : 'AI 整理稿已生成，请核对后再使用');
    } catch (err) {
      toast('AI 整理失败：' + apiErrorMessage(err));
    }
  }
  function caseTaskCreate(c) {
    openTaskModal({ subjectType: 'case', subjectId: c.id, subjectLabel: c.title, title: '病例讨论：' + c.title });
  }
