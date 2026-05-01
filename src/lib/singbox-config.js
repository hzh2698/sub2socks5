import { Buffer } from 'node:buffer';

export function buildSingBoxConfig(appConfig, subscriptionState) {
  const dnsServers = buildDnsServers(appConfig.dns || {});
  const dnsRules = buildDnsRules(appConfig.dns || {});
  const mergedNodes = [
    ...(subscriptionState.nodes || []),
    ...((appConfig.nodeRegistry?.manualNodes) || [])
  ];
  const normalizedNodes = mergedNodes
    .map(normalizeOutbound)
    .filter(isUsableOutbound);
  const groups = normalizeGroups(appConfig.nodeRegistry?.groups || [], normalizedNodes);

  const outbounds = [
    {
      type: 'direct',
      tag: 'direct'
    },
    {
      type: 'block',
      tag: 'block'
    },
    ...normalizedNodes,
    ...groups
  ];

  const nodeTags = normalizedNodes.map((node) => node.tag).concat(groups.map((group) => group.tag));

  if (nodeTags.length) {
    outbounds.push({
      type: 'selector',
      tag: 'proxy',
      outbounds: nodeTags,
      default: nodeTags[0]
    });
    outbounds.push({
      type: 'urltest',
      tag: 'auto',
      outbounds: nodeTags,
      url: 'https://www.gstatic.com/generate_204',
      interval: '10m',
      tolerance: 50
    });
  }

  const inbounds = (appConfig.ports || []).map((item) => stripUndefined({
    type: 'socks',
    tag: item.tag,
    listen: item.listen,
    listen_port: Number(item.port)
  }));

  const routeRules = [
    ...(appConfig.routing.rules || []),
    ...(appConfig.ports || []).flatMap((item) => {
      const rules = [];
      if (item.sniff !== false) {
        rules.push({
          inbound: item.tag,
          action: 'sniff'
        });
        rules.push({
          inbound: item.tag,
          action: 'resolve',
          strategy: appConfig.dns.strategy
        });
      }
      return rules;
    }),
    ...(appConfig.ports || []).map((item) => ({
      inbound: item.tag,
      outbound: item.target
    }))
  ];

  return {
    log: {
      level: appConfig.app.logLevel,
      timestamp: true
    },
    dns: {
      servers: dnsServers,
      rules: dnsRules,
      final: appConfig.dns.final || 'dns-remote',
      strategy: appConfig.dns.strategy,
      independent_cache: appConfig.dns.independentCache,
      disable_cache: appConfig.dns.disableCache,
      disable_expire: appConfig.dns.disableExpire
    },
    inbounds,
    outbounds,
    route: {
      auto_detect_interface: appConfig.routing.autoDetectInterface,
      final: appConfig.routing.routeFinal,
      default_domain_resolver: {
        server: appConfig.dns.final || 'dns-remote',
        strategy: appConfig.dns.strategy
      },
      rules: routeRules,
      rule_set: (appConfig.routing.ruleSetUrls || []).map((item) => ({
        tag: item.tag,
        type: 'remote',
        format: item.format || 'binary',
        url: item.url,
        download_detour: item.downloadDetour || 'proxy'
      }))
    },
    experimental: {
      cache_file: {
        enabled: true,
        path: 'cache.db',
        store_rdrc: true,
        store_fakeip: true
      },
      clash_api: {
        external_controller: '127.0.0.1:19090',
        external_ui: '',
        secret: ''
      }
    }
  };
}

function normalizeOutbound(node) {
  const cleaned = stripUndefined(structuredClone(node));

  if (!cleaned.tag || !cleaned.type) {
    return null;
  }

  if (cleaned.type === 'shadowsocks' && cleaned.method && cleaned.password === '') {
    const decoded = decodeShadowsocksCredentials(cleaned.method);
    if (decoded) {
      cleaned.method = decoded.method;
      cleaned.password = decoded.password;
    }
  }

  if (cleaned.type === 'hysteria2' || cleaned.type === 'tuic') {
    cleaned.tls = stripUndefined({
      enabled: true,
      server_name: cleaned.tls?.server_name || cleaned.server,
      insecure: cleaned.tls?.insecure || false,
      alpn: cleaned.tls?.alpn || ['h3']
    });
  }

  if (cleaned.tls?.reality?.enabled && !cleaned.tls?.utls?.enabled) {
    cleaned.tls.utls = {
      enabled: true,
      fingerprint: 'chrome'
    };
  }

  return stripUndefined(cleaned);
}

function isUsableOutbound(node) {
  if (!node || !node.type || !node.tag) {
    return false;
  }

  if (node.type === 'hysteria2' || node.type === 'tuic') {
    return Boolean(node.tls?.enabled && node.tls?.server_name);
  }

  if (node.type === 'vless' || node.type === 'trojan' || node.type === 'vmess') {
    return Boolean(node.server && node.server_port);
  }

  if (node.type === 'shadowsocks') {
    return Boolean(node.server && node.server_port && node.method && node.password);
  }

  return true;
}

function normalizeDnsServer(server) {
  if (!server || typeof server !== 'object') {
    return null;
  }

  if (!server.address) {
    return stripUndefined(server);
  }

  const { address, ...rest } = server;

  if (address.startsWith('tls://')) {
    return stripUndefined({
      ...rest,
      type: 'tls',
      server: address.slice('tls://'.length)
    });
  }

  if (address.startsWith('https://')) {
    const url = new URL(address);
    return stripUndefined({
      ...rest,
      type: 'https',
      server: url.host,
      path: url.pathname || '/dns-query'
    });
  }

  if (address.startsWith('rcode://')) {
    return null;
  }

  return stripUndefined(server);
}

function normalizeGroups(groups, nodes) {
  const nodeTags = new Set(nodes.map((node) => node.tag));
  return groups
    .filter((group) => group?.tag && Array.isArray(group.members) && group.members.length)
    .map((group) => {
      const members = group.members.filter((tag) => nodeTags.has(tag));
      if (!members.length) {
        return null;
      }
      if (group.strategy === 'fallback') {
        return {
          type: 'selector',
          tag: group.tag,
          outbounds: members,
          default: members[0],
          interrupt_exist_connections: false
        };
      }
      return {
        type: 'urltest',
        tag: group.tag,
        outbounds: members,
        url: group.url || 'https://www.gstatic.com/generate_204',
        interval: group.interval || '10m',
        tolerance: Number(group.tolerance || 50)
      };
    })
    .filter(Boolean);
}

function buildDnsServers(dnsConfig) {
  const remoteUrl = dnsConfig.remoteUrl || 'https://1.1.1.1/dns-query';
  const bootstrapServer = dnsConfig.bootstrapServer || '223.5.5.5';
  const remote = buildHttpsDnsServer(remoteUrl, bootstrapServer);
  const direct = { tag: 'dns-direct', type: 'local' };
  return [remote, direct];
}

function buildDnsRules(dnsConfig) {
  const rules = [];
  for (const rule of dnsConfig.rules || []) {
    if (rule?.clash_mode === 'Direct') {
      rules.push({ clash_mode: 'Direct', server: 'dns-direct' });
    }
  }
  rules.push({ server: dnsConfig.final || 'dns-remote' });
  return rules;
}

function buildHttpsDnsServer(remoteUrl, bootstrapServer) {
  const url = new URL(remoteUrl);
  return stripUndefined({
    tag: 'dns-remote',
    type: 'https',
    server: url.host,
    path: url.pathname || '/dns-query',
    detour: 'proxy',
    domain_resolver: bootstrapServer ? {
      server: 'dns-direct',
      strategy: 'prefer_ipv4'
    } : undefined
  });
}

function decodeShadowsocksCredentials(value) {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 2) {
      return null;
    }
    return {
      method: parts[0],
      password: parts.slice(1).join(':')
    };
  } catch {
    return null;
  }
}

function stripUndefined(input) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== undefined)
  );
}
