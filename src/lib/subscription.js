import { Buffer } from 'node:buffer';

const supportedSchemes = new Set([
  'vmess:',
  'vless:',
  'trojan:',
  'ss:',
  'hysteria2:',
  'tuic:'
]);

export async function fetchSubscription(subscription) {
  if (!subscription.url) {
    return { nodes: [], raw: '', warnings: ['订阅地址为空'] };
  }
  const response = await fetch(subscription.url, {
    headers: {
      'user-agent': subscription.userAgent || 'sub2socks5/0.1.0',
      ...normalizeHeaders(subscription.headers)
    }
  });
  if (!response.ok) {
    throw new Error(`拉取订阅失败: HTTP ${response.status}`);
  }
  const rawText = await response.text();
  return parseSubscription(rawText, subscription.format);
}

export function parseSubscription(rawText, format = 'raw') {
  const warnings = [];
  const text = decodeMaybeBase64(rawText).trim();
  if (!text) {
    return { nodes: [], raw: rawText, warnings: ['订阅内容为空'] };
  }
  const lines = extractSubscriptionLines(text);
  const nodes = [];
  for (const line of lines) {
    const normalizedLine = sanitizeSubscriptionLine(line);
    const scheme = getScheme(normalizedLine);
    if (!supportedSchemes.has(scheme)) {
      if (looksLikeSubscriptionPayload(normalizedLine)) {
        warnings.push(`跳过暂不支持的节点: ${normalizedLine.slice(0, 24)}...`);
      }
      continue;
    }
    try {
      const node = parseLine(normalizedLine);
      const validationError = validateNode(node);
      if (validationError) {
        warnings.push(`节点已跳过: ${validationError}`);
        continue;
      }
      nodes.push(node);
    } catch (error) {
      const retried = retryParseLine(normalizedLine);
      if (retried.ok) {
        const validationError = validateNode(retried.node);
        if (validationError) {
          warnings.push(`节点已跳过: ${validationError}`);
          continue;
        }
        nodes.push(retried.node);
      } else {
        warnings.push(`节点解析失败: ${retried.error || error.message}`);
      }
    }
  }
  return { nodes, raw: rawText, warnings };
}

function parseLine(line) {
  if (line.startsWith('ss://')) {
    return parseShadowsocks(line);
  }
  const url = new URL(line);
  const tag = decodeURIComponent(url.hash.replace(/^#/, '') || `${url.protocol}${url.hostname}`);
  if (url.protocol === 'trojan:') {
    return {
      type: 'trojan',
      tag,
      server: url.hostname,
      server_port: Number(url.port || 443),
      password: decodeURIComponent(url.username),
      tls: buildTls(url)
    };
  }
  if (url.protocol === 'vless:') {
    return {
      type: 'vless',
      tag,
      server: url.hostname,
      server_port: Number(url.port || 443),
      uuid: decodeURIComponent(url.username),
      flow: url.searchParams.get('flow') || undefined,
      tls: buildTls(url),
      transport: buildTransport(url)
    };
  }
  if (url.protocol === 'hysteria2:') {
    return {
      type: 'hysteria2',
      tag,
      server: url.hostname,
      server_port: Number(url.port || 443),
      password: decodeURIComponent(url.username),
      tls: buildTls(url),
      up_mbps: numberOrUndefined(url.searchParams.get('upmbps')),
      down_mbps: numberOrUndefined(url.searchParams.get('downmbps'))
    };
  }
  if (url.protocol === 'tuic:') {
    return {
      type: 'tuic',
      tag,
      server: url.hostname,
      server_port: Number(url.port || 443),
      uuid: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      tls: buildTls(url),
      congestion_control: url.searchParams.get('congestion_control') || 'bbr'
    };
  }
  if (url.protocol === 'vmess:') {
    const decoded = JSON.parse(Buffer.from(line.slice('vmess://'.length), 'base64').toString('utf8'));
    return {
      type: 'vmess',
      tag: decoded.ps || `${decoded.add}:${decoded.port}`,
      server: decoded.add,
      server_port: Number(decoded.port),
      uuid: decoded.id,
      security: decoded.scy || 'auto',
      alter_id: Number(decoded.aid || 0),
      tls: decoded.tls === 'tls' ? {
        enabled: true,
        server_name: decoded.sni || decoded.host || decoded.add,
        insecure: decoded.allowInsecure === '1'
      } : undefined,
      transport: buildVmessTransport(decoded)
    };
  }
  throw new Error(`不支持的协议 ${url.protocol}`);
}

function retryParseLine(line) {
  try {
    return { ok: true, node: parseLine(decodeURIComponentSafe(line)) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseShadowsocks(line) {
  const payload = line.slice('ss://'.length);
  const [mainPart, tagPart = ''] = payload.split('#');
  const [basePart, queryPart = ''] = mainPart.split('?');
  let decodedMain = basePart;

  if (!basePart.includes('@')) {
    const decoded = decodeSsUserInfo(basePart);
    if (decoded) {
      decodedMain = decoded;
    }
  }

  const finalMain = queryPart ? `${decodedMain}?${queryPart}` : decodedMain;
  const url = new URL(`ss://${finalMain}`);
  return {
    type: 'shadowsocks',
    tag: decodeURIComponent(tagPart || `${url.hostname}:${url.port}`),
    server: url.hostname,
    server_port: Number(url.port),
    method: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  };
}

function buildTls(url) {
  const security = url.searchParams.get('security');
  const isTls = url.protocol === 'trojan:' || url.searchParams.get('tls') === '1' || security === 'tls' || security === 'reality';
  if (!isTls) {
    return undefined;
  }
  const fingerprint =
    url.searchParams.get('fp') ||
    url.searchParams.get('fingerprint') ||
    url.searchParams.get('client-fingerprint') ||
    (security === 'reality' ? 'chrome' : undefined);
  const tls = {
    enabled: true,
    server_name: url.searchParams.get('sni') || url.hostname,
    insecure: url.searchParams.get('allowInsecure') === '1',
    utls: fingerprint
      ? {
          enabled: true,
          fingerprint
        }
      : undefined
  };
  if (url.protocol === 'hysteria2:' || url.protocol === 'tuic:') {
    delete tls.reality;
    delete tls.utls;
    tls.alpn = ['h3'];
  }
  if (security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: url.searchParams.get('pbk') || undefined,
      short_id: url.searchParams.get('sid') || undefined
    };
  }
  return tls;
}

function buildTransport(url) {
  const type = url.searchParams.get('type');
  if (!type || type === 'tcp') {
    return undefined;
  }
  if (type === 'ws') {
    return {
      type: 'ws',
      path: url.searchParams.get('path') || '/',
      headers: url.searchParams.get('host') ? { Host: url.searchParams.get('host') } : undefined
    };
  }
  if (type === 'grpc') {
    return {
      type: 'grpc',
      service_name: url.searchParams.get('serviceName') || ''
    };
  }
  if (type === 'http') {
    return {
      type: 'http',
      host: url.searchParams.get('host') ? [url.searchParams.get('host')] : undefined,
      path: url.searchParams.get('path') || '/'
    };
  }
  return { type };
}

function buildVmessTransport(decoded) {
  if (decoded.net === 'ws') {
    return {
      type: 'ws',
      path: decoded.path || '/',
      headers: decoded.host ? { Host: decoded.host } : undefined
    };
  }
  if (decoded.net === 'grpc') {
    return {
      type: 'grpc',
      service_name: decoded.path || ''
    };
  }
  if (decoded.net === 'http') {
    return {
      type: 'http',
      host: decoded.host ? [decoded.host] : undefined,
      path: decoded.path || '/'
    };
  }
  return undefined;
}

function decodeMaybeBase64(text) {
  const clean = text.trim();
  if (/^(vmess|vless|trojan|ss|tuic|hysteria2):\/\//m.test(clean)) {
    return clean;
  }

  const normalized = normalizeBase64(clean);
  if (!normalized) {
    return text;
  }

  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    if (/^(vmess|vless|trojan|ss|tuic|hysteria2):\/\//m.test(decoded.trim())) {
      return decoded;
    }
  } catch {
    return text;
  }
  return text;
}

function extractSubscriptionLines(text) {
  const directLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const extracted = [];

  for (const line of directLines) {
    const cleanedLine = sanitizeSubscriptionLine(line);
    const matches = cleanedLine.match(/(vmess|vless|trojan|ss|tuic|hysteria2):\/\/[^\s"'<>]+/gi);
    if (matches?.length) {
      extracted.push(...matches.map((item) => item.trim()));
      continue;
    }

    const nestedDecoded = decodeBase64Line(cleanedLine);
    if (nestedDecoded) {
      const nestedLines = nestedDecoded
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      for (const nestedLine of nestedLines) {
        const nestedMatches = nestedLine.match(/(vmess|vless|trojan|ss|tuic|hysteria2):\/\/[^\s"'<>]+/gi);
        if (nestedMatches?.length) {
          extracted.push(...nestedMatches.map((item) => item.trim()));
        }
      }
      continue;
    }

    extracted.push(cleanedLine);
  }

  return extracted;
}

function decodeBase64Line(line) {
  const normalized = normalizeBase64(line);
  if (!normalized) {
    return '';
  }

  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
    if (/^(vmess|vless|trojan|ss|tuic|hysteria2):\/\//m.test(decoded)) {
      return decoded;
    }
  } catch {
    return '';
  }

  return '';
}

function normalizeBase64(value) {
  const compact = value.replace(/\s+/g, '');
  if (!compact || compact.length < 16) {
    return '';
  }
  if (!/^[A-Za-z0-9/_+=-]+$/.test(compact)) {
    return '';
  }

  const base = compact.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base.length % 4;
  if (padding === 1) {
    return '';
  }
  return padding ? base.padEnd(base.length + (4 - padding), '=') : base;
}

function looksLikeSubscriptionPayload(line) {
  return /^[A-Za-z0-9/_+=-]{16,}$/.test(line) || /^(vmess|vless|trojan|ss|tuic|hysteria2):\/\//i.test(line);
}

function sanitizeSubscriptionLine(line) {
  return line
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^[`'"\[{(]+/, '')
    .replace(/[`'"\]})\],;]+$/, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '');
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ''));
}

function getScheme(line) {
  const match = /^[a-z0-9+.-]+:/i.exec(line);
  return match ? match[0].toLowerCase() : '';
}

function numberOrUndefined(value) {
  return value ? Number(value) : undefined;
}

function validateNode(node) {
  if (!node?.type || !node?.tag || !node?.server || !node?.server_port) {
    return `${node?.tag || 'unknown'} 缺少基础连接参数`;
  }

  if (node.type === 'vless' && !node.uuid) {
    return `${node.tag} 缺少 uuid`;
  }

  if (node.type === 'trojan' && !node.password) {
    return `${node.tag} 缺少 password`;
  }

  if (node.type === 'hysteria2' && !node.password) {
    return `${node.tag} 缺少 password`;
  }

  if (node.type === 'tuic' && (!node.uuid || !node.password)) {
    return `${node.tag} 缺少 tuic 凭据`;
  }

  if (node.type === 'shadowsocks' && (!node.method || !node.password)) {
    return `${node.tag} 缺少 shadowsocks 凭据`;
  }

  return '';
}

function decodeSsUserInfo(basePart) {
  const decodedWhole = decodeBase64Text(basePart);
  if (decodedWhole && decodedWhole.includes('@')) {
    return decodedWhole;
  }

  const atIndex = basePart.lastIndexOf('@');
  if (atIndex > 0) {
    const encodedUser = basePart.slice(0, atIndex);
    const hostPart = basePart.slice(atIndex + 1);
    const decodedUser = decodeBase64Text(encodedUser);
    if (decodedUser) {
      return `${decodedUser}@${hostPart}`;
    }
  }

  return '';
}

function decodeBase64Text(value) {
  const normalized = normalizeBase64(value);
  if (!normalized) {
    return '';
  }
  try {
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}
