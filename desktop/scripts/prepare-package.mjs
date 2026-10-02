import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'../..');
const profile=process.argv.find(a=>a.startsWith('--profile='))?.slice(10)||'lite';
if(!['lite','full'].includes(profile))throw new Error('Profile must be lite or full');
const stage=join(root,'desktop/package-resources');const backend=join(stage,'backend');
// Only remove the known generated backend: full dependencies must not leak into the next lite build.
if(resolve(backend)!==join(root,'desktop/package-resources/backend')||!backend.startsWith(root+sep))throw new Error('Unsafe staging path');
await rm(backend,{recursive:true,force:true});
await mkdir(join(backend,'server'),{recursive:true});await mkdir(join(stage,'runtime'),{recursive:true});
await build({entryPoints:[join(root,'server/desktop-entry.ts')],outfile:join(backend,'server/index.mjs'),bundle:true,packages:'external',platform:'node',target:'node24',format:'esm'});
for(const file of ['harness-plugin.mjs','agenda-tool-definitions.json','personal-tool-definitions.json'])await copyFile(join(root,'server',file),join(backend,'server',file));
await writeFile(join(backend,'server/build-profile.json'),JSON.stringify({profile,harness:profile==='full',officeConversion:false}));
await copyFile(join(root,profile==='lite'?'desktop/backend-lite.package.json':'package.json'),join(backend,'package.json'));
await copyFile(join(root,profile==='lite'?'desktop/backend-lite.package-lock.json':'package-lock.json'),join(backend,'package-lock.json'));
const npmCli=process.env.npm_execpath;if(!npmCli)throw new Error('Run with npm run package:prepare');
const installed=spawnSync(process.execPath,[npmCli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:backend,stdio:'inherit',windowsHide:true});
if(installed.status!==0)throw new Error('Backend dependency installation failed');
if(profile==='full'){
  // This optional Office engine is not exposed by our butler tools; test sdk-minimal after trimming.
  const office=join(backend,'node_modules/@deepseek-ai/libreoffice-kit-win32-x64');
  if(!resolve(office).startsWith(backend+sep))throw new Error('Unsafe component path');
  await rm(office,{recursive:true,force:true});
}
let mapsRemoved=0;
async function trimMaps(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())await trimMaps(file);else if(entry.isFile()&&entry.name.endsWith('.map')){await rm(file);mapsRemoved++;}}}
await trimMaps(join(backend,'node_modules'));
await copyFile(join(root,'LICENSE'),join(backend,'LICENSE'));
await copyFile(process.execPath,join(stage,'runtime/node.exe'));
await writeFile(join(stage,'runtime/VERSION.txt'),`${process.version}\n`);
await copyFile(join(root,'desktop/assets/Node-LICENSE'),join(stage,'runtime/LICENSE'));
await writeFile(join(stage,'build-profile.json'),JSON.stringify({profile,harness:profile==='full',officeConversion:false,mapsRemoved},null,2));
console.log(`Prepared ${profile} backend; removed ${mapsRemoved} debug maps; licenses retained.`);
