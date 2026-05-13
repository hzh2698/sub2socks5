const editor = document.getElementById('config-editor');
const nodesEl = document.getElementById('nodes');

const generatedEl = document.getElementById('generated');
const kernelEl = document.getElementById('kernel');
const architectureEl = document.getElementById('architecture');
const logsEl = document.getElementById('logs');
const statusBar = document.getElementById('status-bar');
const editorStatus = document.getElementById('editor-status');
const actionButtons = [
  ...document.querySelectorAll('.actions button'),
  ...document.querySelectorAll('.section-heading-actions button')
];
const formView = document.getElementById('form-view');
const jsonView = document.getElementById('json-view');
const switchFormButton = document.getElementById('switch-form');
const switchJsonButton = document.getElementById('switch-json');
const tabButtons = [...document.querySelectorAll('.tab-button')];
const manageNodesButton = document.getElementById('manage-nodes');
const socksServicesEl = document.getElementById('socks-services');
const socksCountEl = document.getElementById('socks-count');
const exportSocksButton = document.getElementById('export-socks');
const copySocksButton = document.getElementById('copy-socks');
const autoConfigureSocksButton = document.getElementById('auto-configure-socks');
const editSocksServiceButton = document.getElementById('edit-socks-service');
const subscriptionUrlsEl = document.getElementById('subscription-urls');
const addSubscriptionUrlButton = document.getElementById('add-subscription-url');
const kernelVersionSelect = document.getElementById('kernel-version-select');
const kernelSelectVersionButton = document.getElementById('kernel-select-version');
const kernelArchSelect = document.getElementById('kernel-arch-select');
const kernelCheckUpdatesButton = document.getElementById('kernel-check-updates');
const dnsRemoteUrlWrap = document.getElementById('field-dns-remote-url-wrap');
const dnsBootstrapWrap = document.getElementById('field-dns-bootstrap-wrap');

const tabPanels = {
  overview: document.getElementById('tab-overview'),
  logs: document.getElementById('tab-logs')
};

const NODES_UPDATED_KEY = 'sub2socks5:nodes-updated-at';
const DNS_PRESET_URLS = {
  google: 'https://dns.google/dns-query',
  cloudflare: 'https://cloudflare-dns.com/dns-query'
};
const DNS_BOOTSTRAP_PRESETS = ['1.1.1.1', '8.8.8.8', '223.5.5.5'];

const forms = {
  architecture: document.getElementById('architecture-form'),
  kernel: document.getElementById('kernel-form'),
  subscription: document.getElementById('subscription-form'),
  logs: document.getElementById('logs-form')
};

const fields = {
  appHost: document.getElementById('field-app-host'),
  appPort: document.getElementById('field-app-port'),
  appBinary: document.getElementById('field-app-binary'),
  appLogLevel: document.getElementById('field-app-log-level'),
  appAutoStart: document.getElementById('field-app-auto-start'),
  appAutoConfigureSubscription: document.getElementById('field-app-auto-configure-subscription'),
  dnsStrategy: document.getElementById('field-dns-strategy'),
  dnsRemotePreset: document.getElementById('field-dns-remote-preset'),
  dnsRemoteUrl: document.getElementById('field-dns-remote-url'),
  dnsBootstrapPreset: document.getElementById('field-dns-bootstrap-preset'),
  dnsBootstrap: document.getElementById('field-dns-bootstrap'),
  routeFinal: document.getElementById('field-route-final')
};

const infoViews = {
  architecture: setupInfoView('architecture'),
  kernel: setupInfoView('kernel'),
  subscription: setupInfoView('subscription'),
  logs: setupInfoView('logs')
};

let lastSavedConfigText = '';
let currentView = 'form';
let formTouched = false;
let lastKnownNodesUpdatedAt = localStorage.getItem(NODES_UPDATED_KEY) || '';
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
let formPorts = [];
let formSubscriptionUrls = [];
let isFormInteracting = false;
let selectedKernelArch = 'windows-amd64';
let selectedKernelVersion = '';
let kernelArchManuallySelected = false;

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

  if (!isFormInteracting && !formTouched && (!isFormDirty() || shouldReplaceEditor)) {
    fillForm(configData.config);
  }

  lastSavedConfigText = formattedConfig;
  updateEditorState();
  renderOverview();
}

function renderOverview() {
  nodesEl.textContent = JSON.stringify(latestData.subscription, null, 2);
  kernelEl.textContent = JSON.stringify({
    ...latestData.kernel,
    plannedKernel: latestData.plannedKernel,
    releaseListCount: latestData.releaseList.length
  }, null, 2);
  architectureEl.textContent = JSON.stringify(latestData.architecture, null, 2);
  if (generatedEl) generatedEl.textContent = JSON.stringify(latestData.generated, null, 2);
  logsEl.textContent = (latestData.logs?.logs || []).join('\n') || '暂无运行日志';

  const arch = latestData.architecture || {};
  renderKeyValue(forms.architecture, chineseLabels(flattenObject({
    stored: Boolean(arch.detectedAt),
    platform: arch.platform || '',
    arch: arch.arch || '',
    executableName: arch.executableName || '',
    assetSuffix: arch.assetSuffix || '',
    plannedVersion: latestData.plannedKernel?.version || ''
  })));
  const kernelBadge = document.getElementById('kernel-status-badge');
  if (kernelBadge) {
    const isRunning = latestData.runtime?.running;
    const isInstalled = latestData.kernel?.installed;
    if (isRunning) {
      kernelBadge.textContent = '运行中';
      kernelBadge.className = 'editor-status is-saved';
    } else if (isInstalled) {
      kernelBadge.textContent = '未运行';
      kernelBadge.className = 'editor-status is-invalid';
    } else {
      kernelBadge.textContent = '未下载';
      kernelBadge.className = 'editor-status is-idle';
    }
  }
  renderKeyValue(forms.kernel, chineseLabels({
    installed: latestData.kernel?.installed,
    binaryPath: latestData.kernel?.binaryPath,
    installedVersion: latestData.kernel?.releaseInfo?.version || latestData.kernel?.releaseInfo?.tag_name || '',
    plannedVersion: latestData.plannedKernel?.version || '',
    plannedAsset: latestData.plannedKernel?.assetName || ''
  }));
  renderKeyValue(forms.subscription, chineseLabels(buildSubscriptionSummary(latestData.subscription)));
  if (forms.generated) renderKeyValue(forms.generated, buildGeneratedSummary(latestData.generated));
  renderLogTimeline(forms.logs, latestData.logs?.logs || []);
  renderArchitectureSelector();
  renderKernelVersionOptions();
  renderRouteFinalOptions();
  renderDnsPresetUi();
  if ((!formTouched && !isFormInteracting) || currentView !== 'form') {
    renderSubscriptionUrls();
    renderSocksServices();
  }
}

function renderArchitectureSelector() {
  const detected = latestData.architecture?.assetSuffix;
  if (detected && !kernelArchManuallySelected) {
    selectedKernelArch = detected;
  }
  kernelArchSelect.value = selectedKernelArch || detected || 'windows-amd64';
}

function renderKernelVersionOptions() {
  const releases = latestData.releaseList || [];
  const selectedVersion = selectedKernelVersion || latestData.plannedKernel?.version || '';
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
  selectedKernelVersion = kernelVersionSelect.value;

  kernelVersionSelect.disabled = false;
  kernelSelectVersionButton.disabled = false;
}

function renderRouteFinalOptions() {
  const selectedTag = latestData.config?.routing?.routeFinal || fields.routeFinal.value || 'proxy';
  fields.routeFinal.innerHTML = buildOutboundOptionsHtml(selectedTag);
  fields.routeFinal.value = selectedTag;
}

function renderDnsPresetUi() {
  const preset = fields.dnsRemotePreset.value || 'cloudflare';
  const custom = preset === 'custom';
  dnsRemoteUrlWrap.classList.toggle('is-hidden', !custom);
  fields.dnsRemoteUrl.disabled = !custom;

  const bootstrapPreset = fields.dnsBootstrapPreset.value || '1.1.1.1';
  const bootstrapCustom = bootstrapPreset === 'custom';
  dnsBootstrapWrap.classList.toggle('is-hidden', !bootstrapCustom);
  fields.dnsBootstrap.disabled = !bootstrapCustom;
}

function renderSubscriptionUrls() {
  subscriptionUrlsEl.innerHTML = '';
  if (!formSubscriptionUrls.length) {
    subscriptionUrlsEl.innerHTML = '<div class="timeline-item"><div class="title">暂无订阅地址</div></div>';
    return;
  }

  for (const [index, item] of formSubscriptionUrls.entries()) {
    const block = document.createElement('div');
    block.className = 'timeline-item';
    block.innerHTML = `
      <div class="title">订阅地址 ${index + 1}</div>
      <div class="form-grid">
        <label>
          <span>URL</span>
          <input data-subscription-index="${index}" data-subscription-field="url" value="${escapeHtmlAttr(item.url || '')}" />
        </label>
      </div>
      <div class="section-heading-actions">
        ${formSubscriptionUrls.length > 1 ? `<button type="button" data-remove-subscription="${index}">删除</button>` : ''}
      </div>
    `;
    subscriptionUrlsEl.appendChild(block);
  }
}

function renderSocksServices() {
  const count = formPorts.length;
  if (socksCountEl) socksCountEl.textContent = `${count} 个服务`;
  if (!socksServicesEl) return;
  socksServicesEl.innerHTML = '';

  for (const [index, item] of formPorts.entries()) {
    const block = document.createElement('div');
    block.className = 'timeline-item';
    block.innerHTML = `
      <div class="title">SOCKS5 服务 ${index + 1}</div>
      <div class="form-grid">
        <label><span>tag</span><input data-port-index="${index}" data-port-field="tag" value="${escapeHtmlAttr(item.tag || '')}" /></label>
        <label><span>监听地址</span><input data-port-index="${index}" data-port-field="listen" value="${escapeHtmlAttr(item.listen || '127.0.0.1')}" /></label>
        <label><span>端口</span><input data-port-index="${index}" data-port-field="port" type="number" min="1" step="1" value="${escapeHtmlAttr(item.port || '')}" /></label>
        <label><span>目标出口</span><select data-port-index="${index}" data-port-field="target">${buildOutboundOptionsHtml(item.target || 'proxy')}</select></label>
      </div>
      <div class="section-heading-actions">
        <button type="button" data-suggest-port="${index}">推荐端口</button>
        ${formPorts.length > 1 ? `<button type="button" data-remove-port="${index}">删除</button>` : ''}
      </div>
    `;
    socksServicesEl.appendChild(block);
  }

  const actions = document.createElement('div');
  actions.className = 'section-heading-actions';
  actions.innerHTML = '<button type="button" id="add-socks-service">+ 添加 SOCKS5 服务</button>';
  socksServicesEl.appendChild(actions);
}

function buildOutboundOptionsHtml(selectedTag) {
  const outbounds = latestData.availableOutbounds?.length
    ? latestData.availableOutbounds
    : [{ tag: 'direct', label: 'direct', type: 'direct', source: 'builtin' }];

  return outbounds
    .map((optionInfo) => (
      `<option value="${escapeHtmlAttr(optionInfo.tag)}" ${optionInfo.tag === selectedTag ? 'selected' : ''}>${escapeHtml(optionInfo.label || optionInfo.tag)}</option>`
    ))
    .join('');
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
  if (!text) return {};
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
  setStatus(`下载内核中 [${stage}] ${message}，${percent}${threads}`, 'loading');
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
  const saved = latestData.config || safeParseJson(lastSavedConfigText) || {};
  if (deepEqual(validation.value, saved)) {
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

function safeParseJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i += 1) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!deepEqual(a[aKeys[i]], b[bKeys[i]])) return false;
    }
    return true;
  }
  return a === b;
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

    next.subscription.urls = formSubscriptionUrls.map((item) => item.url.trim()).filter(Boolean);
    next.subscription.url = next.subscription.urls[0] || '';
    next.subscription.format = next.subscription.format || 'raw';
    next.app.host = fields.appHost.value.trim();
    next.app.port = Number(fields.appPort.value || 0);
    next.app.singBoxBinary = fields.appBinary.value.trim();
    next.app.logLevel = fields.appLogLevel.value;
    next.app.autoStart = fields.appAutoStart.value === 'true';
    next.app.autoConfigureOnSubscription = fields.appAutoConfigureSubscription.value === 'true';
    next.dns.strategy = fields.dnsStrategy.value;
    next.dns.remotePreset = fields.dnsRemotePreset.value;
    next.dns.remoteUrl = fields.dnsRemotePreset.value === 'custom'
      ? fields.dnsRemoteUrl.value.trim()
      : DNS_PRESET_URLS[fields.dnsRemotePreset.value] || DNS_PRESET_URLS.cloudflare;
    next.dns.bootstrapServer = fields.dnsBootstrapPreset.value === 'custom'
      ? fields.dnsBootstrap.value.trim()
      : fields.dnsBootstrapPreset.value;
    next.routing.routeFinal = fields.routeFinal.value || next.routing.routeFinal || 'proxy';

    next.ports = formPorts.map((item, index) => ({
      tag: item.tag?.trim() || `socks-${index + 1}`,
      listen: item.listen?.trim() || '127.0.0.1',
      port: Number(item.port || 0),
      target: item.target || next.routing.routeFinal || 'proxy',
      sniff: true
    }));

    if (validateRequired) {
      if (!next.app.host) throw new Error('Web UI 监听地址不能为空');
      if (!Number.isInteger(next.app.port) || next.app.port <= 0) throw new Error('Web UI 端口无效');
      if (!next.app.singBoxBinary) throw new Error('sing-box 二进制路径不能为空');
      if (!next.routing.routeFinal) throw new Error('默认路由出口不能为空');
      if (!next.ports.length) throw new Error('至少需要一个 SOCKS5 服务');
      if (!next.dns.remoteUrl) throw new Error('DoH 地址不能为空');

      const seenSubUrls = new Set();
      for (const url of next.subscription.urls) {
        if (seenSubUrls.has(url)) throw new Error(`订阅地址重复：${url}`);
        seenSubUrls.add(url);
      }

      const seenTags = new Set();
      const seenPorts = new Set();
      for (const portItem of next.ports) {
        if (!portItem.tag) throw new Error('SOCKS5 服务 tag 不能为空');
        if (seenTags.has(portItem.tag)) throw new Error(`SOCKS5 服务 tag 重复：${portItem.tag}`);
        seenTags.add(portItem.tag);

        if (!portItem.listen) throw new Error(`SOCKS5 服务 ${portItem.tag} 监听地址不能为空`);
        if (!Number.isInteger(portItem.port) || portItem.port <= 0) throw new Error(`SOCKS5 服务 ${portItem.tag} 端口无效`);
        if (seenPorts.has(`${portItem.listen}:${portItem.port}`)) {
          throw new Error(`SOCKS5 服务监听重复：${portItem.listen}:${portItem.port}`);
        }
        seenPorts.add(`${portItem.listen}:${portItem.port}`);

        if (!portItem.target) throw new Error(`SOCKS5 服务 ${portItem.tag} 目标出口不能为空`);
      }
    }

    return { ok: true, value: next, text: JSON.stringify(next, null, 2) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function fillForm(config) {
  const urls = Array.isArray(config.subscription?.urls) && config.subscription.urls.length
    ? config.subscription.urls
    : (config.subscription?.url ? [config.subscription.url] : ['']);

  formSubscriptionUrls = urls.map((url) => ({ url }));
  fields.appHost.value = config.app?.host || '0.0.0.0';
  fields.appPort.value = config.app?.port || 18080;
  fields.appBinary.value = config.app?.singBoxBinary || '';
  fields.appLogLevel.value = config.app?.logLevel || 'info';
  fields.appAutoStart.value = config.app?.autoStart ? 'true' : 'false';
  fields.appAutoConfigureSubscription.value = config.app?.autoConfigureOnSubscription ? 'true' : 'false';
  fields.dnsStrategy.value = config.dns?.strategy || 'prefer_ipv4';
  fields.dnsRemotePreset.value = config.dns?.remotePreset || inferDnsPreset(config.dns?.remoteUrl);
  fields.dnsRemoteUrl.value = config.dns?.remoteUrl || DNS_PRESET_URLS.cloudflare;
  fields.dnsBootstrapPreset.value = inferBootstrapPreset(config.dns?.bootstrapServer);
  fields.dnsBootstrap.value = config.dns?.bootstrapServer || '1.1.1.1';
  formPorts = normalizePorts(config.ports || []);
  renderRouteFinalOptions();
  fields.routeFinal.value = config.routing?.routeFinal || 'proxy';
  renderDnsPresetUi();
}

function normalizePorts(ports) {
  if (!Array.isArray(ports) || !ports.length) {
    return [createDefaultPort()];
  }

  return ports.map((item, index) => ({
    tag: item.tag || `socks-${index + 1}`,
    listen: item.listen || '127.0.0.1',
    port: item.port || '',
    target: item.target || 'proxy',
    sniff: true
  }));
}

function createDefaultPort() {
  return {
    tag: `socks-${formPorts.length + 1 || 1}`,
    listen: '127.0.0.1',
    port: '',
    target: fields.routeFinal?.value || latestData.config?.routing?.routeFinal || 'proxy',
    sniff: true
  };
}

async function resolveNextPort(host, start, exclude = []) {
  const data = await post('/api/ports/next', { host, start, exclude });
  return Number(data.port || start);
}

async function assignMissingSuggestedPorts() {
  const host = '127.0.0.1';
  const used = new Set(
    formPorts
      .map((item) => Number(item.port))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  let changed = false;
  for (let index = 0; index < formPorts.length; index += 1) {
    if (Number(formPorts[index].port) > 0) continue;
    const start = index === 0
      ? Number(fields.appPort.value || 18080) + 1
      : Number(formPorts[index - 1].port || 0) + 1;
    const nextPort = await resolveNextPort(host, start, [...used]);
    formPorts[index].port = nextPort;
    used.add(nextPort);
    changed = true;
  }

  return changed;
}

async function autoConfigureSocksServicesFromOutbounds() {
  const outbounds = (latestData.availableOutbounds || [])
    .filter((item) => item && item.tag && !['proxy', 'auto', 'block', 'direct'].includes(item.tag));
  if (!outbounds.length) {
    throw new Error('当前没有可用节点可用于配置 SOCKS5 服务');
  }

  const host = '127.0.0.1';
  const used = new Set();
  const appPort = Number(fields.appPort.value || latestData.config?.app?.port || 18080);
  let nextStart = appPort + 1;
  const generated = [];

  for (const item of outbounds) {
    const safeTag = String(item.tag).replace(/[^a-zA-Z0-9_-]/g, '-');
    const port = await resolveNextPort(host, nextStart, [...used]);
    used.add(port);
    nextStart = port + 1;
    generated.push({
      tag: `socks-${safeTag}`,
      listen: host,
      port,
      target: item.tag,
      sniff: true
    });
  }

  formPorts = generated;
  renderSocksServices();
  formTouched = true;
  updateEditorState();
}

function createDefaultSubscriptionUrl() {
  return { url: '' };
}

function inferDnsPreset(remoteUrl = '') {
  if (remoteUrl === DNS_PRESET_URLS.google) return 'google';
  if (remoteUrl === DNS_PRESET_URLS.cloudflare) return 'cloudflare';
  return 'custom';
}

function inferBootstrapPreset(value = '') {
  return DNS_BOOTSTRAP_PRESETS.includes(value) ? value : 'custom';
}

function markFormInteraction(active) {
  isFormInteracting = active;
}

function isInteractiveFormElement(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement;
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
    renderSubscriptionUrls();
    renderSocksServices();
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
    nodeCount: nodes.length,
    warningCount: (subscription?.warnings || []).length,
    firstNode: nodes[0]?.tag || '',
    warnings: (subscription?.warnings || []).join(' | ')
  };
}

const LABEL_MAP = {
  stored: '已检测',
  platform: '系统平台',
  arch: '架构',
  executableName: '可执行文件名',
  assetSuffix: '资产后缀',
  plannedVersion: '计划版本',
  installed: '已安装',
  binaryPath: '二进制路径',
  installedVersion: '已安装版本',
  plannedAsset: '计划资产',
  updatedAt: '更新时间',
  nodeCount: '节点数量',
  warningCount: '警告数量',
  firstNode: '首选节点',
  warnings: '警告信息',
  rawLength: '原始长度'
};

function chineseLabels(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[LABEL_MAP[key] || key] = value;
  }
  return result;
}

const toastEl = document.getElementById('toast-container');
let toastTimer = null;

function showToast(message, success) {
  if (!toastEl) return;
  clearTimeout(toastTimer);
  toastEl.innerHTML = `${success
    ? '<span style="color:#10b981;font-size:18px">&#10003;</span>'
    : '<span style="color:#ef4444;font-size:18px">&#10007;</span>'
  } ${message}`;
  toastEl.style.display = 'flex';
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2500);
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

function escapeHtmlAttr(value) {
  return escapeHtml(value);
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
  // Real auto-detection from current runtime platform.
  kernelArchManuallySelected = false;
  await post('/api/kernel/architecture', {});
  await api('/api/kernel/releases');
  selectedKernelVersion = '';
}

async function applySelectedArchitectureAndLoadReleases() {
  await post('/api/kernel/architecture', { assetSuffix: selectedKernelArch || kernelArchSelect.value });
  await api('/api/kernel/releases');
}

async function startDownloadFlow() {
  downloadInFlight = true;
  setBusy(false);
  try {
    await applySelectedArchitectureAndLoadReleases();
    if (kernelVersionSelect.value) {
      await post('/api/kernel/plan', {
        version: kernelVersionSelect.value,
        assetSuffix: selectedKernelArch || kernelArchSelect.value
      });
    }
    await post('/api/kernel/download');
    await load();
    syncStatusBarWithDownload(latestData.download);
  } finally {
    downloadInFlight = false;
    setBusy(false);
  }
}

async function refreshAfterNodesUpdate() {
  const current = localStorage.getItem(NODES_UPDATED_KEY) || '';
  if (current && current !== lastKnownNodesUpdatedAt) {
    lastKnownNodesUpdatedAt = current;
    await load();
    setStatus('节点列表已同步到主页', 'success');
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
  renderSubscriptionUrls();
  renderSocksServices();
  updateEditorState();
  setStatus('配置已保存并自动更新 sing-box 配置', 'success');
});

document.getElementById('refresh-sub').onclick = () => action('更新订阅', async () => {
  await post('/api/subscription/refresh');
  await load();
  if (fields.appAutoConfigureSubscription.value === 'true') {
    await autoConfigureSocksServicesFromOutbounds();
    const parsed = parseFormConfig(true);
    if (!parsed.ok) throw new Error(parsed.error);
    editor.value = parsed.text;
    await post('/api/config', parsed.value);
    lastSavedConfigText = parsed.text;
    formTouched = false;
    fillForm(parsed.value);
    renderSubscriptionUrls();
    renderSocksServices();
    updateEditorState();
  }
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
  await applySelectedArchitectureAndLoadReleases();
  if (!kernelVersionSelect.value) throw new Error('请先选择一个内核版本');
  selectedKernelVersion = kernelVersionSelect.value;
  kernelArchManuallySelected = false;
  await post('/api/kernel/plan', {
    version: kernelVersionSelect.value,
    assetSuffix: selectedKernelArch || kernelArchSelect.value
  });
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

addSubscriptionUrlButton?.addEventListener('click', () => {
  formSubscriptionUrls.push(createDefaultSubscriptionUrl());
  renderSubscriptionUrls();
  formTouched = true;
  updateEditorState();
});

editSocksServiceButton?.addEventListener('click', () => {
  window.location.href = '/socks5.html';
});

exportSocksButton?.addEventListener('click', () => {
  const lines = formPorts
    .filter(p => p.listen && p.port)
    .map(p => `socks5://${p.listen}:${p.port}`);
  const json = JSON.stringify(lines, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'socks5.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

copySocksButton?.addEventListener('click', () => {
  const text = formPorts
    .filter(p => p.listen && p.port)
    .map(p => `socks5://${p.listen}:${p.port}`)
    .join('\n');
  if (!text) { showToast('没有可复制的服务', false); return; }
  navigator.clipboard.writeText(text).then(
    () => showToast('复制成功', true),
    () => showToast('复制失败', false)
  );
});

autoConfigureSocksButton?.addEventListener('click', () => action('一键配置 SOCKS5 服务', async () => {
  await load();
  await autoConfigureSocksServicesFromOutbounds();
  const parsed = parseFormConfig(true);
  if (!parsed.ok) throw new Error(parsed.error);
  editor.value = parsed.text;
  await post('/api/config', parsed.value);
  lastSavedConfigText = parsed.text;
  formTouched = false;
  fillForm(parsed.value);
  renderSubscriptionUrls();
  renderSocksServices();
  updateEditorState();
}));
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

  if (target.dataset.portIndex) {
    const index = Number(target.dataset.portIndex);
    const field = target.dataset.portField;
    formPorts[index][field] = target.value;
    formTouched = true;
    markFormInteraction(true);
    updateEditorState();
  }

  if (target.dataset.subscriptionIndex) {
    const index = Number(target.dataset.subscriptionIndex);
    formSubscriptionUrls[index].url = target.value;
    formTouched = true;
    markFormInteraction(true);
    updateEditorState();
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

  if (target.dataset.portIndex) {
    const index = Number(target.dataset.portIndex);
    const field = target.dataset.portField;
    formPorts[index][field] = target.value;
    formTouched = true;
    markFormInteraction(true);
    updateEditorState();
  }
});

document.addEventListener('focusin', (event) => {
  if (isInteractiveFormElement(event.target) && formView.contains(event.target)) {
    markFormInteraction(true);
  }
});

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (!(active instanceof Element) || !formView.contains(active) || !isInteractiveFormElement(active)) {
      markFormInteraction(false);
    }
  }, 0);
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.removePort) {
    const index = Number(target.dataset.removePort);
    if (formPorts.length > 1) {
      formPorts.splice(index, 1);
      renderSocksServices();
      formTouched = true;
      updateEditorState();
    }
  }

  if (target.id === 'add-socks-service') {
    formPorts.push(createDefaultPort());
    renderSocksServices();
    formTouched = true;
    updateEditorState();
  }

  if (target.dataset.suggestPort) {
    const index = Number(target.dataset.suggestPort);
    const host = formPorts[index]?.listen || '127.0.0.1';
    const used = formPorts
      .map((item, i) => (i === index ? 0 : Number(item.port)))
      .filter((p) => Number.isInteger(p) && p > 0);
    const start = Number(formPorts[index]?.port || 0) > 0
      ? Number(formPorts[index].port) + 1
      : Number(fields.appPort.value || 18080) + 1;
    resolveNextPort(host, start, used).then((port) => {
      formPorts[index].port = port;
      renderSocksServices();
      formTouched = true;
      updateEditorState();
    }).catch(() => {});
  }

  if (target.dataset.removeSubscription) {
    const index = Number(target.dataset.removeSubscription);
    if (formSubscriptionUrls.length > 1) {
      formSubscriptionUrls.splice(index, 1);
      renderSubscriptionUrls();
      formTouched = true;
      updateEditorState();
    }
  }
});

kernelArchSelect.addEventListener('change', () => {
  kernelArchManuallySelected = true;
  selectedKernelArch = kernelArchSelect.value;
  const [os, archName] = kernelArchSelect.value.split('-');
  latestData.architecture = {
    ...(latestData.architecture || {}),
    os,
    archName,
    assetSuffix: kernelArchSelect.value
  };
});

kernelVersionSelect.addEventListener('change', () => {
  selectedKernelVersion = kernelVersionSelect.value;
});

fields.dnsRemotePreset.addEventListener('change', () => {
  if (fields.dnsRemotePreset.value !== 'custom') {
    fields.dnsRemoteUrl.value = DNS_PRESET_URLS[fields.dnsRemotePreset.value] || DNS_PRESET_URLS.cloudflare;
  }
  renderDnsPresetUi();
  formTouched = true;
  updateEditorState();
});

fields.dnsBootstrapPreset.addEventListener('change', () => {
  if (fields.dnsBootstrapPreset.value !== 'custom') {
    fields.dnsBootstrap.value = fields.dnsBootstrapPreset.value;
  }
  renderDnsPresetUi();
  formTouched = true;
  updateEditorState();
});

fields.appPort?.addEventListener('change', async () => {
  if (!formPorts.length) return;
  const currentAppPort = Number(fields.appPort.value || 18080);
  const firstPort = Number(formPorts[0]?.port || 0);
  if (!firstPort || firstPort <= currentAppPort) {
    formPorts[0].port = '';
    const changed = await assignMissingSuggestedPorts();
    if (changed) {
      renderSocksServices();
    }
    formTouched = true;
    updateEditorState();
  }
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
    markFormInteraction(true);
    updateEditorState();
  });
  element?.addEventListener('change', () => {
    formTouched = true;
    markFormInteraction(true);
    updateEditorState();
  });
}

window.addEventListener('storage', (event) => {
  if (event.key === NODES_UPDATED_KEY) {
    refreshAfterNodesUpdate().catch(() => {});
  }
});

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
  if (currentView === 'form' && (formTouched || isFormInteracting)) {
    refreshAfterNodesUpdate().catch(() => {});
    return;
  }

  Promise.all([load(), refreshAfterNodesUpdate()])
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

