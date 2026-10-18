import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile('dist/server/index.js','utf8');const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));assert.equal(typeof mod.default.fetch,'function');assert.ok(JSON.parse(await readFile('dist/.openai/hosting.json','utf8')).capabilities.includes('mcp'));
const r=await mod.default.fetch(new Request('https://local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri:'ui://lt-share/composer-v1.html'}})}));const html=(await r.json()).result.contents[0].text;assert.ok(html.includes('ChatGPTに要約を依頼'));assert.ok(!/<script[^>]+src=/.test(html));console.log('Artifact validated: self-contained ESM, MCP UI');
