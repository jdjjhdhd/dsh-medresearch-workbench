  /* ================================================================
     补充交互（资料库筛选、文件选择、Zotero、设置内按钮）
     这些动作在 core 的事件表之外单独分发，避免主表过长。
     ================================================================ */
  function openTopics() {
    APP.section = 'library';
    APP.route = { section: 'library' };
    APP.ui.library.tab = 'topics';
    navigateHash();
    renderNav();
    render();
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (['libTab', 'libStar', 'libReset', 'taskResetFilter', 'openTopics', 'loadBackups', 'pickPdf', 'zoteroSearch', 'zoteroImport'].indexOf(act) < 0) return;
    if (act === 'libTab') {
      APP.ui.library.tab = el.getAttribute('data-tab') || 'materials';
      render();
    } else if (act === 'libStar') {
      APP.ui.library.star = !APP.ui.library.star;
      render();
    } else if (act === 'libReset') {
      APP.ui.library.q = '';
      APP.ui.library.type = '';
      APP.ui.library.status = '';
      APP.ui.library.topic = '';
      APP.ui.library.tag = '';
      APP.ui.library.sort = 'recent';
      APP.ui.library.star = false;
      render();
    } else if (act === 'taskResetFilter') {
      APP.ui.tasks = { q: '', priority: '', status: '' };
      render();
    } else if (act === 'openTopics') {
      openTopics();
    } else if (act === 'loadBackups') {
      loadBackupList();
    } else if (act === 'pickPdf') {
      $('#filePdf').click();
    } else if (act === 'zoteroSearch') {
      zoteroSearch();
    } else if (act === 'zoteroImport') {
      importZoteroItem(el.getAttribute('data-key'));
    }
  });

  function ensureFocusAfterRender(focusId, selStart) {
    setTimeout(function () {
      var el = document.getElementById(focusId);
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(selStart, selStart); } catch (e) {}
    }, 0);
  }

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.matches('[data-filter]')) {
      var key = el.getAttribute('data-filter');
      APP.ui.library[key] = el.value;
      renderLibraryRows();
    } else if (el.matches('[data-taskfilter]')) {
      var k2 = el.getAttribute('data-taskfilter');
      APP.ui.tasks[k2] = el.value;
      var pos = el.selectionStart;
      render();
      ensureFocusAfterRender('taskQ', pos);
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.matches('[data-filter]')) {
      APP.ui.library[el.getAttribute('data-filter')] = el.value;
      renderLibraryRows();
    } else if (el.matches('[data-taskfilter]')) {
      APP.ui.tasks[el.getAttribute('data-taskfilter')] = el.value;
      render();
    }
  });

  $('#fileImport').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (file) importBackupFile(file);
  });
  $('#filePdf').addEventListener('change', function () {
    var file = this.files && this.files[0];
    var attachId = APP.ui.attachItemId || '';
    APP.ui.attachItemId = '';
    this.value = '';
    if (file) uploadPdfFile(file, attachId);
  });

  async function uploadPdfFile(file, attachItemId) {
    if (!APP.bridge.online) {
      toast('上传需要本地服务；也可以直接填写本机绝对路径');
      return;
    }
    if (file.size > 60 * 1024 * 1024) {
      toast('文件超过 60 MB，请改为填写本机路径');
      return;
    }
    toast('正在上传 PDF 到项目 data/uploads…');
    try {
      var buf = await file.arrayBuffer();
      var bytes = new Uint8Array(buf);
      var binary = '';
      var chunk = 0x8000;
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      var r = await fetchJsonNice(APP.bridge.url + '/files/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type || 'application/pdf', base64: btoa(binary) })
      }, 90000);
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      var p = r.json.path;
      var attached = attachItemId ? findItem(attachItemId) : null;
      if (attachItemId && !attached) {
        APP.ui.attachItemId = '';
        toast('原资料已不存在，未创建新资料');
        return;
      }
      if (attached) {
        attached.filePath = p;
        attached.attachmentKey = '';
        attached.updatedAt = Date.now();
        attached.lastOpenedAt = Date.now();
        if (attached.readStatus === 'unread') attached.readStatus = 'reading';
        if (!attached.source || attached.source.type === 'manual') {
          attached.source = { type: 'local', label: '关联本地 PDF', at: Date.now() };
        }
        markDirty({ immediate: true });
        closeModal();
        APP.ui.attachItemId = '';
        openReader(attached.id);
        toast('PDF 已关联到当前资料');
      } else {
        var res = upsertItem({
          title: file.name.replace(/\.pdf$/i, ''),
          type: '期刊文献',
          filePath: p,
          source: { type: 'local', label: '本地上传', at: Date.now() }
        });
        markDirty({ immediate: true });
        closeModal();
        render();
        toast(res && res.merged ? '已合并到现有资料' : 'PDF 已加入资料库');
      }
    } catch (err) {
      APP.ui.attachItemId = '';
      toast('上传失败：' + apiErrorMessage(err));
    }
  }
