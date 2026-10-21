  /* ================================================================
     启动
     ================================================================ */
  async function boot() {
    try {
      applyHash();
      if (!APP.route.section) APP.route.section = 'home';
      APP.section = APP.route.section || 'home';
      await bootData();
      applyFontSize();
      renderHead();
      renderNav();
      render();
      updateSaveBanner();
      modelRefresh({ paint: false });
      if (!APP.bridge.online) {
        setTimeout(function () {
          toast('本地服务未连接：检索可用页面直连；Zotero 与文件保存需启动本地服务。模型由顶栏「模型」设置单独配置。');
        }, 900);
      }
    } catch (err) {
      console.error('[medwb] boot failed', err);
      var view = $('#view');
      if (view) {
        view.innerHTML = '<div class="page"><div class="banner bannerBad"><div class="grow"><b>工作台启动失败</b><br>' + esc(err && err.message ? err.message : String(err)) + '<br><span class="muted">可刷新窗口重试；数据仍保存在浏览器与项目文件中。</span></div><button class="btn btnMini" data-act="reload">刷新窗口</button></div></div>';
      }
    }
  }
  window.addEventListener('focus', function () {
    if (APP.bridge.checkedAt && Date.now() - APP.bridge.checkedAt > 60000) probeBridge();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && APP.bridge.checkedAt && Date.now() - APP.bridge.checkedAt > 60000) probeBridge();
  });
  window.addEventListener('offline', function () { toast('网络已断开：依赖上游的检索会失败，本地阅读与已保存资料不受影响。'); });
  window.addEventListener('online', function () { toast('网络已恢复。'); });
  setInterval(function () {
    if (document.visibilityState === 'visible' && !APP.modal.busy) {
      probeBridge().then(function () {
        if (!$('#modalMask').hidden && !APP.modelSettingsOpen && APP.settingsTab === 'conn') switchSettingsTab('conn');
      });
      // 只读取设置，不调用付费模型；模型设置打开时完全不刷新，避免清空输入。
      if (!APP.modelSettingsOpen) modelRefresh({ paint: false });
    }
  }, 60000);

  boot();
