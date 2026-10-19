import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const js=await readFile('dist/server/index.js','utf8');const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const manifest=JSON.parse(await readFile('dist/.openai/hosting.json','utf8'));assert.ok(manifest.project_id);assert.ok(!manifest.static);
const page=await worker.fetch(new Request('https://local/',{headers:{Accept:'text/html'}}));assert.equal(page.status,200);assert.match(await page.text(),/LT Share/);
const status=await worker.fetch(new Request('https://local/api/ai/status'));assert.equal((await status.json()).available,false);
console.log('Worker ESM, frontend and disabled-until-configured API validated');
