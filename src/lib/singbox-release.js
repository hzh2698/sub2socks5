import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { binDir } from './storage.js';

const execFileAsync = promisify(execFile);
const repoApi = 'https://api.github.com/repos/SagerNet/sing-box/releases';
const defaultDownloadThreads = 4;

export function detectPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  const osMap = {
    win32: 'windows',
    linux: 'linux',
    darwin: 'darwin'
  };
  const archMap = {
    x64: 'amd64',
    arm64: 'arm64'
  };
  const osName = osMap[platform];
  const archName = archMap[arch];
  if (!osName || !archName) {
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
  }
  return {
    detectedAt: new Date().toISOString(),
    platform,
    arch,
    os: osName,
    archName,
    assetSuffix: `${osName}-${archName}`,
    executableName: platform === 'win32' ? 'sing-box.exe' : 'sing-box'
  };
}

export async function getLatestReleaseInfo(platformInfo = detectPlatform()) {
  const response = await fetch(`${repoApi}/latest`, {
    headers: {
      'user-agent': 'sub2socks5/0.1.0',
      accept: 'application/vnd.github+json'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch sing-box latest release: HTTP ${response.status}`);
  }
  const release = await response.json();
  return mapRelease(release, platformInfo);
}

export async function listReleaseInfos(platformInfo = detectPlatform()) {
  const response = await fetch(`${repoApi}?per_page=20`, {
    headers: {
      'user-agent': 'sub2socks5/0.1.0',
      accept: 'application/vnd.github+json'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch sing-box releases: HTTP ${response.status}`);
  }
  const releases = await response.json();
  return releases
    .map((release) => {
      try {
        return mapRelease(release, platformInfo);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function downloadLatestSingBox(options = {}) {
  const platformInfo = options.platformInfo || detectPlatform();
  const release = await getLatestReleaseInfo(platformInfo);
  return downloadSingBoxRelease({ ...options, release });
}

export async function downloadSingBoxRelease(options = {}) {
  const onProgress = options.onProgress || (() => {});
  const release = options.release;
  if (!release) {
    throw new Error('Missing release information for download');
  }

  await mkdir(binDir, { recursive: true });
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'sub2socks5-'));
  const archivePath = path.join(tempRoot, release.assetName);
  const extractDir = path.join(tempRoot, 'extract');
  await mkdir(extractDir, { recursive: true });

  try {
    onProgress(step('prepare', 'Prepared download workspace', { tempRoot, assetName: release.assetName }));
    await downloadArchive(release, archivePath, onProgress);

    onProgress(step('extract', 'Extracting kernel archive', { archivePath }));
    await extractArchive(archivePath, extractDir);

    onProgress(step('search', 'Locating executable file', { executableName: release.platform.executableName }));
    const binarySource = await findBinary(extractDir, release.platform.executableName);
    const binaryTarget = path.join(binDir, release.platform.executableName);
    const versionFile = path.join(binDir, 'sing-box-version.json');

    onProgress(step('install', 'Installing kernel binary', { binaryTarget }));
    await rename(binarySource, binaryTarget).catch(async () => {
      const bytes = await readFile(binarySource);
      await writeFile(binaryTarget, bytes);
    });
    if (process.platform !== 'win32') {
      await chmod(binaryTarget, 0o755);
    }
    await writeFile(versionFile, JSON.stringify(release, null, 2), 'utf8');

    onProgress(step('done', 'Kernel installation completed', { binaryPath: binaryTarget }));
    return {
      ok: true,
      binaryPath: binaryTarget,
      ...release
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function readInstalledKernelInfo() {
  const meta = detectPlatform();
  const binaryPath = path.join(binDir, meta.executableName);
  const versionFile = path.join(binDir, 'sing-box-version.json');
  const installed = await stat(binaryPath).then(() => true).catch(() => false);
  let releaseInfo = null;
  if (await stat(versionFile).then(() => true).catch(() => false)) {
    releaseInfo = JSON.parse(await readFile(versionFile, 'utf8'));
  }
  return {
    installed,
    binaryPath,
    platform: meta,
    releaseInfo
  };
}

function mapRelease(release, platformInfo) {
  const asset = pickAsset(release.assets || [], platformInfo.assetSuffix);
  if (!asset) {
    throw new Error(`No asset found for ${platformInfo.assetSuffix}`);
  }
  return {
    version: release.tag_name,
    publishedAt: release.published_at,
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
    size: asset.size,
    platform: platformInfo
  };
}

function pickAsset(assets, suffix) {
  const archiveCandidates = assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    return name.includes(suffix) && (name.endsWith('.zip') || name.endsWith('.tar.gz')) && !name.includes('lite');
  });

  const preferred = archiveCandidates.find((asset) => {
    const name = asset.name.toLowerCase();
    return !name.includes('legacy') && !name.includes('windows-7');
  });

  return preferred || archiveCandidates[0];
}

async function downloadArchive(release, archivePath, onProgress) {
  const supportsRanges = await checkRangeSupport(release.downloadUrl);
  if (supportsRanges && release.size > 0) {
    onProgress(step('download', 'Starting multi-threaded kernel download', {
      totalBytes: release.size,
      threads: defaultDownloadThreads
    }));
    await downloadWithRanges(release.downloadUrl, archivePath, release.size, defaultDownloadThreads, onProgress);
    return;
  }

  onProgress(step('download', 'Starting single-threaded kernel download', {
    totalBytes: release.size,
    threads: 1
  }));
  const response = await fetch(release.downloadUrl, {
    headers: { 'user-agent': 'sub2socks5/0.1.0' }
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download sing-box: HTTP ${response.status}`);
  }
  const totalBytes = Number(response.headers.get('content-length')) || release.size || 0;
  await downloadWithProgress(response, archivePath, totalBytes, onProgress);
}

async function checkRangeSupport(downloadUrl) {
  try {
    const response = await fetch(downloadUrl, {
      method: 'HEAD',
      headers: { 'user-agent': 'sub2socks5/0.1.0' }
    });
    if (!response.ok) {
      return false;
    }
    const acceptRanges = response.headers.get('accept-ranges') || '';
    return acceptRanges.toLowerCase().includes('bytes');
  } catch {
    return false;
  }
}

async function downloadWithRanges(downloadUrl, archivePath, totalBytes, threadCount, onProgress) {
  const chunkSize = Math.ceil(totalBytes / threadCount);
  const parts = Array.from({ length: threadCount }, (_, index) => {
    const start = index * chunkSize;
    const end = Math.min(totalBytes - 1, start + chunkSize - 1);
    return { index, start, end, path: `${archivePath}.part${index}` };
  }).filter((part) => part.start <= part.end);

  let downloadedBytes = 0;
  await Promise.all(parts.map(async (part) => {
    const response = await fetch(downloadUrl, {
      headers: {
        'user-agent': 'sub2socks5/0.1.0',
        range: `bytes=${part.start}-${part.end}`
      }
    });
    if (!(response.status === 206 || response.status === 200) || !response.body) {
      throw new Error(`Failed to download chunk: HTTP ${response.status}`);
    }
    const writer = createWriteStream(part.path);
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(Buffer.from(value));
        downloadedBytes += value.byteLength;
        onProgress(step('download', 'Downloading kernel archive with multiple threads', {
          downloadedBytes,
          totalBytes,
          percent: totalBytes > 0 ? Number(((downloadedBytes / totalBytes) * 100).toFixed(2)) : null,
          threads: parts.length
        }));
      }
    } finally {
      writer.end();
    }
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }));

  const targetWriter = createWriteStream(archivePath);
  for (const part of parts) {
    const content = await readFile(part.path);
    targetWriter.write(content);
    await rm(part.path, { force: true });
  }
  targetWriter.end();
  await new Promise((resolve, reject) => {
    targetWriter.on('finish', resolve);
    targetWriter.on('error', reject);
  });
}

async function downloadWithProgress(response, archivePath, totalBytes, onProgress) {
  const writer = createWriteStream(archivePath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloadedBytes += value.byteLength;
      writer.write(Buffer.from(value));
      onProgress(step('download', 'Downloading kernel archive', {
        downloadedBytes,
        totalBytes,
        percent: totalBytes > 0 ? Number(((downloadedBytes / totalBytes) * 100).toFixed(2)) : null,
        threads: 1
      }));
    }
  } finally {
    writer.end();
  }

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function step(stage, message, details = {}) {
  return {
    stage,
    message,
    details,
    time: new Date().toISOString()
  };
}

async function extractArchive(archivePath, extractDir) {
  if (archivePath.endsWith('.zip')) {
    const ps = 'Expand-Archive';
    await execFileAsync('powershell.exe', ['-Command', `${ps} -LiteralPath '${archivePath}' -DestinationPath '${extractDir}' -Force`]);
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir]);
    return;
  }
  throw new Error(`Unsupported archive format: ${archivePath}`);
}

async function findBinary(rootDir, executableName) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === executableName) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = await findBinary(fullPath, executableName).catch(() => null);
      if (found) {
        return found;
      }
    }
  }
  throw new Error(`Executable not found in archive: ${executableName}`);
}
