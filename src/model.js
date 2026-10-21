/* ================================================================
   模型接入：DSH 会话模型 / 自定义 OpenAI 兼容 API
   宿主接口为同源相对路径 /api/medresearch/model/*，由原生插件提供。
   ================================================================ */
var MODEL_STATUS_LABELS = {
  untested: '已选择但未测试',
  success: '测试成功',
  unconfigured: '未配置',
  'auth-failed': '认证失败',
  quota: '余额或额度不足',
  'rate-limited': '请求被限流',
  'model-not-found': '模型不存在',
  network: '网络失败',
  timeout: '请求超时',
  'host-unavailable': '宿主接口不可用',
  'bad-config': '配置不完整',
  empty: '模型返回空回答',
  filtered: '内容被安全过滤',
  'upstream-failed': '上游调用失败',
  aborted: '调用已中断'
};
var MODEL_STATUS_CLASS = {
  success: 'ok',
  untested: 'warn',
  unconfigured: 'warn',
  'host-unavailable': 'bad',
  'auth-failed': 'bad',
  quota: 'bad',
  'rate-limited': 'warn',
  'model-not-found': 'bad',
  network: 'bad',
  timeout: 'warn',
  'bad-config': 'warn',
  empty: 'bad',
  filtered: 'bad',
  'upstream-failed': 'bad',
  aborted: 'warn'
};

function modelBinding() {
  var matches = [];
  try {
    var bindings = JSON.parse(localStorage.getItem('dsh.worktable.widgetBindings.v2') || '{}');
    var dir = String(projectDir() || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!dir) return { sessionId: '', reason: 'none', matches: 0 };
    Object.keys(bindings).forEach(function (layoutId) {
      var panes = bindings[layoutId] || {};
      Object.keys(panes).forEach(function (paneId) {
        var row = panes[paneId];
        if (!row || !row.sessionId || row.enabled === false) return;
        var folder = String(row.folder || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        if (folder === dir) matches.push({ layoutId: layoutId, paneId: paneId, sessionId: String(row.sessionId) });
      });
    });
  } catch (e) {
    return { sessionId: '', reason: 'ambiguous', matches: 0, error: apiErrorMessage(e) };
  }
  // 当前 iframe 没有布局/窗格身份可反查；同目录只有一个明确绑定才使用，
  // 多个绑定绝不任取一个，统一回退 DSH 默认模型并说明原因。
  if (matches.length === 1) return { sessionId: matches[0].sessionId, reason: 'unique', matches: 1 };
  if (matches.length === 0) return { sessionId: '', reason: 'none', matches: 0 };
  return { sessionId: '', reason: 'ambiguous', matches: matches.length };
}
function modelBindingContext() {
  var b = modelBinding();
  APP.modelBinding = b;
  return { sessionId: b.sessionId || '', binding: b.reason || 'none' };
}
function modelBindingQuery() {
  var c = modelBindingContext();
  return 'sessionId=' + encodeURIComponent(c.sessionId) + '&binding=' + encodeURIComponent(c.binding);
}

function modelApi(path) {
  return '/api/medresearch/model' + path;
}

function modelStatusLabel(status) {
  return MODEL_STATUS_LABELS[status] || status || '未知状态';
}

function modelStatusClass(status) {
  return MODEL_STATUS_CLASS[status] || 'warn';
}

function modelChipHtml() {
  var m = APP.model || {};
  if (m.host === false) {
    return '<span class="statusChip bad click" data-act="modelSettings" title="宿主模型接口不可用；请安装/重启 dsh-medresearch-model 插件"><span class="dot"></span>模型接口不可用</span>';
  }
  if (m.loading || !m.mode) {
    return '<span class="statusChip warn click" data-act="modelSettings" title="正在读取模型设置"><span class="dot"></span>模型检测中</span>';
  }
  if (m.mode === 'custom') {
    var custom = m.custom || {};
    var ready = custom.hasKey && custom.model;
    return '<span class="statusChip ' + (ready ? 'ok' : 'warn') + ' click" data-act="modelSettings" title="' +
      esc(ready ? '自定义 API · ' + (custom.model || '') : '自定义 API 未配置完整') + '"><span class="dot"></span>' +
      (ready ? '自定义 API' : '模型未配置') + '</span>';
  }
  var dsh = m.dsh || {};
  var ok = dsh.available;
  var text = ok ? (dsh.source === 'session' ? 'DSH 模型' : 'DSH 默认模型') : '模型未配置';
  return '<span class="statusChip ' + (ok ? 'ok' : 'warn') + ' click" data-act="modelSettings" title="' +
    esc(ok ? dsh.label : (dsh.message || 'DSH 模型未配置')) + '"><span class="dot"></span>' + esc(text) + '</span>';
}

function modelRefresh(opts) {
  opts = opts || {};
  if (APP.modelSettingsOpen && !opts.force) return Promise.resolve(APP.model);
  if (!APP.model) APP.model = { loading: true, host: null };
  APP.model.loading = true;
  if (!APP.modelSettingsOpen) renderHead();
  return fetchJsonNice(modelApi('/settings?' + modelBindingQuery()), {}, 8000)
    .then(function (r) {
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      APP.model = r.json;
      APP.model.host = true;
      APP.model.loading = false;
      APP.model.error = '';
      renderHead();
      if (APP.modelSettingsOpen && opts.paint !== false) paintModelDsh();
      return APP.model;
    })
    .catch(function (err) {
      APP.model.loading = false;
      APP.model.host = false;
      APP.model.error = apiErrorMessage(err);
      renderHead();
      if (APP.modelSettingsOpen && opts.paint !== false) paintModelDsh();
      return APP.model;
    });
}

function modelFormFromState() {
  var m = APP.model || {};
  var custom = m.custom || {};
  return {
    mode: m.mode === 'custom' ? 'custom' : 'dsh',
    provider: custom.provider || 'openai',
    baseURL: custom.baseURL || custom.defaultBaseURL || '',
    model: custom.model || '',
    apiKey: '',
    rememberKey: custom.rememberKey === true,
    dirty: false,
    testing: false
  };
}

function modelFieldHtml(label, html) {
  return '<div class="field"><label>' + esc(label) + '</label>' + html + '</div>';
}

function modelDshHtml() {
  var d = (APP.model && APP.model.dsh) || {};
  if (APP.model && APP.model.host === false) {
    return '<div class="banner bannerBad"><div class="grow"><b>宿主接口不可用</b><br>' + esc(APP.model.error || '请安装并重启 dsh-medresearch-model 宿主插件。') + '</div></div>';
  }
  if (!d.available) {
    return '<div class="banner bannerWarn"><div class="grow"><b>DSH 模型未配置</b><br>' + esc(d.message || '当前会话和 DSH 默认模型都没有可用选择。') + '</div></div>';
  }
  var src = d.source === 'session' ? '当前工作台明确绑定会话' : '使用 DSH 默认模型';
  var bindingText = d.bindingReason === 'ambiguous'
    ? '同目录存在多个绑定，无法唯一确定；已按默认模型回退，不任取一个。'
    : d.source === 'session'
      ? '当前工作台只有唯一匹配绑定；你在 DSH 切换模型后，下一次请求生效。'
      : d.bindingReason === 'none'
        ? '未找到当前工作台的明确绑定，明确按 DSH 默认模型使用。'
        : '未能可靠取得当前会话选择，明确按 DSH 默认模型使用。';
  return '<div class="modelInfoBox">' +
    '<div class="kv">' +
    '<div class="k">选择来源</div><div class="v">' + esc(src) + '</div>' +
    '<div class="k">Provider</div><div class="v mono">' + esc(d.provider || '—') + '</div>' +
    '<div class="k">Model</div><div class="v mono">' + esc(d.model || '—') + '</div>' +
    '<div class="k">推理设置</div><div class="v">' + esc(d.reasoningEffort || '未指定') + '</div>' +
    '<div class="k">说明</div><div class="v">' + esc(bindingText) + '</div>' +
    '</div>' +
    (d.sessionMissing ? '<div class="banner bannerWarn mt8"><div class="grow">工作台绑定会话当前未运行，已回退到 DSH 默认模型。</div></div>' : '') +
    (d.bindingReason === 'ambiguous' ? '<div class="banner bannerWarn mt8"><div class="grow"><b>多个绑定</b><br>未选择任何一个会话；将使用 DSH 默认模型。可关闭其他同目录工作台窗口后刷新。</div></div>' : '') +
    '</div>';
}

function modelStatusHtml() {
  var s = (APP.model && APP.model.status) || { status: 'untested', message: '尚未测试' };
  var status = APP.modelForm && APP.modelForm.testing ? 'testing' : (s.status || 'untested');
  var label = status === 'testing' ? '正在生成测试…' : modelStatusLabel(status);
  var when = s.at ? ' · ' + fmtDateTime(s.at) : '';
  var detail = s.message || '';
  return '<div class="modelStatusBox ' + (status === 'testing' ? 'warn' : modelStatusClass(status)) + '">' +
    '<div class="flex" style="justify-content:space-between"><b>' + esc(label) + esc(when) + '</b>' +
    (s.provider ? '<span class="chip mono">' + esc(s.provider + ' / ' + (s.model || '')) + '</span>' : '') + '</div>' +
    (detail ? '<div class="sub mt6">' + esc(detail) + '</div>' : '') +
    '</div>';
}

function paintModelStatus() {
  var box = $('#modelStatusBox');
  if (box) box.innerHTML = modelStatusHtml();
}
function modelInvalidateTest() {
  var s = (APP.model && APP.model.status) || {};
  if (s.status === 'untested' || s.status === 'testing') return;
  APP.model.status = { status: 'untested', at: 0, message: '配置已修改，需重新测试' };
  paintModelStatus();
}

function paintModelDsh() {
  var box = $('#modelDshBox');
  if (box) box.innerHTML = modelDshHtml();
  paintModelStatus();
}

function modelCustomHtml() {
  var f = APP.modelForm || modelFormFromState();
  var custom = (APP.model && APP.model.custom) || {};
  var provider = f.provider || 'openai';
  var defaults = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1', custom: '' };
  var base = f.baseURL || defaults[provider] || '';
  return '<div class="modelInfoBox">' +
    modelFieldHtml('服务商',
      '<select class="select" id="modelProvider" data-model-field="provider">' +
      '<option value="openai"' + (provider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
      '<option value="deepseek"' + (provider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>' +
      '<option value="custom"' + (provider === 'custom' ? ' selected' : '') + '>自定义 OpenAI 兼容服务</option>' +
      '</select>') +
    modelFieldHtml('API Base URL',
      '<input class="input" id="modelBaseURL" data-model-field="baseURL" placeholder="' + esc(defaults[provider] || 'https://api.example.com/v1') + '" value="' + esc(base) + '" />' +
      '<span class="hint">只支持 OpenAI 兼容的 /chat/completions；填到 /v1 或完整 /chat/completions 均可。</span>') +
    modelFieldHtml('模型名称',
      '<input class="input" id="modelName" data-model-field="model" placeholder="例如 gpt-4.1-mini / deepseek-chat" value="' + esc(f.model || '') + '" />' +
      '<span class="hint">模型名称不写死；以服务商实际模型 id 为准。</span>') +
    modelFieldHtml('API Key',
      '<input class="input" id="modelApiKey" data-model-field="apiKey" type="password" autocomplete="new-password" placeholder="' + esc(custom.hasKey ? '已保存；留空表示保留' : '输入 API Key') + '" value="" />' +
      '<span class="hint">密钥按“服务商 + 规范化 Base URL”隔离；更换平台或地址后不会沿用旧密钥，需为新地址填写。密钥只发给宿主后端，勾选“记住”后写入宿主凭据库，不进入页面 localStorage、数据文件或导出备份。</span>') +
    '<label class="checkRow"><input type="checkbox" id="modelRemember" data-model-field="rememberKey"' + (f.rememberKey ? ' checked' : '') + ' /> 在本机记住密钥（宿主凭据库）</label>' +
    '<div class="sub mt6">密钥状态：' + esc(custom.hasKey ? (custom.keySource === 'host-store' ? '已保存到宿主凭据库' : '已保存在本次进程内存') : '未配置') + '</div>' +
    (custom.hasKey ? '<div class="mt8"><button type="button" class="btnMini btnMiniDanger" data-act="modelClearKey">删除已保存密钥</button></div>' : '') +
    '<div class="banner mt10"><div class="grow">当前只支持 OpenAI 兼容 Chat Completions；Anthropic、Gemini 原生协议未实现。自定义设置不会修改 DSH 全局配置。</div></div>' +
    '</div>';
}

function openModelSettings() {
  APP.modelSettingsOpen = true;
  APP.modelForm = modelFormFromState();
  var body = '<div class="tabs" style="margin-bottom:10px">' +
    '<button type="button" class="tab ' + (APP.modelForm.mode === 'dsh' ? 'tabOn' : '') + '" data-act="modelMode" data-mode="dsh">使用 DSH 模型</button>' +
    '<button type="button" class="tab ' + (APP.modelForm.mode === 'custom' ? 'tabOn' : '') + '" data-act="modelMode" data-mode="custom">自定义 API</button>' +
    '</div>' +
    '<div id="modelDshPanel" style="display:' + (APP.modelForm.mode === 'dsh' ? 'block' : 'none') + '"><div id="modelDshBox">' + modelDshHtml() + '</div></div>' +
    '<div id="modelCustomPanel" style="display:' + (APP.modelForm.mode === 'custom' ? 'block' : 'none') + '"><div id="modelCustomBox">' + modelCustomHtml() + '</div></div>' +
    '<div class="divider"></div>' +
    '<div id="modelStatusBox">' + modelStatusHtml() + '</div>' +
    '<div class="flex mt10" style="flex-wrap:wrap">' +
    '<button type="button" class="btn" data-act="modelRefresh">刷新状态</button>' +
    '<button type="button" class="btn" data-act="modelSave">保存</button>' +
    '<button type="button" class="btn btnPrimary" data-act="modelTest">测试生成</button>' +
    '<button type="button" class="btn" data-act="modelClear">清除配置</button>' +
    '</div>' +
    '<div class="sub mt8">测试生成会真实调用付费模型；只有取得有效回答才算成功。定时状态检查只读取设置，不调用模型。</div>' +
    '<div id="modelDirty" class="muted mt6"></div>';
  openModal({ title: '模型设置', body: body, hideSubmit: true, focus: false });
  setTimeout(function () { paintModelStatus(); }, 0);
  modelRefresh({ force: true, paint: true });
}

function setModelMode(mode) {
  if (!APP.modelForm) APP.modelForm = modelFormFromState();
  var nextMode = mode === 'custom' ? 'custom' : 'dsh';
  var changed = APP.modelForm.mode !== nextMode;
  APP.modelForm.mode = nextMode;
  if (changed) {
    APP.modelForm.dirty = true;
    modelInvalidateTest();
  }
  document.querySelectorAll('[data-act="modelMode"]').forEach(function (b) {
    b.classList.toggle('tabOn', b.getAttribute('data-mode') === APP.modelForm.mode);
  });
  var d = $('#modelDshPanel'), c = $('#modelCustomPanel');
  if (d) d.style.display = APP.modelForm.mode === 'dsh' ? 'block' : 'none';
  if (c) c.style.display = APP.modelForm.mode === 'custom' ? 'block' : 'none';
  var dirty = $('#modelDirty');
  if (dirty) dirty.textContent = changed ? '模式已更改，点击“保存”后生效。' : '';
}

function modelCollectForm() {
  var f = APP.modelForm || modelFormFromState();
  var provider = $('#modelProvider');
  var base = $('#modelBaseURL');
  var name = $('#modelName');
  var key = $('#modelApiKey');
  var remember = $('#modelRemember');
  return {
    mode: f.mode,
    provider: provider ? provider.value : f.provider,
    baseURL: base ? base.value : f.baseURL,
    model: name ? name.value : f.model,
    apiKey: key ? key.value : '',
    rememberKey: remember ? remember.checked : f.rememberKey,
    ...modelBindingContext()
  };
}

function modelSave(opts) {
  opts = opts || {};
  var body = modelCollectForm();
  if (body.mode === 'custom' && !String(body.model || '').trim()) {
    toast('请填写模型名称');
    return Promise.resolve(false);
  }
  if (body.mode === 'custom' && !String(body.baseURL || '').trim() && body.provider === 'custom') {
    toast('请填写 API Base URL');
    return Promise.resolve(false);
  }
  return fetchJsonNice(modelApi('/save'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }, 12000).then(function (r) {
    if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
    var wasTesting = !!(APP.modelForm && APP.modelForm.testing);
    APP.model = r.json;
    APP.model.host = true;
    APP.model.loading = false;
    APP.modelForm = modelFormFromState();
    APP.modelForm.testing = wasTesting;
    renderHead();
    var customBox = $('#modelCustomBox');
    if (customBox && APP.modelForm.mode === 'custom') customBox.innerHTML = modelCustomHtml();
    paintModelDsh();
    var dirty = $('#modelDirty');
    if (dirty) dirty.textContent = '已保存；请点“测试生成”验证。';
    if (!opts.silent) toast('模型设置已保存');
    return true;
  }).catch(function (err) {
    var dirty = $('#modelDirty');
    if (dirty) dirty.textContent = '保存失败：' + apiErrorMessage(err);
    toast('保存失败：' + apiErrorMessage(err));
    return false;
  });
}

function modelTest() {
  if (!APP.modelForm) APP.modelForm = modelFormFromState();
  if (APP.modelForm.testing) return Promise.resolve();
  APP.modelForm.testing = true;
  paintModelStatus();
  return modelSave({ silent: true }).then(function (saved) {
    if (!saved) {
      APP.modelForm.testing = false;
      paintModelStatus();
      return;
    }
    return fetchJsonNice(modelApi('/test'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modelBindingContext())
    }, 70000).then(function (r) {
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      var j = r.json || {};
      APP.model.status = {
        status: j.status || (j.ok ? 'success' : 'upstream-failed'),
        at: j.at || Date.now(),
        message: j.message || '',
        provider: j.provider || '',
        model: j.model || '',
        source: j.source || ''
      };
      APP.modelForm.testing = false;
      paintModelStatus();
      renderHead();
      toast(j.ok ? '测试生成成功' : '测试未通过：' + (j.message || j.status || '未知原因'));
    });
  }).catch(function (err) {
    APP.modelForm.testing = false;
    APP.model.status = { status: 'network', at: Date.now(), message: apiErrorMessage(err) };
    paintModelStatus();
    toast('测试失败：' + apiErrorMessage(err));
  }).finally(function () {
    if (APP.modelForm) APP.modelForm.testing = false;
    paintModelStatus();
  });
}

function modelClear() {
  if (!window.confirm('清除自定义模型配置和已保存密钥？DSH 全局配置不会被修改。')) return;
  fetchJsonNice(modelApi('/clear'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modelBindingContext()) }, 12000)
    .then(function (r) {
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      APP.model = r.json;
      APP.model.host = true;
      APP.modelForm = modelFormFromState();
      renderHead();
      var customBox = $('#modelCustomBox');
      if (customBox) customBox.innerHTML = modelCustomHtml();
      paintModelDsh();
      toast('已清除模型配置');
    })
    .catch(function (err) { toast('清除失败：' + apiErrorMessage(err)); });
}

function modelClearKey() {
  if (!window.confirm('删除已保存的自定义 API Key？')) return;
  fetchJsonNice(modelApi('/clear-key'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modelBindingContext()) }, 12000)
    .then(function (r) {
      if (!r.ok) throw new Error((r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.status));
      APP.model = r.json;
      APP.model.host = true;
      var key = $('#modelApiKey');
      if (key) key.value = '';
      var customBox = $('#modelCustomBox');
      if (customBox) customBox.innerHTML = modelCustomHtml();
      renderHead();
      paintModelDsh();
      toast('已删除保存的密钥');
    })
    .catch(function (err) { toast('删除密钥失败：' + apiErrorMessage(err)); });
}

function askHostModel(payload) {
  if (APP.model && APP.model.host === false) {
    return Promise.reject(new Error('宿主模型接口不可用；请安装/重启 dsh-medresearch-model 插件。'));
  }
  var body = Object.assign({}, payload, modelBindingContext());
  return fetchJsonNice(modelApi('/ask'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }, 70000).then(function (r) {
    if (!r.ok) {
      var msg = (r.json && r.json.error && r.json.error.message) || ('模型调用失败 HTTP ' + r.status);
      if (r.status === 403) msg = '宿主模型接口拒绝访问；请从 DSH 工作台窗口打开。';
      var err = new Error(msg);
      err.code = r.json && r.json.error && r.json.error.code;
      err.status = r.status;
      throw err;
    }
    if (!r.json || !r.json.ok || !r.json.answer) throw new Error('模型返回空回答');
    return r.json;
  });
}

document.addEventListener('input', function (ev) {
  var el = ev.target;
  if (!el || !el.getAttribute || !el.getAttribute('data-model-field')) return;
  if (!APP.modelForm) APP.modelForm = modelFormFromState();
  var field = el.getAttribute('data-model-field');
  APP.modelForm[field] = el.type === 'checkbox' ? el.checked : el.value;
  APP.modelForm.dirty = true;
  modelInvalidateTest();
  var dirty = $('#modelDirty');
  if (dirty) dirty.textContent = '有未保存修改；测试生成会先保存。';
});

document.addEventListener('change', function (ev) {
  var el = ev.target;
  if (!el || !el.id) return;
  if (el.id === 'modelProvider') {
    if (!APP.modelForm) APP.modelForm = modelFormFromState();
    APP.modelForm.provider = el.value;
    APP.modelForm.dirty = true;
    modelInvalidateTest();
    var base = $('#modelBaseURL');
    if (base) {
      var defaults = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1', custom: '' };
      base.value = defaults[el.value] || '';
      base.placeholder = defaults[el.value] || 'https://api.example.com/v1';
      APP.modelForm.baseURL = base.value;
    }
    var customBox = $('#modelCustomBox');
    if (customBox) customBox.innerHTML = modelCustomHtml();
    var dirty = $('#modelDirty');
    if (dirty) dirty.textContent = '服务商已更改；请确认地址与模型后保存。';
  }
});


