import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const stage = join(root, 'desktop/package-resources');
await mkdir(join(stage, 'backend/server'), { recursive: true });
await mkdir(join(stage, 'runtime'), { recursive: true });
await build({ entryPoints: [join(root, 'server/desktop-entry.ts')], outfile: join(stage, 'backend/server/index.mjs'),
  bundle: true, packages: 'external', platform: 'node', target: 'node24', format: 'esm' });
await copyFile(join(root, 'server/harness-plugin.mjs'), join(stage, 'backend/server/harness-plugin.mjs'));
await copyFile(join(root, 'package.json'), join(stage, 'backend/package.json'));
await copyFile(join(root, 'package-lock.json'), join(stage, 'backend/package-lock.json'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run package:prepare');
const installed = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: join(stage, 'backend'), stdio: 'inherit', windowsHide: true,
});
if (installed.status !== 0) throw new Error('Backend dependency installation failed');
await copyFile(process.execPath, join(stage, 'runtime/node.exe'));
await writeFile(join(stage, 'runtime/VERSION.txt'), `${process.version}\n`);
// Node distribution includes third-party licensing in this official release source file.
const licenseFile = join(root, 'desktop/assets/Node-LICENSE');
await copyFile(licenseFile, join(stage, 'runtime/LICENSE'));
console.log('Bundled backend and Node runtime prepared.');
