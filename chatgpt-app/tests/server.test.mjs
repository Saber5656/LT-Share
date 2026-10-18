import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../server/mcp.js';
const uri = 'ui://lt-share/composer-v1.html';
const worker = createWorker('<html><body>widget</body></html>');
const post = (payload) => worker.fetch(new Request('https://example.test/mcp', {method:'POST',body:JSON.stringify(payload)}));
async function rpc(method, params, id = 1) { return (await post({jsonrpc:'2.0',id,method,params})).json(); }
test('entry and health expose no user state', async () => {
 const home = await worker.fetch(new Request('https://example.test/'));
 assert.match(await home.text(), /ChatGPT/);
 const health = await worker.fetch(new Request('https://example.test/health'));
 assert.deepEqual(await health.json(), {status:'ok'});
});
test('stateless discovery, legacy initialization and ping', async () => {
 for (const version of ['2026-07-28','2025-06-18']) {
 const result = (await rpc('initialize',{protocolVersion:version})).result;
 assert.equal(result.protocolVersion,version); assert.ok(result.capabilities.tools); assert.ok(result.capabilities.resources);
 }
 assert.deepEqual((await rpc('server/discover')).result,{protocolVersion:'2026-07-28',supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}},serverInfo:{name:'lt-share',version:'1.0.0'}});
 assert.equal((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
 assert.deepEqual((await rpc('ping')).result,{});
});
test('tool metadata binds both tools to the widget and declares no external effects', async () => {
 const {tools} = (await rpc('tools/list')).result;
 assert.deepEqual(tools.map(t=>t.name),['open_lt_share','render_lt_post']);
 for (const tool of tools) {
 assert.equal(tool.inputSchema.properties.tags.maxItems,12); assert.equal(tool.inputSchema.properties.tags.items.maxLength,80);
 assert.equal(tool._meta.ui.resourceUri,uri); assert.equal(tool._meta['openai/outputTemplate'],uri);
 assert.deepEqual(tool.annotations,{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false});
 }
 assert.match(tools[1].description,/100/); assert.equal(tools[1].inputSchema.properties.body.maxLength,2000);
});
test('drafts have unique UUIDs, defaults, no server state, and preserve correlation', async () => {
 const open = async (args={}) => (await rpc('tools/call',{name:'open_lt_share',arguments:args})).result.structuredContent;
 const a=await open(), b=await open({tags:['技術']});
 assert.match(a.draftId,/^[0-9a-f-]{36}$/); assert.notEqual(a.draftId,b.draftId);
 assert.deepEqual(a,{draftId:a.draftId,body:'',tags:[],includeDeveloper:false,requestId:null});
 const args={draftId:b.draftId,requestId:'req-1',body:'写真に発表スライドが見えます。',tags:b.tags,includeDeveloper:true};
 const rendered=(await rpc('tools/call',{name:'render_lt_post',arguments:args})).result;
 assert.deepEqual(rendered.structuredContent,{...args,kind:'lt-post'});
 assert.ok(rendered.content.some(item=>item.type==='text' && item.text.includes(args.body) && args.tags.every(tag=>item.text.includes(tag))));
});
test('resource listing and reading return the injected HTML and restricted CSP', async () => {
 const resource=(await rpc('resources/list')).result.resources[0];
 assert.equal(resource.uri,uri); assert.equal(resource.mimeType,'text/html;profile=mcp-app');
 const item=(await rpc('resources/read',{uri})).result.contents[0];
 assert.deepEqual(item._meta.ui.permissions,{camera:{},clipboardWrite:{}});
 assert.equal(item.text,'<html><body>widget</body></html>'); assert.equal(item._meta.ui.prefersBorder,true);
 assert.deepEqual(item._meta.ui.csp.resourceDomains,[]);
 assert.equal((await rpc('resources/read',{uri:'ui://other'})).error.code,-32602);
});
test('invalid tool arguments are tool errors, not RPC failures', async () => {
 for (const args of [null,[],{draftId:'x',body:'x',tags:'bad'},{draftId:'',body:'x',tags:[]},{draftId:'x',body:'x'.repeat(2001),tags:[]},{draftId:'x',body:'x',tags:Array(13).fill('x')},{draftId:'x',body:'x',tags:['x'.repeat(81)]},{draftId:'x',body:'x',tags:[],includeDeveloper:'yes'},{draftId:'x',body:'x',tags:[],requestId:23}]) {
 const result=await rpc('tools/call',{name:'render_lt_post',arguments:args}); assert.equal(result.result.isError,true); assert.equal(result.error,undefined);
 }
 assert.equal((await rpc('tools/call',{name:'open_lt_share',arguments:{tags:[1]}})).result.isError,true);
 assert.equal((await rpc('tools/call',{name:'missing'})).result.isError,true);
});
test('malformed envelopes, unknown methods, oversized and malformed JSON are bounded', async () => {
 for (const payload of [null,[],{jsonrpc:'1.0',id:1,method:'ping'},{jsonrpc:'2.0',id:{},method:'ping'}]) assert.equal((await (await post(payload)).json()).error.code,-32600);
 assert.equal((await rpc('missing')).error.code,-32601);
 const bad=await worker.fetch(new Request('https://example.test/mcp',{method:'POST',body:'{'})); assert.equal((await bad.json()).error.code,-32700);
 const large=await worker.fetch(new Request('https://example.test/mcp',{method:'POST',body:'あ'.repeat(22000)})); assert.equal(large.status,413);
 assert.equal((await worker.fetch(new Request('https://example.test/mcp'))).status,405);
 assert.equal((await worker.fetch(new Request('https://example.test/missing'))).status,404);
});
test('exact byte limit accepts valid JSON; streamed overflow cannot bypass the bound', async () => {
 const base=JSON.stringify({jsonrpc:'2.0',id:0,method:'ping'});
 const body=base+' '.repeat(65536-Buffer.byteLength(base));
 const response=await worker.fetch(new Request('https://example.test/mcp',{method:'POST',body}));
 assert.equal(response.status,200); assert.equal((await response.json()).id,0);
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(40000));controller.enqueue(new Uint8Array(30000));controller.close();}});
 const overflow=await worker.fetch(new Request('https://example.test/mcp',{method:'POST',body:stream,duplex:'half'}));
 assert.equal(overflow.status,413);
});
test('render accepts boundary values and supplies optional defaults without requiring a stored draft', async () => {
 const args={draftId:'d'.repeat(128),body:'文'.repeat(2000),tags:Array(12).fill('t'.repeat(80))};
 const result=await rpc('tools/call',{name:'render_lt_post',arguments:args},'correlation');
 assert.equal(result.id,'correlation');
 assert.deepEqual(result.result.structuredContent,{...args,kind:'lt-post',requestId:null,includeDeveloper:false});
 for (const extra of [{draftId:'d'.repeat(129)},{requestId:'r'.repeat(129)},{tags:['']},{unexpected:true}]) {
 assert.equal((await rpc('tools/call',{name:'render_lt_post',arguments:{...args,...extra}})).result.isError,true);
 }
});
