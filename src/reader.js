  /* ================================================================
     文献阅读台
     ================================================================ */
  function readerItems() {
    var f = APP.ui.reader;
    var q = str(f.q).toLowerCase();
    return APP.data.items.filter(function (it) {
      if (f.filter === 'unread' && it.readStatus !== 'unread') return false;
      if (f.filter === 'reading' && it.readStatus !== 'reading') return false;
      if (f.filter === 'star' && !it.starred) return false;
      if (f.filter === 'pdf' && !it.filePath && !it.attachmentKey) return false;
      if (q && (it.title + ' ' + (it.authors || []).join(' ') + ' ' + it.journal).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || b.addedAt - a.addedAt;
    });
  }
  function readerDocListHtml() {
    var list = readerItems();
    return '<div class="docList">' +
      '<div class="docListHead"><input class="input" id="readerQ" data-readerq placeholder="搜索阅读列表…" value="' + esc(APP.ui.reader.q) + '" /><div class="flex" style="margin-top:6px"><select class="select" data-readerfilter style="width:auto;height:26px;font-size:10.5px">' +
      [['all', '全部'], ['unread', '未读'], ['reading', '在读'], ['star', '收藏'], ['pdf', '有 PDF']].map(function (x) { return '<option value="' + x[0] + '"' + (APP.ui.reader.filter === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') +
      '</select><span class="muted">' + list.length + ' 篇</span></div></div>' +
      '<div class="docListScroll">' + (list.length ? list.map(function (it) {
        return '<div class="docItem ' + (it.id === READER.itemId ? 'docItemOn' : '') + '" data-act="readerSelect" data-id="' + it.id + '"><div class="t">' + (it.starred ? '★ ' : '') + esc(it.title) + '</div><div class="m">' + statusPill(it.readStatus) + ' ' + esc(it.year || '') + (it.filePath || it.attachmentKey ? ' · PDF' : ' · 题录') + '</div></div>';
      }).join('') : '<div class="empty">没有匹配的资料。</div>') + '</div></div>';
  }
  function readerStatusBadge() {
    if (READER.loading) return '<span class="statusChip warn"><span class="dot"></span>解析原文…</span>';
    if (READER.status === 'ready') {
      var hasText = READER.textChunks.length > 0 || Object.keys(READER.pageTextCache).length > 0;
      return '<span class="statusChip ' + (hasText ? 'ok' : 'warn') + '"><span class="dot"></span>' + (hasText ? '已读取全文 · ' + READER.numPages + ' 页' : '已渲染 · 未提取到文本') + '</span>';
    }
    if (READER.status === 'fulltext') return '<span class="statusChip ok"><span class="dot"></span>已读取全文（粘贴/索引）</span>';
    if (READER.status === 'abstract') return '<span class="statusChip warn"><span class="dot"></span>仅摘要</span>';
    if (READER.status === 'error') return '<span class="statusChip bad"><span class="dot"></span>原文解析失败</span>';
    return '<span class="statusChip"><span class="dot"></span>未打开原文</span>';
  }
  function renderReader() {
    var item = READER.itemId ? findItem(READER.itemId) : null;
    var html = '<div class="page" style="max-width:none">' + demoBanner();
    if (!item) {
      html += pageHead('文献阅读台', '从左侧选择一篇资料，或先去资料库加入 PDF。阅读台支持页码、缩放、文本选择、批注与单篇问答。');
      html += '<div class="card">' + emptyBox('还没有选择要阅读的资料。', '<br><button class="btnMini" data-act="nav" data-section="library">去资料库选择</button>') + '</div></div>';
      return html;
    }
    html += '<div class="readerShell" id="readerShell">' + readerDocListHtml();
    html += '<div class="readerMain">' + readerToolbarHtml(item) + '<div class="readerStage" id="pdfStage">' + readerStageHtml(item) + '</div></div>';
    html += '<aside class="readerAside">' + readerAsideHtml(item) + '</aside>';
    html += '</div></div>';
    return html;
  }
  function readerToolbarHtml(item) {
    var pageCtl = '';
    if (READER.status === 'ready') {
      pageCtl = '<button class="btnMini" data-act="readerPrev" title="上一页">‹</button>' +
        '<input class="pageInput" id="pageInput" value="' + READER.page + '" aria-label="页码" />' +
        '<span class="muted">/ ' + READER.numPages + '</span>' +
        '<button class="btnMini" data-act="readerNext" title="下一页">›</button>' +
        '<button class="btnMini" data-act="zoomOut" title="缩小">−</button><span class="muted">' + (READER.fit ? '适宽' : Math.round(READER.scale * 100) + '%') + '</span><button class="btnMini" data-act="zoomIn" title="放大">＋</button>' +
        '<button class="btnMini ' + (READER.fit ? 'btnMiniOn' : '') + '" data-act="zoomFit" title="适应宽度">适宽</button>';
    }
    return '<div class="readerToolbar"><button class="btnMini" data-act="toggleDocList" title="打开列表">☰</button>' +
      '<span class="title" title="' + esc(item.title) + '">' + esc(item.title) + '</span>' + readerStatusBadge() + pageCtl +
      '<button class="btnMini" data-act="toggleAside" title="笔记与问答">笔记/问答</button>' +
      '<button class="btnMini" data-act="sendNative" title="交给原生会话">↗ 会话</button></div>';
  }
  function readerStageHtml(item) {
    if (READER.loading) {
      return '<div class="pdfState"><span class="spin" style="display:inline-block;vertical-align:-2px"></span> 正在读取并解析 PDF（首次打开大文件可能需要几秒）…</div>';
    }
    if (READER.status === 'ready') {
      return '<div class="pdfPage" id="pdfPage"><canvas id="pdfCanvas"></canvas><div class="textLayer" id="textLayer"></div><div class="hlLayer" id="hlLayer"></div></div>';
    }
    if (READER.status === 'error') {
      return '<div class="pdfState"><b>原文解析失败</b><br>' + esc(READER.error || '未知错误') + '<br><span class="muted">文件可能不是有效 PDF、路径不可访问，或 PDF 已损坏。</span><div class="flex" style="justify-content:center;margin-top:10px"><button class="btn btnMini" data-act="reloadPdf">重新解析</button><button class="btn btnMini" data-act="openPdfFile">尝试打开原文件</button><button class="btn btnMini" data-act="pasteFulltext">粘贴全文</button></div></div>';
    }
    if (READER.status === 'fulltext') {
      return '<div class="readerText" id="readerText"><div class="chips" style="margin-bottom:10px"><span class="chip chipTeal">已读取全文</span><span class="chip">' + (item.fulltext || '').length + ' 字符</span></div>' + (item.fulltext || '').split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
    }
    if (READER.status === 'abstract') {
      var meta = '<div class="chips" style="margin-bottom:10px"><span class="chip chipWarn">仅摘要</span><span class="chip">未读取全文</span>' + (item.doi ? '<span class="chip chipKey mono">DOI ' + esc(item.doi) + '</span>' : '') + (item.pmid ? '<span class="chip chipKey mono">PMID ' + esc(item.pmid) + '</span>' : '') + '</div>';
      return '<div class="readerText" id="readerText">' + meta + '<h3>' + esc(item.title) + '</h3><div class="muted" style="margin-bottom:12px">' + esc(itemMetaLine(item)) + '</div>' + (item.abstract ? item.abstract.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') : '<p class="muted">没有可用的摘要或全文。可以为本资料关联自己的 PDF，或粘贴全文后再提问。</p>') + '<div class="flex" style="margin-top:14px"><button class="btn btnPrimary btnMini" data-act="attachPdf" data-id="' + esc(item.id) + '">为本资料选择 / 关联 PDF</button><button class="btn btnMini" data-act="pasteFulltext">粘贴全文以提高问答依据</button>' + (item.url ? '<button class="btn btnMini" data-act="openExternal" data-url="' + esc(item.url) + '">打开来源链接</button>' : '') + '</div></div>';
    }
    if (READER.status === 'idle') {
      return '<div class="pdfState">正在准备原文…</div>';
    }
    return '<div class="pdfState">尚未读取原文。</div>';
  }
  function readerAsideHtml(item) {
    var tab = APP.ui.reader.tab;
    var tabs = '<div class="asideTabs"><button class="tab ' + (tab === 'notes' ? 'tabOn' : '') + '" data-act="readerTab" data-tab="notes">笔记</button><button class="tab ' + (tab === 'qa' ? 'tabOn' : '') + '" data-act="readerTab" data-tab="qa">问答</button><button class="tab ' + (tab === 'info' ? 'tabOn' : '') + '" data-act="readerTab" data-tab="info">信息</button></div>';
    var body = '';
    if (tab === 'qa') body = readerQaHtml(item);
    else if (tab === 'info') body = readerInfoHtml(item);
    else body = readerNotesHtml(item);
    return tabs + '<div class="asideBody">' + body + '</div>';
  }
  function readerNotesHtml(item) {
    var notes = notesFor({ itemId: item.id }).slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var anns = (item.annotations || []).slice().reverse();
    var html = '<div class="flex" style="justify-content:space-between"><span class="muted">' + notes.length + ' 条笔记 · ' + anns.length + ' 条批注</span><button class="btnMini" data-act="noteNew" data-item="' + item.id + '">＋ 笔记</button></div>';
    if (anns.length) {
      html += '<div class="cardHead" style="margin:8px 0 0"><h3>批注</h3></div>';
      html += anns.slice(0, 30).map(function (a) {
        return '<div class="noteCard"><div class="q">“' + esc(truncate(a.quote || a.comment, 150)) + '”</div>' +
          (a.comment ? '<div class="b">' + esc(a.comment) + '</div>' : '') +
          '<div class="f"><span class="chip chipAccent">第 ' + esc(a.page || '?') + ' 页</span>' + (a.source === 'zotero' ? '<span class="chip chipTeal">Zotero 导入</span>' : '') + (a.sourceRef ? '<span class="chip">' + esc(a.sourceRef) + '</span>' : '') + '<span class="chip">' + esc(relTime(a.createdAt)) + '</span></div>' +
          '<div class="taskActions"><button class="btnMini" data-act="locateAnnotation" data-id="' + a.id + '">定位</button><button class="btnMini btnMiniDanger" data-act="deleteAnnotation" data-id="' + a.id + '">删除</button></div></div>';
      }).join('');
    }
    html += '<div class="cardHead" style="margin:10px 0 0"><h3>阅读笔记</h3></div>';
    html += notes.length ? notes.map(function (n) { return noteCardHtml(n); }).join('') : '<div class="muted">还没有笔记。选中 PDF 文本可把原文、页码一起写入。</div>';
    return html;
  }
  function readerQaHtml(item) {
    var qa = (item.qa || []).slice().reverse();
    var hasText = READER.textChunks.length > 0 || (item.fulltext && item.fulltext.length > 40) || (item.abstract && item.abstract.length > 40);
    var html = '<div class="banner ' + (READER.status === 'ready' ? 'bannerOk' : READER.status === 'abstract' ? 'bannerWarn' : '') + '"><div class="grow">' + (READER.status === 'ready' ? (READER.textChunks.length ? '<b>已读取全文</b>，回答只依据已提取的原文段落，并尽量给出页码。' : '<b>已渲染但未提取到文本</b>（可能为扫描版）。可粘贴全文后再提问。') : READER.status === 'abstract' ? '<b>仅摘要</b>：可基于摘要提问，不能假装读过全文。' : READER.status === 'fulltext' ? '<b>已读取全文</b>（粘贴/索引文本）。' : READER.status === 'error' ? '<b>原文解析失败</b>：问答将缺少原文依据。' : '尚未读取原文。') + '</div></div>' +
      '<div class="flex"><input class="input grow" id="askInput" placeholder="就这篇论文提问，例如：主要终点是什么？" /><button class="btn btnPrimary" data-act="askPaper">提问</button></div>' +
      '<div class="chips">' +
      ['这篇论文的主要终点与效应量是什么？', '研究设计与样本量的局限有哪些？', '结论是否适用于我的研究人群？'].map(function (q) { return '<button class="chip chipGhost clickable" data-act="askSuggestion" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') +
      '</div>' +
      '<div class="muted">模型来源由顶栏「模型」设置决定（DSH 会话模型或自定义 OpenAI 兼容 API）；未配置或调用失败时只做原文片段检索，不会伪造 AI 回答。' + (READER.numPages > 60 ? ' 问答仅索引前 60 页。' : '') + '</div>';
    if (READER.qaBusy) html += '<div class="loadingRow"><span class="spin"></span>正在基于已读取内容生成回答…</div>';
    if (READER.qaError) html += '<div class="banner bannerBad"><div class="grow">' + esc(READER.qaError) + '</div></div>';
    html += qa.length ? qa.map(function (row) {
      return '<div class="qaBubble user"><div class="q">' + esc(row.question) + '</div></div>' +
        '<div class="qaBubble ai"><div class="a">' + esc(row.answer || '') + '</div>' +
        (row.citations && row.citations.length ? '<div class="citations">' + row.citations.map(function (c) { return '<button class="citeChip" data-act="locatePage" data-page="' + esc(c.page) + '">[' + esc(c.label) + '] 第 ' + esc(c.page || '?') + ' 页</button>'; }).join('') + '</div>' : '') +
        '<div class="f muted" style="margin-top:5px">' + (row.origin === 'ai' ? 'AI 生成 · 依据已读取片段' : '本地检索 · 未调用模型') + (row.grounded ? ' · 引用可定位' : '') + ' · ' + esc(relTime(row.createdAt)) + '</div>' +
        (row.origin === 'ai' && (row.providerLabel || row.model) ? '<div class="f" style="margin-top:4px"><span class="chip chipTeal">' + esc((row.providerLabel || row.provider || '模型') + ' / ' + (row.model || '')) + '</span>' + (row.source === 'session' ? '<span class="chip">跟随当前会话</span>' : row.source === 'default' ? '<span class="chip">DSH 默认模型</span>' : row.source === 'custom' ? '<span class="chip">自定义 API</span>' : '') + (row.truncated ? '<span class="chip chipWarn">回答被截断：' + esc(row.finishReason || 'max-tokens') + '</span>' : '') + (row.configNote ? '<span class="chip chipWarn">' + esc(row.configNote) + '</span>' : '') + '</div>' : '') +
        '</div>';
    }).join('') : '<div class="muted">还没有问答记录。</div>';
    return html;
  }
  function readerInfoHtml(item) {
    var textLen = READER.textChunks.reduce(function (n, c) { return n + c.text.length; }, 0);
    return '<div class="kv">' +
      '<div class="k">状态</div><div class="v">' + readerStatusBadge() + '</div>' +
      '<div class="k">类型</div><div class="v">' + esc(item.type) + '</div>' +
      '<div class="k">期刊</div><div class="v">' + esc(item.journal || '—') + '</div>' +
      '<div class="k">年份</div><div class="v">' + esc(item.year || '—') + '</div>' +
      '<div class="k">DOI</div><div class="v mono">' + esc(item.doi || '—') + '</div>' +
      '<div class="k">PMID</div><div class="v mono">' + esc(item.pmid || '—') + '</div>' +
      '<div class="k">Zotero</div><div class="v mono">' + esc(item.zoteroRef || '—') + '</div>' +
      '<div class="k">来源</div><div class="v">' + esc((item.source && item.source.label) || '—') + '</div>' +
      '<div class="k">文件</div><div class="v"><span class="pathCode">' + esc(item.filePath || (item.attachmentKey ? 'Zotero 附件 ' + item.attachmentKey : '—')) + '</span></div>' +
      '<div class="k">页数</div><div class="v">' + (READER.numPages || '—') + '</div>' +
      '<div class="k">可问答文本</div><div class="v">' + (textLen ? textLen.toLocaleString() + ' 字符 · ' + READER.textChunks.length + ' 段' : (READER.status === 'abstract' ? '仅摘要' : '尚未提取')) + '</div>' +
      '</div>' +
      '<div class="divider"></div><div class="flex">' + (!item.filePath && !item.attachmentKey ? '<button class="btn btnPrimary btnMini" data-act="attachPdf" data-id="' + esc(item.id) + '">关联本地 PDF</button>' : '') + '<button class="btn btnMini" data-act="reloadPdf">重新解析</button><button class="btn btnMini" data-act="openPdfFile">打开原文件</button><button class="btn btnMini" data-act="pasteFulltext">粘贴全文</button><button class="btn btnMini" data-act="sendNative">交给原生会话</button></div>' +
      '<div class="sub mt12">批注只记录当前 PDF 的页码与引文；如果原文版本不同，页码可能不一致。无法定位的引文会如实显示，不生成不存在的页码。</div>';
  }

  /* ---------------- 打开与解析 PDF ---------------- */
  function resolvePdfUrl(item) {
    if (item.attachmentKey) {
      if (!bridgeIdentityMatches(APP.bridge.health) || APP.bridge.verifiedUrl !== APP.bridge.url) {
        throw new Error('本地文件服务尚未通过当前项目目录校验，请先启动或重试服务');
      }
      return APP.bridge.url + '/zotero/file?key=' + encodeURIComponent(item.attachmentKey);
    }
    var p = str(item.filePath);
    if (!p) return '';
    if (/^https?:/i.test(p)) return p;
    var abs = p;
    if (!/^[A-Za-z]:[\\/]/.test(p) && !/^\\\\/.test(p)) {
      var dir = projectDir();
      if (dir) abs = joinPath(dir, p.replace(/^[\\/]+/, '').split(/[\\/]/).join('/'));
    }
    return '/api/worktable/file?path=' + encodeURIComponent(abs);
  }
  function tryOpenReaderItem(id) {
    var item = findItem(id);
    if (!item) return;
    READER.loading = true;
    READER.status = 'idle';
    READER.error = '';
    render();
    if (item.attachmentKey || item.filePath) {
      loadPdf(item);
    } else if (item.fulltext) {
      READER.loading = false;
      READER.status = 'fulltext';
      READER.textChunks = chunksFromText(item.fulltext, null);
      render();
    } else {
      READER.loading = false;
      READER.status = 'abstract';
      READER.textChunks = item.abstract ? chunksFromText(item.abstract, '') : [];
      render();
    }
  }
  async function loadPdf(item) {
    var token = ++READER.docToken;
    READER.loading = true;
    READER.status = 'idle';
    READER.error = '';
    render();
    if (!window.pdfjsLib) {
      READER.loading = false;
      READER.status = 'error';
      READER.error = 'PDF.js 未加载（vendor/pdfjs/pdf.min.js）';
      render();
      return;
    }
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      if (!pdfjsLib.__medwbScalePatch) {
        var originalRenderTextLayer = pdfjsLib.renderTextLayer;
        pdfjsLib.renderTextLayer = function (params) {
          if (params && params.container && params.viewport) {
            params.container.style.setProperty('--scale-factor', String(params.viewport.scale));
          }
          return originalRenderTextLayer(params);
        };
        pdfjsLib.__medwbScalePatch = true;
      }
      var url = resolvePdfUrl(item);
      if (!url) throw new Error('没有可用的 PDF 地址');
      var loadingTask = pdfjsLib.getDocument({
        url: url,
        httpHeaders: bridgeRequestPath(url) ? { 'x-medresearch-project-root': encodeURIComponent(projectDir()) } : undefined,
        cMapUrl: './vendor/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: './vendor/pdfjs/standard_fonts/',
        disableRange: true,
        disableStream: true
      });
      var pdf = await loadingTask.promise;
      if (token !== READER.docToken) { try { pdf.destroy(); } catch (e) {} return; }
      READER.pdf = pdf;
      READER.numPages = pdf.numPages;
      READER.page = 1;
      READER.loading = false;
      READER.status = 'ready';
      READER.pageTextCache = {};
      READER.textChunks = [];
      render();
      await renderPdfPage(1, true);
      await buildChunksFromPdf();
      if (token === READER.docToken) render();
    } catch (err) {
      if (token !== READER.docToken) return;
      READER.loading = false;
      READER.status = 'error';
      READER.error = apiErrorMessage(err);
      render();
    }
  }
  async function renderPdfPage(pageNo, resetScroll) {
    if (!READER.pdf) return;
    var token = ++READER.renderToken;
    pageNo = clamp(pageNo, 1, READER.numPages);
    READER.page = pageNo;
    var page;
    try { page = await READER.pdf.getPage(pageNo); } catch (e) { return; }
    if (token !== READER.renderToken) return;
    var canvas = $('#pdfCanvas');
    var textLayer = $('#textLayer');
    var hlLayer = $('#hlLayer');
    if (!canvas || !textLayer) return;
    var base = page.getViewport({ scale: 1 });
    var stage = $('#pdfStage');
    var scale = READER.scale;
    if (READER.fit && stage) scale = Math.max(0.3, Math.min(3, (stage.clientWidth - 34) / base.width));
    READER.lastScale = scale;
    var viewport = page.getViewport({ scale: scale });
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    } catch (e) {}
    if (token !== READER.renderToken) return;
    textLayer.style.width = Math.floor(viewport.width) + 'px';
    textLayer.style.height = Math.floor(viewport.height) + 'px';
    textLayer.style.setProperty('--scale-factor', String(viewport.scale));
    document.documentElement.style.setProperty('--scale-factor', String(viewport.scale));
    var pageEl = $('#pdfPage');
    if (pageEl) {
      pageEl.style.width = Math.floor(viewport.width) + 'px';
      pageEl.style.height = Math.floor(viewport.height) + 'px';
      pageEl.style.setProperty('--scale-factor', String(viewport.scale));
    }
    textLayer.innerHTML = '';
    try {
      var tc = await page.getTextContent();
      if (token !== READER.renderToken) return;
      READER.pageTextCache[pageNo] = tc.items.map(function (it) { return it.str || ''; }).join(' ').replace(/\s+/g, ' ').trim();
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: textLayer, viewport: viewport, textDivs: [] }).promise;
    } catch (e) {
      /* 文本层失败时仍保留 canvas，阅读不中断 */
    }
    drawHighlights(pageNo);
    var input = $('#pageInput');
    if (input) input.value = pageNo;
    if (resetScroll) {
      var stageEl = $('#pdfStage');
      if (stageEl) stageEl.scrollTop = 0;
    }
  }
  function chunksFromText(text, page) {
    var clean = str(text);
    if (!clean) return [];
    var chunks = [];
    var size = 1600;
    for (var i = 0; i < clean.length; i += size) {
      var part = clean.slice(i, i + size).trim();
      if (part.length < 20) continue;
      chunks.push({ label: 'P' + (chunks.length + 1), page: page == null ? '' : String(page), text: part });
    }
    return chunks;
  }
  async function extractPageText(pageNo) {
    if (READER.pageTextCache[pageNo] != null) return READER.pageTextCache[pageNo];
    var page = await READER.pdf.getPage(pageNo);
    var tc = await page.getTextContent();
    var text = tc.items.map(function (it) { return it.str || ''; }).join(' ').replace(/\s+/g, ' ').trim();
    READER.pageTextCache[pageNo] = text;
    return text;
  }
  async function buildChunksFromPdf() {
    if (!READER.pdf) return;
    var chunks = [];
    var pages = Math.min(READER.numPages, 60);
    for (var p = 1; p <= pages; p++) {
      var text = '';
      try { text = await extractPageText(p); } catch (e) { continue; }
      if (!text || text.length < 20) continue;
      var pageParts = chunksFromText(text, p);
      pageParts.forEach(function (c) {
        chunks.push({ label: 'P' + (chunks.length + 1), page: c.page, text: c.text });
      });
      if (chunks.length >= 120) break;
    }
    READER.textChunks = chunks;
  }
  function reloadPdf() {
    var item = findItem(READER.itemId);
    if (!item) return;
    if (READER.pdf) { try { READER.pdf.destroy(); } catch (e) {} }
    READER.pdf = null;
    READER.textChunks = [];
    READER.pageTextCache = {};
    READER.status = 'idle';
    READER.loading = false;
    tryOpenReaderItem(item.id);
  }
  function openPdfFile() {
    var item = findItem(READER.itemId);
    if (!item) return;
    var url = resolvePdfUrl(item);
    if (!url) { toast('没有可打开的原文文件'); return; }
    window.open(url, '_blank', 'noopener');
  }
  function openPasteFulltextModal() {
    var item = findItem(READER.itemId);
    if (!item) return;
    var body = '<div class="banner"><div class="grow">粘贴你实际读到的全文（例如从出版社或机构订阅获得的文本）。只有粘贴后，问答才会把它当作依据；此操作不会自动上传到外部服务。</div></div>' +
      '<div class="field"><label>全文文本</label><textarea class="textarea" name="text" rows="12" placeholder="粘贴全文…">' + esc(item.fulltext || '') + '</textarea></div>';
    openModal({
      title: '粘贴原文全文',
      body: body,
      submitLabel: '保存全文',
      onSubmit: function (fd) {
        var text = str(fd.get('text'));
        if (text.length < 40) { toast('全文太短，请检查是否粘贴完整'); return false; }
        item.fulltext = text;
        item.updatedAt = Date.now();
        item.source = item.source || { type: 'manual', label: '手动粘贴全文', at: Date.now() };
        if (item.source.label === '手动登记') item.source.label = '手动登记 + 粘贴全文';
        READER.status = 'fulltext';
        READER.textChunks = chunksFromText(text, null);
        markDirty({ immediate: true });
        closeModal();
        render();
        toast('全文已保存，可用于本窗口问答');
      }
    });
  }

  /* ---------------- 页码 / 缩放 ---------------- */
  function pageStep(delta) {
    if (READER.status !== 'ready') return;
    var p = clamp(READER.page + delta, 1, READER.numPages);
    renderPdfPage(p, true);
    updatePageInput(p);
  }
  function goToPage(p) {
    if (READER.status !== 'ready') return;
    var n = clamp(parseInt(p, 10) || 1, 1, READER.numPages);
    renderPdfPage(n, true);
    updatePageInput(n);
  }
  function updatePageInput(p) {
    var input = $('#pageInput');
    if (input) input.value = p;
  }
  function zoomStep(delta) {
    if (READER.fit) READER.scale = READER.lastScale || READER.scale;
    READER.fit = false;
    READER.scale = clamp(Number((READER.scale + delta).toFixed(2)), 0.35, 3);
    renderPdfPage(READER.page, false);
    renderReaderToolbarOnly();
  }
  function toggleFit() {
    READER.fit = !READER.fit;
    renderPdfPage(READER.page, false);
    renderReaderToolbarOnly();
  }
  function renderReaderToolbarOnly() {
    var item = findItem(READER.itemId);
    if (!item) return;
    var host = $('.readerToolbar');
    if (!host) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = readerToolbarHtml(item);
    host.replaceWith(tmp.firstChild);
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.target && ev.target.id === 'pageInput' && ev.key === 'Enter') {
      ev.preventDefault();
      goToPage(ev.target.value);
    }
    if (ev.target && ev.target.id === 'askInput' && ev.key === 'Enter') {
      ev.preventDefault();
      askPaperQuestion();
    }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.matches('[data-readerfilter]')) {
      APP.ui.reader.filter = ev.target.value;
      render();
    }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'readerQ') {
      APP.ui.reader.q = ev.target.value;
      var list = $('.docList');
      if (list) {
        var scrollTop = list.querySelector('.docListScroll') ? list.querySelector('.docListScroll').scrollTop : 0;
        var html = readerDocListHtml();
        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        list.innerHTML = wrap.innerHTML;
        var q = document.getElementById('readerQ');
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
        var sc = list.querySelector('.docListScroll');
        if (sc) sc.scrollTop = scrollTop;
      }
    }
  });
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (APP.section === 'reader' && READER.status === 'ready' && READER.fit) renderPdfPage(READER.page, false);
    }, 220);
  });

  /* ---------------- 选择、批注、笔记 ---------------- */
  function hideSelectionBar() {
    var bar = $('#selBar');
    if (bar) bar.remove();
    if (APP.selection) APP.selection = null;
    if (READER.selection) READER.selection = null;
  }
  document.addEventListener('mouseup', function (ev) {
    if (APP.section !== 'reader' || READER.status !== 'ready') return;
    var textLayer = $('#textLayer');
    if (!textLayer || !textLayer.contains(ev.target)) return;
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { hideSelectionBar(); return; }
      var text = str(sel.toString());
      if (text.length < 3) { hideSelectionBar(); return; }
      var range = sel.getRangeAt(0);
      if (!textLayer.contains(range.commonAncestorContainer)) return;
      var rect = range.getBoundingClientRect();
      READER.selection = { quote: text.slice(0, 1200), page: String(READER.page) };
      showSelectionBar(rect);
    }, 10);
  });
  function showSelectionBar(rect) {
    var oldBar = $('#selBar');
    if (oldBar) oldBar.remove();
    if (!READER.selection) return;
    var bar = document.createElement('div');
    bar.className = 'selBar';
    bar.id = 'selBar';
    var top = Math.max(8, rect.top - 38);
    var left = Math.min(window.innerWidth - 230, Math.max(8, rect.left + rect.width / 2 - 110));
    bar.style.top = top + 'px';
    bar.style.left = left + 'px';
    bar.innerHTML = '<button data-act="saveSelectionHighlight">高亮</button><button data-act="saveSelectionNote">笔记</button><button data-act="explainSelection">解释</button><button data-act="clearSelection">×</button>';
    document.body.appendChild(bar);
  }
  function openAnnotationModal() {
    var sel = READER.selection;
    if (!sel) return;
    var body = '<div class="field"><label>原文片段</label><div class="banner"><div class="grow">' + esc(truncate(sel.quote, 500)) + '</div></div></div>' +
      '<div class="field"><label>批注 / 评论（可选）</label><textarea class="textarea" name="comment" rows="3" placeholder="为什么标记这段话？与你的研究问题有什么关系？"></textarea></div>' +
      '<div class="formGrid"><div class="field"><label>表图号（可选）</label><input class="input" name="sourceRef" placeholder="例如 图 2 / 表 1" /></div>' +
      '<div class="field"><label>颜色</label><select class="select" name="color"><option value="#ffd600">黄色</option><option value="#4f8ef7">蓝色</option><option value="#3fb950">绿色</option><option value="#f85149">红色</option></select></div></div>' +
      '<div class="hint">保存后会记录第 ' + esc(sel.page) + ' 页与选中文本；若文本层无法定位，批注仍保留在列表中，但不会假装有高亮位置。</div>';
    openModal({
      title: '添加批注 · 第 ' + sel.page + ' 页',
      body: body,
      submitLabel: '保存批注',
      onSubmit: function (fd) {
        var item = findItem(READER.itemId);
        if (!item) return false;
        item.annotations.push({
          id: uid('an'),
          page: sel.page,
          sourceRef: str(fd.get('sourceRef')),
          quote: sel.quote,
          comment: str(fd.get('comment')),
          color: str(fd.get('color')) || '#ffd600',
          origin: 'user',
          createdAt: Date.now()
        });
        item.updatedAt = Date.now();
        markDirty({ immediate: true });
        closeModal();
        hideSelectionBar();
        setTimeout(function () { renderPdfPage(READER.page, false); render(); }, 30);
        toast('批注已保存 · 第 ' + sel.page + ' 页');
      }
    });
  }
  function saveSelectionHighlight() {
    openAnnotationModal();
  }
  function saveSelectionNote() {
    var sel = READER.selection;
    if (!sel) return;
    var page = sel.page;
    var quote = sel.quote;
    hideSelectionBar();
    openNoteModal({ itemId: READER.itemId, page: page, quote: quote });
  }
  function explainSelection() {
    var sel = READER.selection;
    if (!sel) return;
    var quote = sel.quote;
    var page = sel.page;
    hideSelectionBar();
    APP.ui.reader.tab = 'qa';
    askPaper('请解释这段原文（第 ' + page + ' 页）：\n' + truncate(quote, 600), 'explain', quote, page);
  }
  function drawHighlights(pageNo) {
    var layer = $('#hlLayer');
    var textLayer = $('#textLayer');
    var item = findItem(READER.itemId);
    if (!layer || !textLayer || !item) return;
    layer.innerHTML = '';
    var anns = (item.annotations || []).filter(function (a) { return String(a.page) === String(pageNo); });
    anns.forEach(function (a) {
      var range = findQuoteRange(textLayer, a.quote);
      if (!range) return;
      var base = textLayer.getBoundingClientRect();
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (!r.width || !r.height) continue;
        var d = document.createElement('div');
        d.className = 'hlRect';
        d.style.left = (r.left - base.left) + 'px';
        d.style.top = (r.top - base.top) + 'px';
        d.style.width = r.width + 'px';
        d.style.height = r.height + 'px';
        d.style.background = a.color || '#ffd600';
        d.title = a.comment || '批注';
        d.setAttribute('data-act', 'locateAnnotation');
        d.setAttribute('data-id', a.id);
        layer.appendChild(d);
      }
    });
  }
  function findQuoteRange(root, quote) {
    var needle = str(quote).replace(/\s+/g, ' ').trim();
    if (!needle) return null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var full = '';
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      nodes.push({ node: node, start: full.length });
      full += node.nodeValue;
    }
    var idx = full.indexOf(needle);
    if (idx < 0) {
      var compact = full.replace(/\s+/g, ' ');
      var cidx = compact.indexOf(needle);
      if (cidx < 0) {
        var shortNeedle = needle.slice(0, Math.min(60, needle.length));
        idx = full.indexOf(shortNeedle);
        if (idx < 0) return null;
        needle = shortNeedle;
      } else {
        return null;
      }
    }
    var end = idx + needle.length;
    function locate(offset) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var len = n.node.nodeValue.length;
        if (offset >= n.start && offset <= n.start + len) return { node: n.node, offset: offset - n.start };
      }
      return null;
    }
    var s = locate(idx);
    var e = locate(end);
    if (!s || !e) return null;
    try {
      var r = document.createRange();
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset);
      return r;
    } catch (err) { return null; }
  }
  function locateAnnotation(id) {
    var item = findItem(READER.itemId);
    if (!item) return;
    var ann = (item.annotations || []).filter(function (a) { return a.id === id; })[0];
    if (!ann) return;
    if (READER.status === 'ready' && ann.page && parseInt(ann.page, 10) !== READER.page) {
      renderPdfPage(parseInt(ann.page, 10), true).then(function () {
        setTimeout(function () { flashAnnotation(id); }, 150);
      });
    } else {
      flashAnnotation(id);
    }
    toast('已定位到第 ' + (ann.page || '?') + ' 页');
  }
  function flashAnnotation(id) {
    var rects = $$('.hlRect[data-id="' + id + '"]');
    if (!rects.length) { toast('当前页文本层无法精确定位这段原文'); return; }
    rects.forEach(function (r) { r.classList.add('hlFlash'); setTimeout(function () { r.classList.remove('hlFlash'); }, 1400); });
    rects[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function deleteAnnotation(id) {
    var item = findItem(READER.itemId);
    if (!item) return;
    if (!window.confirm('删除这条批注？')) return;
    item.annotations = item.annotations.filter(function (a) { return a.id !== id; });
    item.updatedAt = Date.now();
    markDirty({ immediate: true });
    render();
    setTimeout(function () { if (READER.status === 'ready') renderPdfPage(READER.page, false); }, 30);
    toast('批注已删除');
  }
  function locateNote(id) {
    var n = findNote(id);
    if (!n) return;
    if (!n.itemId) { toast('这条笔记没有关联资料'); return; }
    openReader(n.itemId);
    if (n.sourcePage) {
      setTimeout(function () {
        if (READER.status === 'ready') renderPdfPage(parseInt(n.sourcePage, 10) || 1, true);
        var tab = $('.readerAside .tab[data-tab="notes"]');
        if (tab) tab.click();
        toast('已打开关联资料' + (n.sourcePage ? ' · 第 ' + n.sourcePage + ' 页' : ''));
      }, 700);
    }
  }
  function locatePage(page) {
    if (!page) { toast('这条引用没有页码'); return; }
    APP.ui.reader.tab = 'qa';
    if (READER.status === 'ready') {
      renderPdfPage(parseInt(page, 10) || 1, true);
      toast('已跳到第 ' + page + ' 页');
    } else {
      render();
      toast('当前资料没有可定位的原文页码');
    }
  }
  function setReaderTab(tab) {
    APP.ui.reader.tab = tab;
    var item = findItem(READER.itemId);
    var aside = $('.readerAside');
    if (item && aside) {
      aside.innerHTML = readerAsideHtml(item);
      return;
    }
    render();
  }
  function selectReaderItem(id) {
    if (id === READER.itemId) return;
    openReader(id);
  }
  function toggleReaderAside() {
    var shell = $('#readerShell');
    if (!shell) return;
    shell.classList.toggle('asideOpen');
    if (shell.classList.contains('asideOpen')) shell.classList.remove('readerShowList');
  }

  /* ---------------- 单篇问答 ---------------- */
  function tokenize(q) {
    var out = {};
    String(q || '').toLowerCase().replace(/[a-z0-9]{3,}/g, function (m) { out[m] = 1; return m; });
    var cjk = String(q || '').match(/[\u4e00-\u9fa5]{2,}/g) || [];
    cjk.forEach(function (seg) {
      for (var i = 0; i < seg.length - 1; i++) out[seg.slice(i, i + 2)] = 1;
    });
    return Object.keys(out);
  }
  function scoreChunks(question, chunks) {
    var terms = tokenize(question);
    return chunks.map(function (c) {
      var text = c.text.toLowerCase();
      var score = 0;
      terms.forEach(function (t) { if (text.indexOf(t) >= 0) score += t.length >= 4 ? 3 : 2; });
      return { chunk: c, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function selectChunks(question, chunks) {
    if (!chunks.length) return [];
    var scored = scoreChunks(question, chunks);
    var picked = [];
    var seen = {};
    scored.forEach(function (s) {
      if (picked.length >= 10) return;
      if (s.score <= 0 && picked.length >= 3) return;
      if (seen[s.chunk.label]) return;
      seen[s.chunk.label] = 1;
      picked.push(s.chunk);
    });
    if (picked.length < 4) {
      for (var i = 0; i < chunks.length && picked.length < 4; i++) {
        if (!seen[chunks[i].label]) { picked.push(chunks[i]); seen[chunks[i].label] = 1; }
      }
    }
    return picked;
  }
  function currentChunks() {
    if (READER.textChunks.length) return READER.textChunks;
    var item = findItem(READER.itemId);
    if (!item) return [];
    if (item.fulltext) return chunksFromText(item.fulltext, null);
    if (item.abstract) return chunksFromText(item.abstract, '');
    return [];
  }
  function answerCitations(answer, chunks) {
    var byLabel = {};
    chunks.forEach(function (c) { byLabel[String(c.label)] = c; });
    var seen = {};
    var citations = [];
    var invalid = [];
    var text = String(answer || '');
    var re = /\[([A-Za-z]\d{1,3})\]/g;
    var m;
    while ((m = re.exec(text))) {
      var label = m[1];
      var chunk = byLabel[label];
      if (!chunk) {
        if (invalid.indexOf(label) < 0) invalid.push(label);
        continue;
      }
      if (seen[label]) continue;
      seen[label] = 1;
      citations.push({ label: label, page: chunk.page || '', preview: truncate(chunk.text, 120) });
    }
    return { citations: citations, invalid: invalid, grounded: citations.length > 0 && invalid.length === 0 };
  }
  async function askPaperQuestion() {
    var input = $('#askInput');
    if (!input) return;
    var q = str(input.value);
    if (!q) { toast('请输入问题'); return; }
    input.value = '';
    await askPaper(q, 'qa');
  }
  async function askPaper(question, mode, quote, quotePage) {
    var item = findItem(READER.itemId);
    if (!item) return;
    var chunks = currentChunks();
    if (mode === 'explain' && quote) {
      var all = chunks.slice();
      var page = quotePage || (READER.selection ? READER.selection.page : '');
      var first = all.filter(function (c) { return String(c.page) === String(page); })[0];
      chunks = [{ label: 'X1', page: page || '', text: quote }].concat(first ? [first] : []).concat(selectChunks(question, all).slice(0, 4));
    } else {
      chunks = selectChunks(question, chunks);
    }
    if (!chunks.length) {
      var note = READER.status === 'abstract'
        ? '当前只有摘要，无法基于全文回答。你可以先粘贴全文，或把问题交给原生会话。'
        : READER.status === 'error'
          ? '原文解析失败，没有可用的原文片段。'
          : '尚未读取到可用的原文文本（可能是扫描版 PDF）。请粘贴全文后重试。';
      READER.qaError = note;
      render();
      toast(note);
      return;
    }
    READER.qaBusy = true;
    READER.qaError = '';
    APP.ui.reader.tab = 'qa';
    render();
    var result = null;
    var errMsg = '';
    try {
      result = await askHostModel({
        question: question,
        itemTitle: item.title,
        chunks: chunks.map(function (c) { return { label: c.label, page: c.page, text: c.text }; }),
        kind: mode === 'explain' ? 'explain' : 'qa'
      });
    } catch (err) {
      errMsg = '模型请求失败：' + apiErrorMessage(err) + '。已改为本地原文片段检索。';
    }
    READER.qaBusy = false;
    if (result && result.answer) {
      var cite = answerCitations(result.answer, chunks);
      var row = {
        id: uid('qa'),
        question: question,
        answer: result.answer,
        citations: cite.citations,
        grounded: cite.grounded,
        origin: 'ai',
        provider: result.provider || '',
        providerLabel: result.providerLabel || result.provider || '',
        model: result.model || '',
        mode: result.mode || '',
        source: result.source || '',
        truncated: !!result.truncated,
        finishReason: result.finishReason || '',
        notice: result.notice || (result.truncated ? '回答被截断（' + (result.finishReason || 'max-tokens') + '）' : ''),
        configNote: cite.invalid.length ? '模型返回了无效引用：' + cite.invalid.join(', ') : '',
        createdAt: Date.now()
      };
      item.qa = (item.qa || []).concat(row).slice(-30);
      item.updatedAt = Date.now();
      markDirty({ immediate: true });
      render();
      if (errMsg) toast(errMsg);
      return;
    }
    // 无模型 / 模型失败：只做本地检索，不伪造 AI 回答。
    var scored = scoreChunks(question, chunks).slice(0, 3).filter(function (s) { return s.score > 0; });
    if (!scored.length) scored = chunks.slice(0, 2).map(function (c) { return { chunk: c, score: 0 }; });
    var answer = '未调用模型（' + (result && result.message ? result.message : errMsg || '模型未配置') + '）。\n\n以下是从已读取内容中按词项重合检索到的原文片段，请自行核对：\n\n' +
      scored.map(function (s) {
        return '[' + s.chunk.label + '] ' + (s.chunk.page ? '第 ' + s.chunk.page + ' 页：' : '') + truncate(s.chunk.text, 380);
      }).join('\n\n');
    item.qa = (item.qa || []).concat({
      id: uid('qa'),
      question: question,
      answer: answer,
      citations: scored.map(function (s) { return { label: s.chunk.label, page: s.chunk.page, preview: truncate(s.chunk.text, 120) }; }),
      grounded: false,
      origin: 'local',
      configNote: '未调用模型',
      createdAt: Date.now()
    }).slice(-30);
    item.updatedAt = Date.now();
    markDirty();
    render();
  }
  function setAskInput(text) {
    APP.ui.reader.tab = 'qa';
    render();
    var input = $('#askInput');
    if (input) { input.value = text; input.focus(); }
  }

  /* ---------------- 交给原生会话 ---------------- */
  function buildReaderPack(item) {
    var chunks = currentChunks();
    var top = chunks.slice(0, 6);
    var notes = notesFor({ itemId: item.id }).slice(0, 6);
    var anns = (item.annotations || []).slice(-6);
    var md = '# 文献阅读交接单（医学研究工作台）\n\n' +
      '- 标题：' + item.title + '\n' +
      '- 作者：' + (item.authors.join(', ') || '未提供') + '\n' +
      '- 期刊/年份：' + (item.journal || '未提供') + ' · ' + (item.year || '未提供') + '\n' +
      '- DOI：' + (item.doi || '未提供') + '\n' +
      '- PMID：' + (item.pmid || '未提供') + '\n' +
      '- 阅读状态：' + READ_STATUS[item.readStatus] + '\n' +
      '- 已读取内容：' + (READER.status === 'ready' ? 'PDF 全文 ' + READER.numPages + ' 页（本窗口提取）' : READER.status === 'abstract' ? '仅摘要' : READER.status === 'fulltext' ? '粘贴/索引全文' : '未读取全文') + '\n\n' +
      '## 原文片段（仅这些内容可被引用）\n\n' +
      (top.length ? top.map(function (c) { return '[' + c.label + ']' + (c.page ? ' 第 ' + c.page + ' 页' : '') + '\n' + truncate(c.text, 900); }).join('\n\n') : '（无可用片段）') + '\n\n' +
      '## 我的笔记\n\n' + (notes.length ? notes.map(function (n) { return '- ' + (n.sourcePage ? '[第 ' + n.sourcePage + ' 页] ' : '') + n.body; }).join('\n') : '（无）') + '\n\n' +
      '## 批注\n\n' + (anns.length ? anns.map(function (a) { return '- 第 ' + (a.page || '?') + ' 页' + (a.sourceRef ? '（' + a.sourceRef + '）' : '') + '：“' + a.quote + '” ' + (a.comment || ''); }).join('\n') : '（无）') + '\n\n' +
      '请只依据上面的片段继续讨论；无法从片段确认的内容请明确说明，不要补写页码或引文。';
    return md;
  }
  function sendReaderToNative() {
    var item = findItem(READER.itemId);
    if (!item) return;
    var pack = buildReaderPack(item);
    var embedded = !!findNativeComposer();
    var body = '<div class="banner"><div class="grow">' + (embedded
      ? '检测到同一 DSH 窗口的原生输入框。点击下方按钮会把整理稿放入输入框，<b>不会自动发送</b>；你可以在发送前检查、修改或删除。'
      : '当前不在 DSH 原生窗口内（或未找到输入框）。点击按钮会复制整理稿；你可粘贴到原生会话，是否发送由你决定。') + '</div></div>' +
      '<div class="field"><label>交接稿预览</label><textarea class="textarea" rows="12" readonly>' + esc(pack) + '</textarea></div>';
    openModal({
      title: '交给原生会话',
      body: body,
      submitLabel: embedded ? '放入原生草稿（不发送）' : '复制整理稿',
      onSubmit: async function () {
        var res = await putNativeDraft(pack);
        if (res.ok) {
          toast('已放入原生输入框，请检查后自行发送（未自动发送）。');
          return true;
        }
        var ok = res.copied;
        if (!ok) ok = await copyText(pack);
        if (!embedded) {
          try { window.open('/', '_blank', 'noopener'); } catch (e) {}
        }
        toast(ok ? '未找到可写入的原生输入框，已复制交接稿；请粘贴到原生会话。' : '复制失败，请手动选择上方文本复制');
        return true;
      }
    });
  }

  /* ---------------- 选读列表切换 ---------------- */
  function setReaderTabFromAction(tab) {
    APP.ui.reader.tab = tab;
    render();
  }
