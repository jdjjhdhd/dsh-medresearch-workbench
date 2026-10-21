window.__ModuleLoader__.load({
  id: 'dsh-medresearch-model',
  factory: () => {
    'use strict';

    var PROJECTS_KEY = 'dsh.worktable.projects.v1';
    var WIDGETS_KEY = 'dsh.worktable.widgetBindings.v2';
    var GUARD_KEY = 'dsh.medresearch.worktableInit.v1';
    var TITLE = '医学文献与证据工作台';
    var PAGE = '医学研究工作台.html';
    var OWNER = 'dsh-medresearch-model';
    var LAYOUT_PREFIX = 'layout-medresearch-';

    function uuid() {
      try {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
      } catch (_) {}
      return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    function readJson(key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    }
    function writeJson(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    function norm(value) {
      return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    }
    function pageUrl(info) {
      return '/api/worktable/site/' + encodeURIComponent(info.projectRoot) + '/' + encodeURIComponent(info.pageName || PAGE);
    }
    function initState() {
      var p = readState(PROJECTS_KEY);
      if (!p) return { order: [], lastUsed: {}, hidden: [], nameOverrides: {}, iconOverrides: {}, removed: [], views: {}, shortcuts: [], layouts: [], bindings: {}, folders: {} };
      if (!Array.isArray(p.layouts)) throw new Error('工作台项目数据格式不兼容，未修改现有项目');
      p.bindings = p.bindings || {};
      p.folders = p.folders || {};
      if (!isObject(p.bindings) || !isObject(p.folders)) throw new Error('工作台绑定数据格式不兼容，未修改现有项目');
      return p;
    }
    function isObject(value) {
      return value && typeof value === 'object' && !Array.isArray(value);
    }
    function readState(key) {
      var raw = localStorage.getItem(key);
      if (raw === null) return null;
      var value;
      try { value = JSON.parse(raw); } catch (_) {
        throw new Error('工作台已有数据无法解析，未覆盖：' + key);
      }
      if (!isObject(value)) throw new Error('工作台已有数据格式不兼容，未覆盖：' + key);
      return value;
    }
    function widgetOf(widgets, record) {
      return widgets[record.layoutId] && widgets[record.layoutId][record.paneId];
    }
    function ownsWidget(widget, record) {
      return widget && widget.projectId === record.layoutId && widget.paneId === record.paneId && widget.bindingId === record.bindingId;
    }
    function ownedLayout(p, guard, widgets) {
      if (!guard) return null;
      var layout = p.layouts.find(function (entry) { return entry.id === guard.layoutId; });
      var complete = ['layoutId', 'paneId', 'tabId', 'bindingId', 'folder', 'pageUrl'].every(function (key) {
        return typeof guard[key] === 'string' && guard[key].length > 0;
      });
      if (guard.version === 2 && guard.owner === OWNER && complete &&
          (String(guard.layoutId).indexOf(LAYOUT_PREFIX) === 0 || guard.legacy === true)) {
        return { layout: layout || null, record: guard };
      }
      // 0.2.0 used generic layout IDs. Migrate only its complete guard + binding chain.
      if (guard.version !== 1 || !layout || !/^layout-[0-9a-z-]+$/i.test(layout.id) || !guard.folder ||
          norm(p.folders[layout.id]) !== norm(guard.folder) ||
          guard.pageUrl !== pageUrl({ projectRoot: guard.folder }) ||
          String(p.bindings[layout.id] || '') !== String(guard.sessionId || '')) return null;
      var parts = String(guard.signature || '').split('|');
      if (parts.length !== 5 || parts[0] !== '0.2.0' || parts[1] !== norm(guard.folder) ||
          parts[2] !== guard.pageUrl || parts[3] !== layout.id || parts[4] !== String(guard.sessionId || '')) return null;
      var matches = [];
      (layout.main || []).forEach(function (pane) {
        var widget = widgets[layout.id] && widgets[layout.id][pane.id];
        if (!widget || widget.projectId !== layout.id || widget.paneId !== pane.id ||
            !widget.bindingId || norm(widget.folder) !== norm(guard.folder) ||
            String(widget.sessionId || '') !== String(guard.sessionId || '')) return;
        (pane.tabs || []).forEach(function (tab) {
          if (tab.id && tab.content && tab.content.kind === 'iframe' && tab.content.url === guard.pageUrl) {
            matches.push({ pane: pane, tab: tab, widget: widget });
          }
        });
      });
      if (matches.length !== 1) return null;
      var match = matches[0];
      return { layout: layout, record: {
        version: 2, owner: OWNER, legacy: true, layoutId: layout.id,
        paneId: match.pane.id, tabId: match.tab.id, bindingId: match.widget.bindingId,
        folder: guard.folder, pageUrl: guard.pageUrl, sessionId: String(guard.sessionId || ''),
        previousSessionIds: [], at: guard.at || Date.now()
      } };
    }
    function createLayout(info) {
      var id = LAYOUT_PREFIX + uuid();
      var tab = { id: 'tab-medresearch-' + uuid(), title: info.pageName || PAGE,
        content: { kind: 'iframe', url: pageUrl(info), title: info.pageName || PAGE }, active: 0 };
      var pane = { id: 'p1', title: '窗口1', min: 200, content: null, tabs: [tab], active: 0 };
      var layout = { id: id, title: TITLE, icon: '📚', left: null, top: null, main: [pane],
        leftWidth: { default: 260, min: 160, max: 480 }, chatWidth: { default: 360, min: 240, max: 600 },
        topHeight: { default: 200, min: 120, max: 480 }, topHeightRatio: 0.35, chatSide: 'right', chatFullHeight: false };
      return { layout: layout, record: { version: 2, owner: OWNER, layoutId: id, paneId: pane.id,
        tabId: tab.id, bindingId: 'binding-' + uuid(), folder: info.projectRoot,
        pageUrl: pageUrl(info), sessionId: '', previousSessionIds: [], at: Date.now() } };
    }
    function serviceOf(ctx, name) {
      return ctx && (ctx[name] || (typeof ctx.get === 'function' ? ctx.get(name) : null));
    }
    function sessionCwd(ctx, sid) {
      var sessions = serviceOf(ctx, 'sessions');
      try {
        var snapshot = sessions && sessions.list && sessions.list.getSnapshot();
        var entry = snapshot && snapshot.byId && snapshot.byId[sid];
        return entry && typeof entry.cwd === 'string' ? entry.cwd : '';
      } catch (_) { return ''; }
    }
    function assertMoveSafe(p, record, widgets, folder) {
      if (norm(p.folders[record.layoutId]) !== norm(record.folder) && norm(p.folders[record.layoutId]) !== norm(folder)) {
        throw new Error('项目目录已由用户修改，未自动迁移，请先核对项目目录');
      }
      var widget = widgetOf(widgets, record);
      if (widget && !ownsWidget(widget, record)) throw new Error('窗口绑定已由用户修改，未自动迁移');
    }
    function sessionIdOf(result) {
      if (typeof result === 'string') return result;
      return String(result && (result.id || result.sessionId) || '');
    }
    function showBanner(message, retry) {
      if (typeof document === 'undefined') return;
      var mount = function () {
        var old = document.getElementById('medresearch-init-banner');
        if (old) old.remove();
        var box = document.createElement('div');
        box.id = 'medresearch-init-banner';
        box.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:99999;max-width:560px;padding:12px 14px;border:1px solid #b45309;border-radius:8px;background:#fff7ed;color:#7c2d12;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.16)';
        var text = document.createElement('div');
        text.textContent = message;
        box.appendChild(text);
        if (retry) {
          var btn = document.createElement('button');
          btn.textContent = '重试初始化';
          btn.style.cssText = 'margin-top:8px;padding:4px 10px;border:1px solid #b45309;border-radius:5px;background:#fff;color:#7c2d12;cursor:pointer';
          btn.onclick = function () { box.remove(); retry(); };
          box.appendChild(btn);
        }
        document.body.appendChild(box);
      };
      if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
    }
    function waitForWorktable(timeoutMs) {
      if (window.__dshWorktable) return Promise.resolve(true);
      return new Promise(function (resolve) {
        var done = false;
        var finish = function (value) { if (!done) { done = true; resolve(value); } };
        var timer = setTimeout(function () { finish(Boolean(window.__dshWorktable)); }, timeoutMs);
        var observer = new MutationObserver(function () {
          if (window.__dshWorktable) { clearTimeout(timer); observer.disconnect(); finish(true); }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(function () {
          if (!window.__dshWorktable) { clearTimeout(timer); observer.disconnect(); finish(false); }
        }, timeoutMs);
      });
    }

    async function getInfo() {
      var response = await fetch('/api/medresearch/model/worktable-info', { credentials: 'same-origin' });
      var data = await response.json().catch(function () { return null; });
      if (!response.ok) throw new Error((data && data.error && data.error.message) || ('宿主入口接口 HTTP ' + response.status));
      if (!data || !data.ok || !data.projectRoot) throw new Error('宿主未返回安装目录');
      return data;
    }

    async function ensureService() {
      var response = await fetch('/api/medresearch/model/service/ensure', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      var data = await response.json().catch(function () { return null; });
      if (!response.ok || !data || !data.bridge || !data.bridge.online) {
        throw new Error((data && data.bridge && data.bridge.error) || ('本地文件服务启动失败 HTTP ' + response.status));
      }
      return data.bridge;
    }

    async function makeSession(ctx, folder) {
      var sessions = serviceOf(ctx, 'sessions');
      if (!sessions || typeof sessions.create !== 'function') throw new Error('宿主会话服务不可用');
      var workspaces = serviceOf(ctx, 'workspaces');
      var options = { cwd: folder, title: TITLE };
      if (workspaces && typeof workspaces.create === 'function') {
        try {
          var workspace = await workspaces.create({ path: folder });
          var workspaceId = workspace && (workspace.workspaceId || workspace.id);
          if (workspaceId) {
            options = { workspaceId: workspaceId, title: TITLE };
          }
        } catch (_) {
          // 工作区服务不可用时退回 cwd 绑定；项目入口仍可打开。
        }
      }
      var result = await sessions.create(options);
      var sid = sessionIdOf(result);
      if (!sid) throw new Error('宿主未返回新会话 ID');
      var cwd = sessionCwd(ctx, sid);
      if (cwd && norm(cwd) !== norm(folder)) throw new Error('新会话目录与安装目录不一致，未更改原绑定');
      return sid;
    }

    async function initialize(ctx) {
      var info = await getInfo();
      if (!info.pageExists) throw new Error('缺少 ' + (info.pageName || PAGE) + '：' + (info.projectRoot || ''));
      var serviceError = '';
      try {
        await ensureService();
      } catch (error) {
        serviceError = error && error.message ? error.message : String(error);
      }
      var p = initState();
      var widgets = readState(WIDGETS_KEY) || {};
      var prev = readJson(GUARD_KEY, null);
      var owned = ownedLayout(p, prev, widgets);
      if (owned && !owned.layout) {
        showBanner('医学工作台项目已被移除，保留当前设置，不自动重建。');
        return;
      }
      var created = !owned;
      var record = owned && owned.record;
      var moved = Boolean(record && norm(record.folder) !== norm(info.projectRoot));
      var oldSid = owned ? String(p.bindings[owned.layout.id] || '') : '';
      var sid = oldSid;
      var sessionError = '';
      var cwd = oldSid ? sessionCwd(ctx, oldSid) : '';
      var sessionWarning = !moved && cwd && norm(cwd) !== norm(info.projectRoot)
        ? '当前绑定会话目录与医学工作台目录不一致，已保留您的绑定；请先在工作台核对或重新选择会话。' : '';
      if (moved) assertMoveSafe(p, record, widgets, info.projectRoot);
      if (created || (!sid && !record.sessionId) || (moved && norm(cwd) !== norm(info.projectRoot))) {
        try {
          sid = await makeSession(ctx, info.projectRoot);
        } catch (error) {
          sessionError = error && error.message ? error.message : String(error);
          if (moved) throw new Error('目录迁移未完成，原会话已保留：' + sessionError);
        }
      }

      // Re-read after session creation so unrelated edits made while awaiting it survive.
      p = initState();
      widgets = readState(WIDGETS_KEY) || {};
      var latest = ownedLayout(p, readJson(GUARD_KEY, null), widgets);
      if (created ? Boolean(latest) : (!latest || !latest.layout || latest.layout.id !== record.layoutId ||
          norm(latest.record.folder) !== norm(record.folder) || String(p.bindings[record.layoutId] || '') !== oldSid)) {
        throw new Error('初始化期间项目绑定发生变化，未覆盖，请重试');
      }
      if (moved) assertMoveSafe(p, latest.record, widgets, info.projectRoot);
      var projectsBefore = JSON.stringify(p);
      var widgetsBefore = JSON.stringify(widgets);
      if (created) {
        owned = createLayout(info);
        record = owned.record;
        if (p.order !== undefined && !Array.isArray(p.order)) throw new Error('工作台排序格式不兼容，未修改现有项目');
        if (p.lastUsed !== undefined && !isObject(p.lastUsed)) throw new Error('工作台访问记录格式不兼容，未修改现有项目');
        p.layouts.push(owned.layout);
        p.order = (p.order || []).concat(record.layoutId);
        p.lastUsed = p.lastUsed || {};
        p.lastUsed[record.layoutId] = Date.now();
        p.folders[record.layoutId] = info.projectRoot;
        widgets[record.layoutId] = {};
        widgets[record.layoutId][record.paneId] = { projectId: record.layoutId, paneId: record.paneId,
          window: '窗口1', folder: info.projectRoot, sessionId: sid, bindingId: record.bindingId, enabled: true };
      } else {
        owned = latest;
        record = Object.assign({}, latest.record);
        if (moved || record.pageUrl !== pageUrl(info)) {
          var pane = (owned.layout.main || []).find(function (entry) { return entry.id === record.paneId; });
          var tab = pane && (pane.tabs || []).find(function (entry) { return entry.id === record.tabId; });
          // Replaced/removed content belongs to the user; do not restore it implicitly.
          if (tab && tab.content && tab.content.kind === 'iframe' && tab.content.url === record.pageUrl) {
            tab.content = Object.assign({}, tab.content, { url: pageUrl(info) });
          }
          if (moved) p.folders[record.layoutId] = info.projectRoot;
        }
        var widget = widgetOf(widgets, record);
        if (ownsWidget(widget, record)) {
          if (moved) widget.folder = info.projectRoot;
          if (sid !== oldSid) widget.sessionId = sid;
        }
      }
      if (sid !== oldSid || (created && sid)) p.bindings[record.layoutId] = sid;
      if (moved && oldSid && sid !== oldSid) record.previousSessionIds = (record.previousSessionIds || []).concat(oldSid);
      record.folder = info.projectRoot;
      record.pageUrl = pageUrl(info);
      record.sessionId = sid;
      var projectsChanged = projectsBefore !== JSON.stringify(p);
      var widgetsChanged = widgetsBefore !== JSON.stringify(widgets);
      if (projectsChanged) writeJson(PROJECTS_KEY, p);
      if (widgetsChanged) writeJson(WIDGETS_KEY, widgets);
      if (JSON.stringify(prev) !== JSON.stringify(record)) writeJson(GUARD_KEY, record);
      if (sessionError) {
        showBanner('项目已创建，但未能自动创建会话：' + sessionError + '。请在窗口1右侧选择或创建会话。');
      }
      if (sessionWarning) showBanner(sessionWarning);
      if (serviceError) {
        showBanner('项目已创建；本地文件服务未启动：' + serviceError + '。PDF 导入/保存暂不可用，可点击重试。', function () { ensure(ctx).catch(function (error) { showBanner(error.message); }); });
      }
      if (projectsChanged || widgetsChanged) window.location.reload();
    }

    var initializing = null;
    function ensure(ctx) {
      if (!initializing) initializing = initialize(ctx).finally(function () { initializing = null; });
      return initializing;
    }

    function apply(ctx) {
      var run = async function () {
        var ok = await waitForWorktable(6000);
        if (!ok) {
          showBanner('缺少 dsh-worktable（>= 0.4.0）：医学工作台项目入口无法初始化。请在 DSH 插件页安装并启用 dsh-worktable 后重试。', function () { apply(ctx); });
          return;
        }
        try {
          await ensure(ctx);
        } catch (error) {
          showBanner('医学工作台入口初始化失败：' + (error && error.message ? error.message : String(error)), function () { ensure(ctx).catch(function (e) { showBanner(e.message); }); });
        }
      };
      return run();
    }

    var inject = ['sessions', 'workspaces'];
    return { apply: apply, inject: inject };
  }
});
