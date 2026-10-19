import {readFile,writeFile,mkdir,readdir,stat,rm} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const clientRoot=resolve('dist'), assets={};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.json':'application/json','.ico':'image/x-icon'};
async function collect(dir){for(const name of await readdir(dir)){const path=resolve(dir,name);if((await stat(path)).isDirectory())await collect(path);else assets['/'+relative(clientRoot,path).split('\\').join('/')]={mime:mime[extname(name)]||'application/octet-stream',base64:(await readFile(path)).toString('base64')};}}
await collect(clientRoot);
if(!assets['/index.html'])throw new Error('Build frontend first');
const server=await readFile('server/ai-worker.mjs','utf8');const worker=server+'\nexport default createWorker('+JSON.stringify(assets)+');\n';
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));if(manifest.static)throw new Error('Worker manifest must not have static');
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js',worker);await writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Built Worker with '+Object.keys(assets).length+' self-contained assets');
