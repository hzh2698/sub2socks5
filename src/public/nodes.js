const statusEl = document.getElementById('node-status');
const manualNodesEl = document.getElementById('manual-nodes');
const groupsEl = document.getElementById('groups');
const availableNodeListEl = document.getElementById('available-node-list');

let state = {
  subscriptionNodes: [],
  manualNodes: [],
  groups: [],
  availableOutbounds: []
};

async function load() {
  const response = await fetch('/api/nodes');
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || '加载节点失败');
  }
  state = data;
  render();
}

function render() {
  availableNodeListEl.textContent = JSON.stringify(state.availableOutbounds, null, 2);
  renderManualNodes();
  renderGroups();
}

function renderManualNodes() {
  manualNodesEl.innerHTML = '';
  if (!state.manualNodes.length) {
    manualNodesEl.innerHTML = '<div class="timeline-item"><div class="title">暂无手动节点</div></div>';
    return;
  }

  for (const [index, node] of state.manualNodes.entries()) {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
      <div class="title">手动节点 ${index + 1}</div>
      <div class="form-grid">
        <label><span>tag</span><input data-kind="manual" data-index="${index}" data-field="tag" value="${escapeHtmlAttr(node.tag || '')}" /></label>
        <label><span>type</span><input data-kind="manual" data-index="${index}" data-field="type" value="${escapeHtmlAttr(node.type || 'vless')}" /></label>
        <label><span>server</span><input data-kind="manual" data-index="${index}" data-field="server" value="${escapeHtmlAttr(node.server || '')}" /></label>
        <label><span>server_port</span><input data-kind="manual" data-index="${index}" data-field="server_port" type="number" value="${escapeHtmlAttr(String(node.server_port || 443))}" /></label>
        <label><span>uuid / username</span><input data-kind="manual" data-index="${index}" data-field="uuid" value="${escapeHtmlAttr(node.uuid || '')}" /></label>
        <label><span>password</span><input data-kind="manual" data-index="${index}" data-field="password" value="${escapeHtmlAttr(node.password || '')}" /></label>
      </div>
      <div class="section-heading-actions">
        <button type="button" data-remove-manual="${index}">删除</button>
      </div>
    `;
    manualNodesEl.appendChild(item);
  }
}

function renderGroups() {
  groupsEl.innerHTML = '';
  if (!state.groups.length) {
    groupsEl.innerHTML = '<div class="timeline-item"><div class="title">暂无节点组</div></div>';
    return;
  }

  const selectableNodes = state.availableOutbounds.filter((item) => item.tag !== 'proxy' && item.tag !== 'auto' && item.tag !== 'block');

  for (const [index, group] of state.groups.entries()) {
    const members = new Set(group.members || []);
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
      <div class="title">节点组 ${index + 1}</div>
      <div class="form-grid">
        <label><span>tag</span><input data-kind="group" data-index="${index}" data-field="tag" value="${escapeHtmlAttr(group.tag || '')}" /></label>
        <label>
          <span>策略</span>
          <select data-kind="group" data-index="${index}" data-field="strategy">
            <option value="urltest" ${group.strategy === 'urltest' ? 'selected' : ''}>urltest</option>
            <option value="fallback" ${group.strategy === 'fallback' ? 'selected' : ''}>fallback</option>
          </select>
        </label>
      </div>
      <div class="member-selector" data-group-members="${index}">
        ${selectableNodes.map((node) => `
          <label class="member-option">
            <input type="checkbox" data-group-member="${index}" value="${escapeHtmlAttr(node.tag)}" ${members.has(node.tag) ? 'checked' : ''} />
            <span>${escapeHtml(node.label || node.tag)}</span>
          </label>
        `).join('')}
      </div>
      <div class="section-heading-actions">
        <button type="button" data-remove-group="${index}">删除</button>
      </div>
    `;
    groupsEl.appendChild(item);
  }
}

function setStatus(message, kind = 'idle') {
  statusEl.textContent = message;
  statusEl.className = `status-bar is-${kind}`;
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

document.getElementById('back-home').addEventListener('click', () => {
  window.location.href = '/';
});

document.getElementById('add-manual-node').addEventListener('click', () => {
  state.manualNodes.push({ tag: '', type: 'vless', server: '', server_port: 443, uuid: '', password: '' });
  renderManualNodes();
});

document.getElementById('add-group').addEventListener('click', () => {
  state.groups.push({ tag: '', strategy: 'urltest', members: [] });
  renderGroups();
});

document.getElementById('save-nodes').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manualNodes: state.manualNodes,
        groups: state.groups
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || '保存失败');
    }
    setStatus('节点配置已保存', 'success');
    await load();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

  if (target.dataset.kind === 'manual') {
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    state.manualNodes[index][field] = field === 'server_port' ? Number(target.value || 0) : target.value;
  }

  if (target.dataset.kind === 'group') {
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    state.groups[index][field] = target.value;
  }

  if (target.dataset.groupMember) {
    const index = Number(target.dataset.groupMember);
    const members = new Set(state.groups[index].members || []);
    if (target.checked) members.add(target.value);
    else members.delete(target.value);
    state.groups[index].members = [...members];
  }
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.removeManual) {
    state.manualNodes.splice(Number(target.dataset.removeManual), 1);
    renderManualNodes();
  }
  if (target.dataset.removeGroup) {
    state.groups.splice(Number(target.dataset.removeGroup), 1);
    renderGroups();
  }
});

load().catch((error) => setStatus(error.message, 'error'));
