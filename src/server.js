import http from 'node:http';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadSubscriptionState,
  loadArchitectureInfo,
  loadConfig,
  loadPlannedKernelInfo,
  loadReleaseListInfo,
  saveArchitectureInfo,
  savePlannedKernelInfo,
  saveReleaseListInfo,
  saveSubscriptionState,
  saveConfig,
  writeGeneratedConfig,
  publicDir,
  generatedConfigPath
} from './lib/storage.js';
import { fetchSubscription } from './lib/subscription.js';
import { buildSingBoxConfig } from './lib/singbox-config.js';
import { SingBoxManager } from './lib/singbox-manager.js';
import {
  detectPlatform,
  downloadSingBoxRelease,
  getLatestReleaseInfo,
  listReleaseInfos,
  readInstalledKernelInfo
} from './lib/singbox-release.js';

const manager = new SingBoxManager();
let appConfig = await loadConfig();
let subscriptionState = (await loadSubscriptionState()) || {
  raw: '',
  nodes: [],
  warnings: [],
  updatedAt: null
};
let kernelState = await readInstalledKernelInfo();
let architectureState = (await loadArchitectureInfo()) || null;
let plannedKernelInfo = await loadPlannedKernelInfo();
let releaseListState = (await loadReleaseListInfo()) || [];
let downloadState = {
  active: false,
  steps: [],
  progress: null,
  updatedAt: null
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      return empty(res, 204);
    }

    if (url.pathname === '/api/config') {
      if (req.method === 'GET') {
        return ok(res, {
          config: appConfig,
          subscription: subscriptionState,
          availableOutbounds: collectAvailableOutbounds(appConfig, subscriptionState),
          runtime: manager.getStatus(),
          kernel: kernelState,
          architecture: architectureState,
          plannedKernel: plannedKernelInfo,
          releaseList: releaseListState,
          download: downloadState
        });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        appConfig = body;
        await saveConfig(appConfig);
        return ok(res, { ok: true });
      }
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    if (url.pathname === '/api/subscription/refresh') {
      if (req.method === 'POST') {
        subscriptionState = await refreshSubscription();
        return ok(res, subscriptionState);
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/nodes') {
      if (req.method === 'GET') {
        return ok(res, {
          subscriptionNodes: [{ tag: 'direct', type: 'direct', source: 'builtin' }, ...(subscriptionState.nodes || [])],
          manualNodes: appConfig.nodeRegistry?.manualNodes || [],
          groups: appConfig.nodeRegistry?.groups || [],
          availableOutbounds: collectAvailableOutbounds(appConfig, subscriptionState)
        });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        appConfig.nodeRegistry ||= { manualNodes: [], groups: [] };
        appConfig.nodeRegistry.manualNodes = Array.isArray(body.manualNodes) ? body.manualNodes : [];
        appConfig.nodeRegistry.groups = Array.isArray(body.groups) ? body.groups : [];
        await saveConfig(appConfig);
        return ok(res, {
          ok: true,
          manualNodes: appConfig.nodeRegistry.manualNodes,
          groups: appConfig.nodeRegistry.groups,
          availableOutbounds: collectAvailableOutbounds(appConfig, subscriptionState)
        });
      }
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    if (url.pathname === '/api/kernel/architecture') {
      if (req.method === 'GET') {
        return ok(res, {
          architecture: architectureState,
          stored: Boolean(architectureState),
          plannedKernel: plannedKernelInfo
        });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        architectureState = await ensureArchitectureState(body.assetSuffix);
        plannedKernelInfo = await getLatestReleaseInfo(architectureState);
        await savePlannedKernelInfo(plannedKernelInfo);
        kernelState = await readInstalledKernelInfo();
        return ok(res, {
          architecture: architectureState,
          stored: true,
          plannedKernel: plannedKernelInfo,
          kernel: kernelState
        });
      }
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    if (url.pathname === '/api/kernel/latest') {
      if (req.method === 'GET') {
        const platformInfo = architectureState || await ensureArchitectureState();
        plannedKernelInfo = await getLatestReleaseInfo(platformInfo);
        await savePlannedKernelInfo(plannedKernelInfo);
        return ok(res, plannedKernelInfo);
      }
      return methodNotAllowed(res, ['GET']);
    }

    if (url.pathname === '/api/kernel/releases') {
      if (req.method === 'GET') {
        releaseListState = await ensureReleaseList(false);
        return ok(res, releaseListState);
      }
      return methodNotAllowed(res, ['GET']);
    }

    if (url.pathname === '/api/kernel/releases/update') {
      if (req.method === 'POST') {
        releaseListState = await ensureReleaseList(true);
        const installedVersion = kernelState?.releaseInfo?.version || kernelState?.releaseInfo?.tag_name || null;
        const nextStable = pickNextStableRelease(releaseListState, installedVersion);
        if (nextStable) {
          plannedKernelInfo = nextStable;
          await savePlannedKernelInfo(plannedKernelInfo);
        }
        return ok(res, {
          releaseList: releaseListState,
          plannedKernel: plannedKernelInfo
        });
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/kernel/plan') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        releaseListState = await ensureReleaseList(false);
        const selected = releaseListState.find((item) => item.version === body.version);
        if (!selected) {
          return fail(res, 404, 'Requested kernel version not found');
        }
        plannedKernelInfo = selected;
        await savePlannedKernelInfo(plannedKernelInfo);
        return ok(res, plannedKernelInfo);
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/kernel/status') {
      if (req.method === 'GET') {
        kernelState = await readInstalledKernelInfo();
        return ok(res, { ...kernelState, plannedKernelInfo, releaseList: releaseListState });
      }
      return methodNotAllowed(res, ['GET']);
    }

    if (url.pathname === '/api/kernel/download') {
      if (req.method === 'GET') {
        return ok(res, downloadState);
      }
      if (req.method === 'POST') {
        if (downloadState.active) {
          return fail(res, 409, 'A kernel download is already in progress');
        }
        architectureState = await ensureArchitectureState();
        if (!plannedKernelInfo) {
          plannedKernelInfo = await getLatestReleaseInfo(architectureState);
          await savePlannedKernelInfo(plannedKernelInfo);
        }

        resetDownloadState();
        downloadState.active = true;
        pushDownloadStep({ stage: 'detect', message: 'Architecture confirmed', details: architectureState });

        try {
          const result = await downloadSingBoxRelease({
            release: plannedKernelInfo,
            onProgress: (entry) => pushDownloadStep(entry)
          });
          appConfig.app.singBoxBinary = result.binaryPath;
          await saveConfig(appConfig);
          kernelState = await readInstalledKernelInfo();
          downloadState.active = false;
          downloadState.progress = { percent: 100, stage: 'done', message: 'Kernel installation completed' };
          downloadState.updatedAt = new Date().toISOString();
          return ok(res, { result, kernel: kernelState, config: appConfig.app, download: downloadState });
        } catch (error) {
          downloadState.active = false;
          downloadState.progress = { percent: null, stage: 'error', message: error.message };
          downloadState.updatedAt = new Date().toISOString();
          pushDownloadStep({ stage: 'error', message: error.message, details: { code: error.code } });
          throw error;
        }
      }
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    if (url.pathname === '/api/runtime/logs') {
      if (req.method === 'GET') {
        return ok(res, manager.getStatus());
      }
      return methodNotAllowed(res, ['GET']);
    }

    if (url.pathname === '/api/runtime/generate') {
      if (req.method === 'POST') {
        ensureNodesLoaded();
        const generated = buildSingBoxConfig(appConfig, subscriptionState);
        await writeGeneratedConfig(generated);
        return ok(res, { ok: true, path: generatedConfigPath, generated });
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/runtime/start') {
      if (req.method === 'POST') {
        ensureNodesLoaded();
        const generated = buildSingBoxConfig(appConfig, subscriptionState);
        await writeGeneratedConfig(generated);
        await manager.start(appConfig.app.singBoxBinary, generatedConfigPath);
        return ok(res, manager.getStatus());
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/runtime/stop') {
      if (req.method === 'POST') {
        await manager.stop();
        return ok(res, manager.getStatus());
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/runtime/generated') {
      if (req.method === 'GET') {
        const content = await readFile(generatedConfigPath, 'utf8').catch(() => '{}');
        return ok(res, JSON.parse(content));
      }
      return methodNotAllowed(res, ['GET']);
    }

    if (url.pathname.startsWith('/api/')) {
      return fail(res, 404, 'API route not found', { path: url.pathname, method: req.method });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return methodNotAllowed(res, ['GET', 'HEAD']);
    }

    return serveStatic(url.pathname, req.method, res);
  } catch (error) {
    return fail(res, 500, error.message, { code: error.code, stack: error.stack });
  }
});

server.listen(appConfig.app.port, appConfig.app.host, async () => {
  console.log(`Web UI listening on http://${appConfig.app.host}:${appConfig.app.port}`);
  if (appConfig.app.autoStart) {
    try {
      subscriptionState = await refreshSubscription();
      const generated = buildSingBoxConfig(appConfig, subscriptionState);
      await writeGeneratedConfig(generated);
      await manager.start(appConfig.app.singBoxBinary, generatedConfigPath);
    } catch (error) {
      manager.pushLog(`Auto start failed: ${error.message}`);
    }
  }
});

async function refreshSubscription() {
  const result = await fetchSubscription(appConfig.subscription);
  const nextState = { ...result, updatedAt: new Date().toISOString() };
  await saveSubscriptionState(nextState);
  return nextState;
}

async function ensureArchitectureState(assetSuffix) {
  if (!assetSuffix && architectureState) {
    return architectureState;
  }
  architectureState = assetSuffix ? overrideArchitecture(assetSuffix) : detectPlatform();
  await saveArchitectureInfo(architectureState);
  return architectureState;
}

async function ensureReleaseList(forceRefresh) {
  if (!forceRefresh && releaseListState.length) {
    return releaseListState;
  }
  const platformInfo = architectureState || await ensureArchitectureState();
  releaseListState = await listReleaseInfos(platformInfo);
  await saveReleaseListInfo(releaseListState);
  return releaseListState;
}

function pickNextStableRelease(releases, currentVersion) {
  if (!releases.length) return null;
  const stableReleases = releases.filter((item) => !String(item.version).includes('-'));
  if (!currentVersion) return stableReleases[0] || releases[0];
  const currentNumeric = normalizeVersion(currentVersion);
  return stableReleases.find((item) => normalizeVersion(item.version) > currentNumeric) || stableReleases[0] || releases[0];
}

function normalizeVersion(version) {
  return String(version).replace(/^v/, '').split('.').map((part) => part.padStart(4, '0')).join('');
}

function overrideArchitecture(assetSuffix) {
  const [os, archName] = String(assetSuffix).split('-');
  const platformMap = { windows: 'win32', linux: 'linux', darwin: 'darwin' };
  const archMap = { amd64: 'x64', arm64: 'arm64' };
  if (!platformMap[os] || !archMap[archName]) {
    throw new Error(`Unsupported architecture override: ${assetSuffix}`);
  }
  return {
    detectedAt: new Date().toISOString(),
    platform: platformMap[os],
    arch: archMap[archName],
    os,
    archName,
    assetSuffix,
    executableName: os === 'windows' ? 'sing-box.exe' : 'sing-box'
  };
}

function ensureNodesLoaded() {
  const subscriptionNodes = subscriptionState.nodes || [];
  const manualNodes = appConfig.nodeRegistry?.manualNodes || [];
  if (!subscriptionNodes.length && !manualNodes.length) {
    throw new Error('没有可用节点，请先更新订阅或添加手动节点。');
  }
}

function collectAvailableOutbounds(config, subscription) {
  const subscriptionNodes = subscription?.nodes || [];
  const manualNodes = config?.nodeRegistry?.manualNodes || [];
  const groups = config?.nodeRegistry?.groups || [];
  const builtins = [
    { tag: 'proxy', type: 'selector', source: 'builtin', label: 'proxy（自动选择器）' },
    { tag: 'auto', type: 'urltest', source: 'builtin', label: 'auto（延迟测试）' },
    { tag: 'direct', type: 'direct', source: 'builtin', label: 'direct' },
    { tag: 'block', type: 'block', source: 'builtin', label: 'block' }
  ];

  return [
    ...builtins,
    ...subscriptionNodes.map((node) => ({
      tag: node.tag,
      type: node.type,
      source: 'subscription',
      label: `${node.tag}（${node.type} / 订阅）`
    })),
    ...manualNodes.map((node) => ({
      tag: node.tag,
      type: node.type,
      source: 'manual',
      label: `${node.tag}（${node.type} / 手动）`
    })),
    ...groups.map((group) => ({
      tag: group.tag,
      type: group.strategy,
      source: 'group',
      label: `${group.tag}（${group.strategy} / 节点组）`
    }))
  ];
}

function resetDownloadState() {
  downloadState = { active: false, steps: [], progress: null, updatedAt: null };
}

function pushDownloadStep(entry) {
  downloadState.steps.push(entry);
  if (downloadState.steps.length > 200) {
    downloadState.steps = downloadState.steps.slice(-200);
  }
  const percent = typeof entry.details?.percent === 'number' ? entry.details.percent : null;
  downloadState.progress = {
    percent,
    stage: entry.stage,
    message: entry.message,
    downloadedBytes: entry.details?.downloadedBytes ?? null,
    totalBytes: entry.details?.totalBytes ?? null,
    threads: entry.details?.threads ?? null
  };
  downloadState.updatedAt = entry.time;
}

async function serveStatic(pathname, method, res) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const relativePath = requestedPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relativePath);
  const relativeCheck = path.relative(publicDir, filePath);

  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    res.writeHead(403, textHeaders());
    res.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, baseHeaders(contentType(filePath)));
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      res.writeHead(404, textHeaders());
      res.end('Not Found');
      return;
    }
    throw error;
  }
}

function ok(res, payload) {
  res.writeHead(200, jsonHeaders());
  res.end(JSON.stringify(payload, null, 2));
}

function fail(res, status, message, details = {}) {
  res.writeHead(status, jsonHeaders());
  res.end(JSON.stringify({ error: { message, status, ...details } }, null, 2));
}

function methodNotAllowed(res, allow) {
  res.writeHead(405, { ...jsonHeaders(), Allow: allow.join(', ') });
  res.end(JSON.stringify({ error: { message: 'Method Not Allowed', status: 405, allow } }, null, 2));
}

function empty(res, status) {
  res.writeHead(status, baseHeaders());
  res.end();
}

function jsonHeaders() {
  return baseHeaders('application/json; charset=utf-8');
}

function textHeaders() {
  return baseHeaders('text/plain; charset=utf-8');
}

function baseHeaders(contentType = 'text/plain; charset=utf-8') {
  return {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
