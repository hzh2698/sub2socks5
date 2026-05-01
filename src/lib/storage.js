import { mkdir, readFile, writeFile, access, readdir, copyFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.dirname(moduleDir);
const baseDir = path.dirname(srcDir);

export const dataDir = path.join(baseDir, 'data');
export const runtimeDir = path.join(baseDir, 'runtime');
export const publicDir = path.join(srcDir, 'public');
export const binDir = path.join(baseDir, 'bin');
export const appConfigPath = path.join(dataDir, 'app-config.json');
export const generatedConfigPath = path.join(runtimeDir, 'sing-box.json');
export const architectureInfoPath = path.join(dataDir, 'architecture-info.json');
export const plannedKernelInfoPath = path.join(dataDir, 'planned-kernel-info.json');
export const releaseListInfoPath = path.join(dataDir, 'release-list.json');
export const subscriptionStatePath = path.join(dataDir, 'subscription-state.json');

const legacyDataDir = path.join(srcDir, 'data');
const legacyRuntimeDir = path.join(srcDir, 'runtime');
const legacyBinDir = path.join(srcDir, 'bin');

export const defaultConfig = {
  app: {
    host: '127.0.0.1',
    port: 18080,
    singBoxBinary: path.join(binDir, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'),
    autoStart: false,
    logLevel: 'info'
  },
  subscription: {
    url: '',
    format: 'raw',
    userAgent: 'sub2socks5/0.1.0',
    refreshIntervalMinutes: 60,
    headers: {}
  },
  dns: {
    strategy: 'prefer_ipv4',
    remoteUrl: 'https://1.1.1.1/dns-query',
    bootstrapServer: '223.5.5.5',
    servers: [
      {
        tag: 'dns-remote',
        type: 'https',
        server: '1.1.1.1',
        path: '/dns-query',
        detour: 'proxy'
      },
      {
        tag: 'dns-direct',
        type: 'local'
      }
    ],
    rules: [
      {
        clash_mode: 'Direct',
        server: 'dns-direct'
      },
      {
        server: 'dns-remote'
      }
    ],
    final: 'dns-remote',
    independentCache: true,
    disableCache: false,
    disableExpire: false
  },
  routing: {
    routeFinal: 'proxy',
    autoDetectInterface: true,
    ruleSetUrls: [],
    rules: [
      {
        action: 'sniff'
      }
    ]
  },
  nodeRegistry: {
    manualNodes: [],
    groups: []
  },
  ports: [
    {
      tag: 'default-socks',
      listen: '127.0.0.1',
      port: 1080,
      target: 'proxy',
      sniff: true
    }
  ]
};

export async function ensureDirs() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await migrateLegacyLayout();
}

export async function loadConfig() {
  await ensureDirs();
  try {
    await access(appConfigPath);
  } catch {
    await saveConfig(defaultConfig);
    return structuredClone(defaultConfig);
  }
  const raw = await readFile(appConfigPath, 'utf8');
  const parsed = JSON.parse(raw);
  return migrateConfig(mergeDefaults(defaultConfig, parsed));
}

export async function saveConfig(config) {
  await ensureDirs();
  await writeFile(appConfigPath, JSON.stringify(config, null, 2), 'utf8');
}

export async function writeGeneratedConfig(config) {
  await ensureDirs();
  await writeFile(generatedConfigPath, JSON.stringify(config, null, 2), 'utf8');
}

export async function saveArchitectureInfo(info) {
  await ensureDirs();
  await writeFile(architectureInfoPath, JSON.stringify(info, null, 2), 'utf8');
}

export async function loadArchitectureInfo() {
  await ensureDirs();
  try {
    const raw = await readFile(architectureInfoPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function savePlannedKernelInfo(info) {
  await ensureDirs();
  await writeFile(plannedKernelInfoPath, JSON.stringify(info, null, 2), 'utf8');
}

export async function loadPlannedKernelInfo() {
  await ensureDirs();
  try {
    const raw = await readFile(plannedKernelInfoPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveReleaseListInfo(info) {
  await ensureDirs();
  await writeFile(releaseListInfoPath, JSON.stringify(info, null, 2), 'utf8');
}

export async function loadReleaseListInfo() {
  await ensureDirs();
  try {
    const raw = await readFile(releaseListInfoPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveSubscriptionState(info) {
  await ensureDirs();
  await writeFile(subscriptionStatePath, JSON.stringify(info, null, 2), 'utf8');
}

export async function loadSubscriptionState() {
  await ensureDirs();
  try {
    const raw = await readFile(subscriptionStatePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function migrateLegacyLayout() {
  await migrateDirectoryContents(legacyDataDir, dataDir);
  await migrateDirectoryContents(legacyRuntimeDir, runtimeDir);
  await migrateDirectoryContents(legacyBinDir, binDir);
}

async function migrateDirectoryContents(sourceDir, targetDir) {
  const sourceExists = await stat(sourceDir).then(() => true).catch(() => false);
  if (!sourceExists) {
    return;
  }

  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await migrateDirectoryContents(sourcePath, targetPath);
      continue;
    }

    const targetExists = await stat(targetPath).then(() => true).catch(() => false);
    if (!targetExists) {
      await copyFile(sourcePath, targetPath);
    }
  }

  await rm(sourceDir, { recursive: true, force: true });
}

function mergeDefaults(base, value) {
  if (Array.isArray(base)) {
    return Array.isArray(value) ? value : structuredClone(base);
  }
  if (base && typeof base === 'object') {
    const result = { ...base };
    for (const [key, baseValue] of Object.entries(base)) {
      result[key] = mergeDefaults(baseValue, value?.[key]);
    }
    for (const [key, incoming] of Object.entries(value || {})) {
      if (!(key in result)) {
        result[key] = incoming;
      }
    }
    return result;
  }
  return value ?? base;
}

function migrateConfig(config) {
  config.dns ||= {};
  if (!config.dns.remoteUrl) {
    config.dns.remoteUrl = deriveRemoteDnsUrl(config.dns.servers);
  }
  if (!config.dns.bootstrapServer) {
    config.dns.bootstrapServer = '223.5.5.5';
  }
  if (Array.isArray(config?.dns?.servers)) {
    config.dns.servers = config.dns.servers.map(migrateDnsServer).filter(Boolean);
  }
  if (Array.isArray(config?.dns?.rules)) {
    config.dns.rules = config.dns.rules.map(migrateDnsRule).filter(Boolean);
  }
  return config;
}

function migrateDnsServer(server) {
  if (!server || typeof server !== 'object') {
    return server;
  }

  if (server.tag === 'dns-direct' && server.detour === 'direct') {
    return {
      tag: 'dns-direct',
      type: 'local'
    };
  }

  if (!server.address) {
    if (server?.tag === 'dns-direct' && (server?.type === 'https' || server?.type === 'tls')) {
      return {
        tag: 'dns-direct',
        type: 'local'
      };
    }
    return server;
  }

  const { address, ...rest } = server;

  if (address.startsWith('tls://')) {
    return {
      ...rest,
      type: 'tls',
      server: address.slice('tls://'.length)
    };
  }

  if (address.startsWith('https://')) {
    const url = new URL(address);
    return {
      ...rest,
      type: 'https',
      server: url.host,
      path: url.pathname || '/dns-query'
    };
  }

  if (address.startsWith('rcode://')) {
    return null;
  }

  return server;
}

function migrateDnsRule(rule) {
  if (!rule || typeof rule !== 'object') {
    return rule;
  }

  if (rule.outbound === 'any') {
    const { outbound, ...rest } = rule;
    if (rest.server) {
      return null;
    }
    return rest;
  }

  return rule;
}

function deriveRemoteDnsUrl(servers = []) {
  const remote = servers.find((item) => item?.tag === 'dns-remote');
  if (!remote) {
    return 'https://1.1.1.1/dns-query';
  }
  if (remote.address?.startsWith('https://')) {
    return remote.address;
  }
  if (remote.type === 'https' && remote.server) {
    return `https://${remote.server}${remote.path || '/dns-query'}`;
  }
  if (remote.address?.startsWith('tls://')) {
    return `https://${remote.address.slice('tls://'.length)}/dns-query`;
  }
  if (remote.type === 'tls' && remote.server) {
    return `https://${remote.server}/dns-query`;
  }
  return 'https://1.1.1.1/dns-query';
}
