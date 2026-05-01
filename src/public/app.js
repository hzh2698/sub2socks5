const editor = document.getElementById('config-editor');
const nodesEl = document.getElementById('nodes');
const runtimeEl = document.getElementById('runtime');
const generatedEl = document.getElementById('generated');
const kernelEl = document.getElementById('kernel');
const architectureEl = document.getElementById('architecture');
const logsEl = document.getElementById('logs');
const statusBar = document.getElementById('status-bar');
const editorStatus = document.getElementById('editor-status');
const actionButtons = [...document.querySelectorAll('.actions button'), ...document.querySelectorAll('.section-heading-actions button')];
const formView = document.getElementById('form-view');
const jsonView = document.getElementById('json-view');
const switchFormButton = document.getElementById('switch-form');
const switchJsonButton = document.getElementById('switch-json');
const tabButtons = [...document.querySelectorAll('.tab-button')];
const manageNodesButton = document.getElementById('manage-nodes');
const tabPanels = {
  overview: document.getElementById('tab-overview'),
  logs: document.getElementById('tab-logs')
};

const kernelVersionSelect = document.getElementById('kernel-version-select');
const kernelSelectVersionButton = document.getElementById('kernel-select-version');
const kernelArchSelect = document.getElementById('kernel-arch-select');
const kernelCheckUpdatesButton = document.getElementById('kernel-check-updates');

const forms = {
  architecture: document.getElementById('architecture-form'),
  kernel: document.getElementById('kernel-form'),
  subscription: document.getElementById('subscription-form'),
  runtime: document.getElementById('runtime-form'),
  generated: document.getElementById('generated-form'),
  logs: document.getElementById('logs-form')
};

const fields = {
  subscriptionUrl: document.getElementById('field-subscription-url'),
  subscriptionFormat: document.getElementById('field-subscription-format'),
  appHost: document.getElementById('field-app-host'),
  appPort: document.getElementById('field-app-port'),
  appBinary: document.getElementById('field-app-binary'),
  appLogLevel: document.getElementById('field-app-log-level'),
  appAutoStart: document.getElementById('field-app-auto-start'),
  dnsStrategy: document.getElementById('field-dns-strategy'),
  dnsRemoteUrl: document.getElementById('field-dns-remote-url'),
  dnsBootstrap: document.getElementById('field-dns-bootstrap'),
  routeFinal: document.getElementById('field-route-final'),
  portListen: document.getElementById('field-port-listen'),
  portNumber: document.getElementById('field-port-number'),
  portTarget: document.getElementById('field-port-target'),
  portSniff: document.getElementById('field-port-sniff')
};

const infoViews = {
  architecture: setupInfoView('architecture'),
  kernel: setupInfoView('kernel'),
  subscription: setupInfoView('subscription'),
  runtime: setupInfoView('runtime'),
  generated: setupInfoView('generated'),
  logs: setupInfoView('logs')
};

let lastSavedConfigText = '';
let currentView = 'form';
let formTouched = false;
let latestData = {
  config: null,
  subscription: null,
  availableOutbounds: [],
  runtime: null,
  kernel: null,
  architecture: null,
  plannedKernel: null,
  releaseList: [],
  generated: null,
  logs: null,
  download: null
};
let downloadInFlight = false;

async function load() {
  const [configData, generatedData, logsData, downloadData] = await Promise.all([
    api('/api/config'),
    api('/api/runtime/generated'),
    api('/api/runtime/logs'),
    api('/api/kernel/download')
  ]);

  latestData = {
    config: configData.config,
    subscription: configData.subscription,
    availableOutbounds: configData.availableOutbounds || [],
    runtime: configData.runtime,
    kernel: configData.kernel,
    architecture: configData.architecture || { stored: false, message: '尚未检测架构' },
    plannedKernel: configData.plannedKernel || null,
    releaseList: configData.releaseList || [],
    generated: generatedData,
    logs: logsData,
    download: downloadData
  };

  const formattedConfig = JSON.stringify(configData.config, null, 2);
  const shouldReplaceEditor = !isEditorDirty() || editor.value.trim() === '' || editor.value === lastSavedConfigText;

  if (shouldReplaceEditor) {
    editor.value = formattedConfig;
  }

  if (!formTouched && (!isFormDirty() || shouldReplaceEditor)) {
    fillForm(configData.config);
  }

  lastSavedConfigText = formattedConfig;
  updateEditorState();
  renderOverview();
}

function renderOverview() {
  nodesEl.textContent = JSON.stringify(latestData.subscription, null, 2);
  runtimeEl.textContent = JSON.stringify(latestData.runtime, null, 2);
  kernelEl.textContent = JSON.stringify(
    {
      ...latestData.kernel,
      plannedKernel: latestData.plannedKernel,
      releaseListCount: latestData.releaseList.length
    },
    null,
    2
  );
  architectureEl.textContent = JSON.stringify(latestData.architecture, null, 2);
  generatedEl.textContent = JSON.stringify(latestData.generated, null, 2);
  logsEl.textContent = (latestData.logs?.logs || []).join('\n') || '暂无运行日志';

  renderKeyValue(forms.architecture, flattenObject({
    stored: Boolean(latestData.architecture?.detectedAt),
    ...latestData.architecture,
    plannedVersion: latestData.plannedKernel?.version || ''
  }));
  renderKeyValue(forms.kernel, flattenObject({
    installed: latestData.kernel?.installed,
    binaryPath: latestData.kernel?.binaryPath,
    installedVersion: latestData.kernel?.releaseInfo?.version || latestData.kernel?.releaseInfo?.tag_name || '',
    plannedVersion: latestData.plannedKernel?.version || '',
    plannedAsset: latestData.plannedKernel?.assetName || '',
    releaseListCount: latestData.releaseList.length
  }));
  renderKeyValue(forms.subscription, buildSubscriptionSummary(latestData.subscription));
  renderKeyValue(forms.runtime, buildRuntimeSummary(latestData.runtime));
  renderKeyValue(forms.generated, buildGeneratedSummary(latestData.generated));
  renderLogTimeline(forms.logs, latestData.logs?.logs || []);
  renderArchitectureSelector();
  renderKernelVersionOptions();
  renderOutboundOptions();
}

function renderArchitectureSelector() {
  kernelArchSelect.value = latestData.architecture?.assetSuffix || 'windows-amd64';
}

function renderKernelVersionOptions() {
  const releases = latestData.releaseList || [];
  const selectedVersion = latestData.plannedKernel?.version || '';
  kernelVersionSelect.innerHTML = '';

  if (!releases.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '请先检测架构';
    kernelVersionSelect.appendChild(option);
    kernelVersionSelect.disabled = true;
    kernelSelectVersionButton.disabled = true;
    return;
  }

  for (const release of releases) {
    const option = document.createElement('option');
    option.value = release.version;
    option.textContent = release.version;
    option.selected = release.version === selectedVersion;
    kernelVersionSelect.appendChild(option);
  }

  if (!kernelVersionSelect.value && releases[0]) {
    kernelVersionSelect.value = releases[0].version;
  }

  kernelVersionSelect.disabled = false;
  kernelSelectVersionButton.disabled = false;
}

function renderOutboundOptions() {
  const outbounds = latestData.availableOutbounds?.length
    ? latestData.availableOutbounds
    : [{ tag: 'direct', label: 'direct', type: 'direct', source: 'builtin' }];

  renderSelectOptions(fields.routeFinal, outbounds, latestData.config?.routing?.routeFinal || 'proxy');
  renderSelectOptions(fields.portTarget, outbounds, latestData.config?.ports?.[0]?.target || 'proxy');
}

function renderSelectOptions(select, options, selected) {
  select.innerHTML = '';
  for (const optionInfo of options) {
    const option = document.createElement('option');
    option.value = optionInfo.tag;
    option.textContent = optionInfo.label || optionInfo.tag;
    option.selected = optionInfo.tag === selected;
    select.appendChild(option);
  }
  if (!select.value && options[0]) {
    select.value = options[0].tag;
  }
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}'
  });
  const data = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response));
  }
  return data;
}

async function api(path) {
  const response = await fetch(path);
  const data = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response));
  }
  return data;
}

async function readResponseJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractErrorMessage(data, response) {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.raw === 'string' && data.raw.trim()) return data.raw;
  return `Request failed: ${response.status}`;
}

function setStatus(message, kind = 'idle') {
  statusBar.textContent = message;
  statusBar.className = `status-bar is-${kind}`;
}

function syncStatusBarWithDownload(downloadState = {}) {
  if (downloadState?.active !== true) return false;
  const progress = downloadState.progress || {};
  const stage = progress.stage || 'download';
  const message = progress.message || '正在下载';
  const percent = typeof progress.percent === 'number' ? `${progress.percent.toFixed(0)}%` : '处理中';
  const threads = progress.threads ? `，${progress.threads} 线程` : '';
  setStatus(`下载内核中 [${stage}] ${message}（${percent}${threads}）`, 'loading');
  return true;
}

function setBusy(isBusy) {
  if (downloadInFlight && isBusy) return;
  for (const button of actionButtons) {
    if (button.id === 'kernel-download' && downloadInFlight) {
      button.disabled = true;
      continue;
    }
    button.disabled = isBusy;
  }
}

function updateEditorState() {
  const validation = parseConfigFromCurrentView();
  if (!validation.ok) {
    editor.classList.add('is-invalid');
    editorStatus.textContent = `配置格式无效：${validation.error}`;
    editorStatus.className = 'editor-status is-invalid';
    return;
  }

  editor.classList.remove('is-invalid');
  if (validation.text === lastSavedConfigText) {
    editorStatus.textContent = '配置已保存';
    editorStatus.className = 'editor-status is-saved';
    return;
  }

  editorStatus.textContent = '有未保存修改';
  editorStatus.className = 'editor-status is-dirty';
}

function parseConfigFromCurrentView() {
  return currentView === 'json' ? parseJsonEditor() : parseFormConfig(false);
}

function parseJsonEditor() {
  try {
    const value = JSON.parse(editor.value || '{}');
    return { ok: true, value, text: JSON.stringify(value, null, 2) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseFormConfig(validateRequired = false) {
  try {
    const parsedJson = parseJsonEditor();
    const base = parsedJson.ok ? parsedJson.value : JSON.parse(lastSavedConfigText || '{}');
    const next = structuredClone(base);

    next.subscription ||= {};
    next.app ||= {};
    next.dns ||= {};
    next.routing ||= {};
    next.nodeRegistry ||= { manualNodes: [], groups: [] };

    next.subscription.url = fields.subscriptionUrl.value.trim();
    next.subscription.format = fields.subscriptionFormat.value;
    next.app.host = fields.appHost.value.trim();
    next.app.port = Number(fields.appPort.value || 0);
    next.app.singBoxBinary = fields.appBinary.value.trim();
    next.app.logLevel = fields.appLogLevel.value;
    next.app.autoStart = fields.appAutoStart.checked;
    next.dns.strategy = fields.dnsStrategy.value;
    next.dns.remoteUrl = fields.dnsRemoteUrl.value.trim();
    next.dns.bootstrapServer = fields.dnsBootstrap.value.trim();
    next.routing.routeFinal = fields.routeFinal.value;

    if (!Array.isArray(next.ports) || !next.ports.length) {
      next.ports = [{}];
    }

    next.ports[0] = {
      ...next.ports[0],
      tag: next.ports[0].tag || 'default-socks',
      listen: fields.portListen.value.trim(),
      port: Number(fields.portNumber.value || 0),
      target: fields.portTarget.value,
      sniff: fields.portSniff.checked
    };

    if (validateRequired) {
      if (!next.subscription.url) throw new Error('订阅地址不能为空');
      if (!next.app.host) throw new Error('Web UI 监听地址不能为空');
      if (!Number.isInteger(next.app.port) || next.app.port <= 0) throw new Error('Web UI 端口无效');
      if (!next.app.singBoxBinary) throw new Error('sing-box 二进制路径不能为空');
      if (!next.routing.routeFinal) throw new Error('默认路由出口不能为空');
      if (!next.ports[0].listen) throw new Error('SOCKS 监听地址不能为空');
      if (!Number.isInteger(next.ports[0].port) || next.ports[0].port <= 0) throw new Error('SOCKS 端口无效');
      if (!next.ports[0].target) throw new Error('SOCKS 目标出口不能为空');
    }

    return { ok: true, value: next, text: JSON.stringify(next, null, 2) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function fillForm(config) {
  fields.subscriptionUrl.value = config.subscription?.url || '';
  fields.subscriptionFormat.value = config.subscription?.format || 'raw';
  fields.appHost.value = config.app?.host || '127.0.0.1';
  fields.appPort.value = config.app?.port || 18080;
  fields.appBinary.value = config.app?.singBoxBinary || '';
  fields.appLogLevel.value = config.app?.logLevel || 'info';
  fields.appAutoStart.checked = Boolean(config.app?.autoStart);
  fields.dnsStrategy.value = config.dns?.strategy || 'prefer_ipv4';
  fields.dnsRemoteUrl.value = config.dns?.remoteUrl || 'https://1.1.1.1/dns-query';
  fields.dnsBootstrap.value = config.dns?.bootstrapServer || '223.5.5.5';

  const firstPort = config.ports?.[0] || {};
  fields.portListen.value = firstPort.listen || '127.0.0.1';
  fields.portNumber.value = firstPort.port || 1080;
  fields.portSniff.checked = firstPort.sniff !== false;
}

function isEditorDirty() {
  return editor.value !== lastSavedConfigText;
}

function isFormDirty() {
  const parsed = parseFormConfig(false);
  return parsed.ok ? parsed.text !== lastSavedConfigText : true;
}

function syncFormToJson() {
  const parsed = parseFormConfig(false);
  if (parsed.ok) editor.value = parsed.text;
  updateEditorState();
  return parsed;
}

function syncJsonToForm() {
  const parsed = parseJsonEditor();
  if (parsed.ok) {
    fillForm(parsed.value);
    formTouched = false;
  }
  updateEditorState();
  return parsed;
}

function switchView(view) {
  if (view === currentView) return;
  if (view === 'json') {
    const parsed = syncFormToJson();
    if (!parsed.ok) return setStatus(`切换失败：${parsed.error}`, 'error');
  } else {
    const parsed = syncJsonToForm();
    if (!parsed.ok) return setStatus(`切换失败：${parsed.error}`, 'error');
  }
  currentView = view;
  formView.classList.toggle('is-hidden', view !== 'form');
  jsonView.classList.toggle('is-hidden', view !== 'json');
  switchFormButton.classList.toggle('is-active', view === 'form');
  switchJsonButton.classList.toggle('is-active', view === 'json');
  updateEditorState();
}

function switchTab(tabName) {
  for (const button of tabButtons) {
    button.classList.toggle('is-active', button.dataset.tab === tabName);
  }
  for (const [name, panel] of Object.entries(tabPanels)) {
    panel.classList.toggle('is-active', name === tabName);
    panel.classList.toggle('is-hidden', name !== tabName);
  }
}

function setupInfoView(name) {
  const formViewEl = document.getElementById(`${name}-form-view`);
  const jsonViewEl = document.getElementById(`${name}-json-view`);
  const formButton = document.getElementById(`switch-${name}-form`);
  const jsonButton = document.getElementById(`switch-${name}-json`);
  const state = { formViewEl, jsonViewEl, formButton, jsonButton };
  formButton.addEventListener('click', () => setInfoView(name, 'form'));
  jsonButton.addEventListener('click', () => setInfoView(name, 'json'));
  return state;
}

function setInfoView(name, mode) {
  const state = infoViews[name];
  state.formViewEl.classList.toggle('is-hidden', mode !== 'form');
  state.jsonViewEl.classList.toggle('is-hidden', mode !== 'json');
  state.formButton.classList.toggle('is-active', mode === 'form');
  state.jsonButton.classList.toggle('is-active', mode === 'json');
}

function renderKeyValue(container, entries) {
  container.innerHTML = '';
  for (const [key, value] of Object.entries(entries)) {
    const item = document.createElement('div');
    item.className = 'kv-item';
    item.innerHTML = `<div class="key">${escapeHtml(key)}</div><div class="value">${escapeHtml(String(value))}</div>`;
    container.appendChild(item);
  }
}

function renderTimeline(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'timeline-item';
    empty.innerHTML = '<div class="title">暂无内容</div>';
    container.appendChild(empty);
    return;
  }
  for (const item of items.slice().reverse()) {
    const node = document.createElement('div');
    node.className = 'timeline-item';
    node.innerHTML = `
      <div class="time">${escapeHtml(item.time || '')}</div>
      <div class="title">${escapeHtml(item.title || '')}</div>
      <div class="details">${escapeHtml(item.details || '')}</div>
    `;
    container.appendChild(node);
  }
}

function renderLogTimeline(container, logs) {
  renderTimeline(container, logs.map((line, index) => ({
    time: `#${index + 1}`,
    title: '运行日志',
    details: line
  })));
}

function flattenObject(input, prefix = '', output = {}) {
  for (const [key, value] of Object.entries(input || {})) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, nextKey, output);
    } else {
      output[nextKey] = Array.isArray(value) ? JSON.stringify(value) : (value ?? '');
    }
  }
  return output;
}

function buildSubscriptionSummary(subscription) {
  const nodes = subscription?.nodes || [];
  return {
    updatedAt: subscription?.updatedAt || '',
    nodeCount: nodes.length + 1,
    warningCount: (subscription?.warnings || []).length,
    firstNode: 'direct',
    warnings: (subscription?.warnings || []).join(' | ')
  };
}

function buildRuntimeSummary(runtime) {
  return {
    state: runtime?.state || '',
    running: runtime?.running || false,
    logCount: (runtime?.logs || []).length,
    latestLog: runtime?.logs?.slice(-1)[0] || ''
  };
}

function buildGeneratedSummary(generated) {
  return {
    inboundCount: generated?.inbounds?.length || 0,
    outboundCount: generated?.outbounds?.length || 0,
    routeRuleCount: generated?.route?.rules?.length || 0,
    dnsServerCount: generated?.dns?.servers?.length || 0,
    finalOutbound: generated?.route?.final || '',
    logLevel: generated?.log?.level || ''
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function action(label, fn) {
  try {
    setBusy(true);
    setStatus(`${label}进行中...`, 'loading');
    await fn();
    await load();
    if (!syncStatusBarWithDownload(latestData.download)) {
      setStatus(`${label}完成`, 'success');
    }
  } catch (error) {
    setStatus(`${label}失败：${error.message}`, 'error');
  } finally {
    if (!downloadInFlight) setBusy(false);
  }
}

async function detectArchitectureAndLoadReleases() {
  await post('/api/kernel/architecture', { assetSuffix: kernelArchSelect.value });
  await api('/api/kernel/releases');
}

async function startDownloadFlow() {
  downloadInFlight = true;
  setBusy(false);
  try {
    await detectArchitectureAndLoadReleases();
    if (kernelVersionSelect.value) {
      await post('/api/kernel/plan', { version: kernelVersionSelect.value });
    }
    await post('/api/kernel/download');
    await load();
    syncStatusBarWithDownload(latestData.download);
  } finally {
    downloadInFlight = false;
    setBusy(false);
  }
}

document.getElementById('save-config').onclick = () => action('保存配置', async () => {
  const validation = currentView === 'json' ? parseJsonEditor() : parseFormConfig(true);
  if (!validation.ok) {
    updateEditorState();
    throw new Error(validation.error);
  }
  editor.value = validation.text;
  await post('/api/config', validation.value);
  lastSavedConfigText = validation.text;
  formTouched = false;
  fillForm(validation.value);
  updateEditorState();
});

document.getElementById('refresh-sub').onclick = () => action('更新订阅', async () => {
  await post('/api/subscription/refresh');
});

document.getElementById('generate').onclick = () => action('生成配置', async () => {
  await post('/api/runtime/generate');
});

document.getElementById('start').onclick = () => action('启动 sing-box', async () => {
  await post('/api/runtime/start');
});

document.getElementById('stop').onclick = () => action('停止 sing-box', async () => {
  await post('/api/runtime/stop');
});

document.getElementById('kernel-architecture-detect').onclick = () => action('检测当前架构', async () => {
  await detectArchitectureAndLoadReleases();
});

document.getElementById('kernel-check').onclick = () => action('检查内核版本', async () => {
  await Promise.all([api('/api/kernel/status'), api('/api/kernel/releases')]);
});

kernelCheckUpdatesButton.onclick = () => action('检查版本更新', async () => {
  await post('/api/kernel/releases/update');
});

kernelSelectVersionButton.onclick = () => action('设为计划版本', async () => {
  if (!kernelVersionSelect.value) throw new Error('请先选择一个内核版本');
  await post('/api/kernel/plan', { version: kernelVersionSelect.value });
});

document.getElementById('kernel-download').onclick = async () => {
  try {
    setStatus('开始拉取 sing-box 内核...', 'loading');
    await startDownloadFlow();
  } catch (error) {
    setStatus(`拉取 sing-box 内核失败：${error.message}`, 'error');
  }
};

manageNodesButton?.addEventListener('click', () => {
  window.location.href = '/nodes.html';
});

kernelArchSelect.addEventListener('change', () => {
  const [os, archName] = kernelArchSelect.value.split('-');
  latestData.architecture = {
    ...(latestData.architecture || {}),
    os,
    archName,
    assetSuffix: kernelArchSelect.value
  };
  renderArchitectureSelector();
});

switchFormButton.addEventListener('click', () => switchView('form'));
switchJsonButton.addEventListener('click', () => switchView('json'));
editor.addEventListener('input', updateEditorState);

for (const button of tabButtons) {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
}

for (const element of Object.values(fields)) {
  element?.addEventListener('input', () => {
    formTouched = true;
    updateEditorState();
  });
  element?.addEventListener('change', () => {
    formTouched = true;
    updateEditorState();
  });
}

load()
  .then(() => {
    switchView('form');
    switchTab('overview');
    if (!syncStatusBarWithDownload(latestData.download)) {
      setStatus('准备就绪', 'idle');
    }
  })
  .catch((error) => setStatus(`初始化失败：${error.message}`, 'error'));

setInterval(() => {
  load()
    .then(() => {
      const downloading = syncStatusBarWithDownload(latestData.download);
      if (downloading) {
        setBusy(false);
      } else if (!statusBar.classList.contains('is-error')) {
        setStatus('准备就绪', 'idle');
      }
    })
    .catch(() => {});
}, 2000);
