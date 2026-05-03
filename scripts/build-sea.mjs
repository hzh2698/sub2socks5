import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inject } from 'postject';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const distDir = path.join(projectDir, 'dist');
const seaPrepDir = path.join(projectDir, 'sea-prep');
const assetsJsonPath = path.join(seaPrepDir, 'public-assets.json');
const bundlePath = path.join(seaPrepDir, 'sea-entry.cjs');
const seaConfigPath = path.join(seaPrepDir, 'sea-config.json');
const blobPath = path.join(seaPrepDir, 'sea-prep.blob');
const outputExePath = path.join(distDir, 'sub2socks5-sea.exe');
const nodeExe = process.execPath;

await rm(seaPrepDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(seaPrepDir, { recursive: true });
await rm(outputExePath, { force: true }).catch(() => {});

const publicDir = path.join(projectDir, 'src', 'public');
const assets = await collectAssets(publicDir, publicDir);
await writeFile(assetsJsonPath, JSON.stringify(assets, null, 2), 'utf8');

await build({
  entryPoints: [path.join(projectDir, 'scripts', 'sea-entry.cjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: bundlePath,
  banner: {
    js: `globalThis.__SUB2SOCKS5_SEA_ASSETS__ = ${JSON.stringify(assets)};`
  }
});

const seaConfig = {
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true
};
await writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');

await execFileAsync(nodeExe, ['--experimental-sea-config', seaConfigPath], {
  cwd: projectDir
});

await copyFile(nodeExe, outputExePath);
await inject(outputExePath, 'NODE_SEA_BLOB', await readFile(blobPath), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: 'NODE_SEA'
});

console.log(`SEA executable created: ${outputExePath}`);

async function collectAssets(rootDir, currentDir) {
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(currentDir, { withFileTypes: true }));
  const result = {};

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await collectAssets(rootDir, fullPath));
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).replaceAll('\\', '/');
    const content = await readFile(fullPath);
    result[relativePath] = content.toString('base64');
  }

  return result;
}
