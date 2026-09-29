import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const env = { ...process.env };
const tools = resolve(import.meta.dirname, '../../work/package-tools');
// Prefer locally verified tools when present; otherwise builder uses its official downloads.
if (existsSync(`${tools}/nsis-3.0.4.1/Bin/makensis.exe`)) env.ELECTRON_BUILDER_NSIS_DIR = `${tools}/nsis-3.0.4.1`;
if (existsSync(`${tools}/nsis-resources-3.4.1/plugins`)) env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = `${tools}/nsis-resources-3.4.1`;
const child = spawn(process.execPath, ['node_modules/electron-builder/cli.js', '--config', 'electron-builder.json', '--win'], { env, stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
