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
  pathExists,
  resolveManagedPath,
  publicDir,
  generatedConfigPath,
  subscriptionStatePath
} from './lib/storage.js';
import { fetchSubscription } from './lib/subscription.js';
import { parseManualNodeInput } from './lib/subscription.js';
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
let appConfig;
let subscriptionState;
let kernelState;
let architectureState;
let plannedKernelInfo;
let releaseListState;
let downloadState;
let fallbackTimer = null;

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
          subscription: buildSubscriptionSummaryPayload(subscriptionState),
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
        const generated = buildSingBoxConfig(appConfig, subscriptionState);
        await writeGeneratedConfig(generated);
        if (manager.getStatus().running) {
          await manager.start(resolveManagedPath(appConfig.app.singBoxBinary), generatedConfigPath);
          restartFallbackLoop();
        }
        restartFallbackLoop();
        return ok(res, { ok: true, generated, runtime: manager.getStatus() });
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
        const disabledSubscriptionTags = new Set(appConfig.nodeRegistry?.disabledSubscriptionTags || []);
        return ok(res, {
          subscriptionNodes: [
            { tag: 'direct', type: 'direct', source: 'builtin' },
            ...((subscriptionState.nodes || []).filter((node) => !disabledSubscriptionTags.has(node?.tag)))
          ],
          disabledSubscriptionTags: appConfig.nodeRegistry?.disabledSubscriptionTags || [],
          manualNodes: appConfig.nodeRegistry?.manualNodes || [],
          groups: appConfig.nodeRegistry?.groups || [],
          chains: appConfig.nodeRegistry?.chains || [],
          availableOutbounds: collectAvailableOutbounds(appConfig, subscriptionState),
          fallbackStates: appConfig.runtimeState?.fallbackGroups || {}
        });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        appConfig.nodeRegistry ||= { manualNodes: [], groups: [] };
        appConfig.nodeRegistry.manualNodes = Array.isArray(body.manualNodes) ? body.manualNodes : [];
        appConfig.nodeRegistry.groups = Array.isArray(body.groups)
          ? body.groups.map(normalizeGroupConfig)
          : [];
        appConfig.nodeRegistry.chains = Array.isArray(body.chains)
          ? body.chains.map(normalizeChainConfig)
          : [];
        appConfig.nodeRegistry.disabledSubscriptionTags = Array.isArray(body.disabledSubscriptionTags)
          ? body.disabledSubscriptionTags.map((item) => String(item || '').trim()).filter(Boolean)
          : (appConfig.nodeRegistry.disabledSubscriptionTags || []);
        await saveConfig(appConfig);
        restartFallbackLoop();
        return ok(res, {
          ok: true,
          manualNodes: appConfig.nodeRegistry.manualNodes,
          groups: appConfig.nodeRegistry.groups,
          chains: appConfig.nodeRegistry.chains,
          availableOutbounds: collectAvailableOutbounds(appConfig, subscriptionState)
        });
      }
      return methodNotAllowed(res, ['GET', 'POST']);
    }

    if (url.pathname === '/api/nodes/import') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        const result = parseManualNodeInput(body.raw || '');
        return ok(res, result);
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/nodes/check') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        const tags = Array.isArray(body?.tags)
          ? body.tags.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        if (!tags.length) {
          return fail(res, 400, 'Missing node tags for check');
        }
        const urlToTest = String(body?.url || 'https://www.gstatic.com/generate_204');
        const timeout = Number(body?.timeoutMs || 5000);
        const results = {};
        for (const tag of tags) {
          const chainTag = isChainTag(tag) ? tag : null;
          const resolvedTag = chainTag ? tag : resolveCheckTargetTag(tag);
          const result = chainTag
            ? await checkChainConnectivity(chainTag, urlToTest, timeout)
            : await measureOutboundDelay(resolvedTag, urlToTest, timeout);
          results[tag] = {
            ...result,
            checkedTag: resolvedTag
          };
        }
        return ok(res, {
          ok: true,
          url: urlToTest,
          timeoutMs: timeout,
          results
        });
      }
      return methodNotAllowed(res, ['POST']);
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
        await manager.start(resolveManagedPath(appConfig.app.singBoxBinary), generatedConfigPath);
        restartFallbackLoop();
        return ok(res, manager.getStatus());
      }
      return methodNotAllowed(res, ['POST']);
    }

    if (url.pathname === '/api/runtime/stop') {
      if (req.method === 'POST') {
        await manager.stop();
        stopFallbackLoop();
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

export async function startServer() {
  appConfig = await loadConfig();
  subscriptionState = (await loadSubscriptionState()) || {
    raw: '',
    nodes: [],
    warnings: [],
    updatedAt: null
  };
  kernelState = await readInstalledKernelInfo();
  architectureState = (await loadArchitectureInfo()) || null;
  plannedKernelInfo = await loadPlannedKernelInfo();
  releaseListState = (await loadReleaseListInfo()) || [];
  downloadState = {
    active: false,
    steps: [],
    progress: null,
    updatedAt: null
  };

  await initializePresetState();

  server.listen(appConfig.app.port, appConfig.app.host, async () => {
    console.log(`Web UI listening on http://${appConfig.app.host}:${appConfig.app.port}`);
    if (appConfig.app.autoStart) {
      try {
        subscriptionState = await refreshSubscription();
        const generated = buildSingBoxConfig(appConfig, subscriptionState);
        await writeGeneratedConfig(generated);
        await manager.start(resolveManagedPath(appConfig.app.singBoxBinary), generatedConfigPath);
        restartFallbackLoop();
      } catch (error) {
        manager.pushLog(`Auto start failed: ${error.message}`);
      }
    }
  });

  return server;
}

if (process.env.SUB2SOCKS5_SEA_BOOTSTRAP !== '1') {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function initializePresetState() {
  const runtimeExists = await pathExists(generatedConfigPath);
  const subscriptionExists = await pathExists(subscriptionStatePath);

  if (!subscriptionExists) {
    await saveSubscriptionState(subscriptionState);
  }

  if (!runtimeExists) {
    const generated = buildSingBoxConfig(appConfig, subscriptionState);
    await writeGeneratedConfig(generated);
  }
}

async function refreshSubscription() {
  const result = await fetchSubscription(appConfig.subscription);
  const nextState = {
    ...result,
    sources: Array.isArray(appConfig.subscription?.urls) ? appConfig.subscription.urls : (appConfig.subscription?.url ? [appConfig.subscription.url] : []),
    updatedAt: new Date().toISOString()
  };
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
  const disabledSubscriptionTags = new Set(config?.nodeRegistry?.disabledSubscriptionTags || []);
  const subscriptionNodes = (subscription?.nodes || []).filter((node) => !disabledSubscriptionTags.has(node?.tag));
  const manualNodes = config?.nodeRegistry?.manualNodes || [];
  const groups = config?.nodeRegistry?.groups || [];
  const chains = config?.nodeRegistry?.chains || [];
  const builtins = [
    { tag: 'proxy', type: 'selector', source: 'builtin', label: 'proxy（自动选择）' },
    { tag: 'auto', type: 'urltest', source: 'builtin', label: 'auto（延迟测试）' },
    { tag: 'direct', type: 'direct', source: 'builtin', label: 'direct' },
    { tag: 'block', type: 'block', source: 'builtin', label: 'block' }
  ];

  return [
    ...builtins,
    ...groups.map((group) => ({
      tag: group.tag,
      type: group.strategy,
      source: 'group',
      label: `${group.tag}（${group.strategy} / 节点组）`
    })),
    ...chains.map((chain) => ({
      tag: chain.tag,
      type: 'chain',
      source: 'chain',
      label: `${chain.tag}（chain / 链式代理）`
    })),
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
    }))
  ];
}

function normalizeGroupConfig(group) {

  return {
    tag: group?.tag || '',
    strategy: group?.strategy || 'urltest',
    url: group?.url || 'https://www.gstatic.com/generate_204',
    interval: group?.interval || '10m',
    timeoutMs: Number(group?.timeoutMs || 5000),
    members: Array.isArray(group?.members) ? group.members : []
  };
}

function normalizeChainConfig(chain) {
  return {
    tag: chain?.tag || '',
    members: Array.isArray(chain?.members) ? chain.members : []
  };
}

function resolveCheckTargetTag(tag) {
  const chains = appConfig.nodeRegistry?.chains || [];
  const matchedChain = chains.find((chain) => chain?.tag === tag);
  if (matchedChain && Array.isArray(matchedChain.members) && matchedChain.members.length) {
    return matchedChain.members[matchedChain.members.length - 1];
  }
  return tag;
}

function isChainTag(tag) {
  return (appConfig.nodeRegistry?.chains || []).some((chain) => chain?.tag === tag);
}

async function checkChainConnectivity(chainTag, url, timeout) {
  const result = await measureOutboundDelay(chainTag, url, timeout);
  if (result.ok) {
    return {
      ok: true,
      text: '通过',
      checkedAt: new Date().toISOString(),
      chainTag
    };
  }
  return {
    ok: false,
    text: '失败',
    error: result.error,
    checkedAt: new Date().toISOString(),
    chainTag
  };
}

function buildSubscriptionSummaryPayload(subscription) {
  return {
    nodes: subscription?.nodes || [],
    warnings: subscription?.warnings || [],
    updatedAt: subscription?.updatedAt || null,
    sources: subscription?.sources || [],
    rawLength: typeof subscription?.raw === 'string' ? subscription.raw.length : 0
  };
}

function restartFallbackLoop() {
  stopFallbackLoop();
  const fallbackGroups = (appConfig.nodeRegistry?.groups || []).filter((group) => group?.strategy === 'fallback' && Array.isArray(group.members) && group.members.length);
  if (!fallbackGroups.length) {
    return;
  }

  fallbackTimer = setInterval(() => {
    evaluateFallbackGroups().catch((error) => {
      manager.pushLog(`fallback evaluator error: ${error.message}`);
    });
  }, 30000);

  evaluateFallbackGroups().catch((error) => {
    manager.pushLog(`fallback evaluator error: ${error.message}`);
  });
}

function stopFallbackLoop() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

async function evaluateFallbackGroups() {
  if (!manager.getStatus().running) {
    return;
  }

  const groups = (appConfig.nodeRegistry?.groups || []).filter((group) => group?.strategy === 'fallback' && Array.isArray(group.members) && group.members.length);
  if (!groups.length) {
    return;
  }

  appConfig.runtimeState ||= {};
  appConfig.runtimeState.fallbackGroups ||= {};

  for (const group of groups) {
    const current = appConfig.runtimeState.fallbackGroups[group.tag]?.current || group.members[0];
    const nextAvailable = await chooseHealthyFallbackMember(group);
    if (!nextAvailable) {
      continue;
    }
    if (nextAvailable !== current) {
      appConfig.runtimeState.fallbackGroups[group.tag] = {
        current: nextAvailable,
        updatedAt: new Date().toISOString()
      };
      await saveConfig(appConfig);
      const generated = buildSingBoxConfig(appConfig, subscriptionState);
      await writeGeneratedConfig(generated);
      manager.pushLog(`fallback group ${group.tag} switched from ${current} to ${nextAvailable}`);
    }
  }
}

async function chooseHealthyFallbackMember(group) {
  const currentState = appConfig.runtimeState?.fallbackGroups?.[group.tag];
  const preferredOrder = currentState?.current
    ? [currentState.current, ...group.members.filter((item) => item !== currentState.current)]
    : group.members.slice();

  for (const memberTag of preferredOrder) {
    const ok = await probeOutbound(memberTag, group);
    if (ok) {
      return memberTag;
    }
  }
  return null;
}

async function probeOutbound(memberTag, group) {
  const url = group.url || 'https://www.gstatic.com/generate_204';
  const timeout = Number(group.timeoutMs || 5000);
  try {
    const targetUrl = new URL(url);
    const host = targetUrl.hostname;
    const port = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80');
    const connectTimeout = AbortSignal.timeout(timeout);
    const response = await fetch(`http://127.0.0.1:19090/proxies/${encodeURIComponent(memberTag)}/delay?url=${encodeURIComponent(url)}&timeout=${timeout}`, {
      signal: connectTimeout
    });
    if (response.ok) {
      const data = await response.json();
      return typeof data?.delay === 'number' && data.delay >= 0;
    }
    manager.pushLog(`fallback probe ${group.tag}/${memberTag} failed via clash-api for ${host}:${port}`);
    return false;
  } catch {
    return false;
  }
}

async function measureOutboundDelay(memberTag, url, timeout) {
  if (!manager.getStatus().running) {
    return { ok: false, error: 'sing-box 未运行或尚未就绪' };
  }

  const endpoint = `http://127.0.0.1:19090/proxies/${encodeURIComponent(memberTag)}/delay?url=${encodeURIComponent(url)}&timeout=${timeout}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(timeout + 1500)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (typeof data?.delay === 'number' && data.delay >= 0) {
        return {
          ok: true,
          delay: data.delay,
          text: `${data.delay} ms`,
          checkedAt: new Date().toISOString()
        };
      }
      throw new Error('No delay data');
    } catch (error) {
      if (attempt >= 2) {
        return {
          ok: false,
          error: error.message.includes('fetch')
            ? '测速控制接口未就绪，请先确认 sing-box 已正常启动'
            : error.message
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
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
  const embeddedAssets = globalThis.__SUB2SOCKS5_SEA_ASSETS__ || null;

  if (embeddedAssets && embeddedAssets[relativePath]) {
    const content = Buffer.from(embeddedAssets[relativePath], 'base64');
    res.writeHead(200, baseHeaders(contentType(relativePath)));
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(content);
    return;
  }

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
