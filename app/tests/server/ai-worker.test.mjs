import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../../server/ai-worker.mjs';
const env={LT_AI_ENDPOINT:'https://lt-share-ai.example.workers.dev/summary',LT_AI_SERVICE_TOKEN:'test-secret',LT_AI_FREE_TIER_CONFIRMED:'true'};
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0]);
function request({bytes=png,type='image/png',tags,headers={},...options}={}) {
 const body=new FormData();body.set('image',new Blob([bytes],{type}),'slide.png');
 if(tags!==undefined)body.set('tags',tags);
 return new Request('https://lt.example/api/summary',{method:'POST',body,headers:{'oai-authenticated-user-id':'user','X-LT-Share-Request':'summary-v1',...headers},...options});
}
const result=(value={text:'画面に表示された技術の説明です。'})=>Response.json(value);
function fixture(response=()=>result(),options={}){const calls=[];return {calls,worker:createWorker({}, {fetch:async(...args)=>{calls.push(args);return response(...args);},...options})};}
test('status requires explicit free tier and key; never leaks configuration secrets',async()=>{
 for(const [config,available,reason] of [[{},false,'missing_endpoint'],[{...env,LT_AI_FREE_TIER_CONFIRMED:'false'},false,'free_tier_not_confirmed'],[env,true,null],[{...env,LT_AI_PROVIDER:'evil'},false,'unsupported_provider']]){
 const r=await createWorker({}, {fetch:async()=>Response.json({available:true})}).fetch(new Request('https://lt.example/api/ai/status'),config);const data=await r.json();assert.equal(data.available,available);assert.equal(data.reason,reason);assert.ok(!JSON.stringify(data).includes('test-secret'));}
});
test('authentication and CSRF block provider invocation',async()=>{const {worker,calls}=fixture();for(const headers of [{'oai-authenticated-user-id':''},{'X-LT-Share-Request':''},{Origin:'https://evil.example'},{Origin:'null'}]){const r=await worker.fetch(request({headers}),env);assert.ok([401,403].includes(r.status));}assert.equal(calls.length,0);});
test('unconfigured summary is unavailable',async()=>{const {worker,calls}=fixture();assert.equal((await worker.fetch(request(),{})).status,503);assert.equal(calls.length,0);});
test('bridge sends only validated bytes to configured HTTPS worker without redirects',async()=>{
 const {worker,calls}=fixture();const r=await worker.fetch(request({tags:'["技術"]',headers:{Origin:'https://lt.example'}}),env);
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{text:'画面に表示された技術の説明です。'});
 const [url,init]=calls[0];assert.equal(url,env.LT_AI_ENDPOINT);assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer test-secret');assert.equal(init.headers['Content-Type'],'image/png');assert.deepEqual(init.body,png);
});
test('invalid endpoints and missing bridge secret fail closed',async()=>{
 for(const endpoint of ['http://example.workers.dev/summary','https://evil.example/summary','https://example.workers.dev/summary?token=secret','https://user:pass@example.workers.dev/summary','https://example.workers.dev/other']){
 const {worker,calls}=fixture();assert.equal((await worker.fetch(request(),{...env,LT_AI_ENDPOINT:endpoint})).status,503);assert.equal(calls.length,0);}
 const {worker,calls}=fixture();assert.equal((await worker.fetch(request(),{...env,LT_AI_SERVICE_TOKEN:''})).status,503);assert.equal(calls.length,0);
});
test('invalid multipart, image magic, empty and oversized images and tags rejected locally',async()=>{const {worker,calls}=fixture();for(const opts of [{bytes:new Uint8Array()},{bytes:'<svg/>',type:'image/png'},{type:'image/svg+xml'},{bytes:new Uint8Array(3*1024*1024+1)},{tags:'{}'},{tags:'oops'},{tags:JSON.stringify(Array(13).fill('a'))},{tags:JSON.stringify(['a'.repeat(81)])},{tags:'[1]'}])assert.ok([400,413,415].includes((await worker.fetch(request(opts),env)).status));assert.equal((await worker.fetch(new Request('https://lt.example/api/summary',{method:'POST',headers:{'oai-authenticated-user-id':'u','X-LT-Share-Request':'summary-v1','content-type':'multipart/form-data'},body:'bad'}),env)).status,400);assert.equal(calls.length,0);});
test('stream limit ignores understated Content-Length and cancels body',async()=>{let cancelled=false;let chunks=0;const body=new ReadableStream({pull(c){chunks++;c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});const req=new Request('https://lt.example/api/summary',{method:'POST',duplex:'half',body,headers:{'oai-authenticated-user-id':'u','X-LT-Share-Request':'summary-v1','content-type':'multipart/form-data; boundary=x','content-length':'1'}});const {worker,calls}=fixture();assert.equal((await worker.fetch(req,env)).status,413);assert.ok(cancelled);assert.ok(chunks<=6);assert.equal(calls.length,0);});
test('valid jpeg/webp accepted; MIME mismatch rejected',async()=>{const {worker}=fixture();for(const [bytes,type] of [[Uint8Array.from([255,216,255,224]),'image/jpeg'],[new TextEncoder().encode('RIFFxxxxWEBPVP8 '),'image/webp']])assert.equal((await worker.fetch(request({bytes,type}),env)).status,200);assert.equal((await worker.fetch(request({type:'image/jpeg'}),env)).status,415);});
test('invalid bridge results fail without exposing raw data',async()=>{for(const value of [{text:''},{text:' '},{text:'😀'.repeat(141)},{summary:'a'},{}]){const {worker}=fixture(()=>result(value));assert.equal((await worker.fetch(request(),env)).status,502);}const {worker}=fixture(()=>new Response('provider-secret'));const r=await worker.fetch(request(),env);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('provider-secret'));});
test('unicode cap counts codepoints; output remains JSON text',async()=>{const {worker}=fixture(()=>result({text:'😀'.repeat(140)}));assert.equal((await worker.fetch(request(),env)).status,200);});
test('provider errors mapped safely without retry',async()=>{for(const [upstream,status,code] of [[422,422,'unreadable'],[504,504,'timeout'],[503,503,'unavailable'],[429,429,'quota'],[401,503,'unavailable'],[403,503,'unavailable'],[500,502,'provider_error']]){const {worker,calls}=fixture(()=>new Response('test-secret upstream-private',{status:upstream}));const r=await worker.fetch(request(),env);assert.equal(r.status,status);assert.equal((await r.json()).code,code);assert.equal(calls.length,1);}});
test('network and timeout failures are safe and never retried',async()=>{const f=fixture(()=>{throw Error('test-secret');});assert.equal((await f.worker.fetch(request(),env)).status,502);assert.equal(f.calls.length,1);const t=fixture(()=>new Promise(()=>{}),{timeoutMs:5});assert.equal((await t.worker.fetch(request(),env)).status,504);assert.equal(t.calls.length,1);assert.ok(t.calls[0][1].signal.aborted);});
test('static bytes and strict SPA fallback; unknown API never falls back or fetches',async()=>{let calls=0;const worker=createWorker({'/index.html':{mime:'text/html',base64:btoa('SPA')},'/a.bin':{mime:'application/octet-stream',base64:btoa('\x00\xff')}},{fetch:()=>{calls++;throw Error();}});const r=await worker.fetch(new Request('https://lt.example/a.bin?v=1'),{});assert.deepEqual(new Uint8Array(await r.arrayBuffer()),Uint8Array.from([0,255]));assert.equal(await (await worker.fetch(new Request('https://lt.example/page',{headers:{accept:'text/html'}}),{})).text(),'SPA');for(const [path,options] of [['/missing.js',{}],['/api/nope',{headers:{accept:'text/html'}}],['/api',{headers:{accept:'text/html'}}],['/page',{}],['/page',{method:'POST',headers:{accept:'text/html'}}]])assert.ok((await worker.fetch(new Request('https://lt.example'+path,options),{})).status>=400);assert.equal(calls,0);});
test('malformed provider JSON, oversized body, and slow response body fail safely',async()=>{
 for(const response of [()=>Response.json({choices:[{message:{content:'not JSON private'}}]}),()=>Response.json({choices:[]}),()=>new Response('x'.repeat(65537))]){const {worker,calls}=fixture(response);assert.equal((await worker.fetch(request(),env)).status,502);assert.equal(calls.length,1);}
 let cancelled=false;
 const {worker}=fixture((_url,init)=>new Response(new ReadableStream({start(c){init.signal.addEventListener('abort',()=>{cancelled=true;c.error(Error('abort'));});}})),{timeoutMs:5});
 assert.equal((await worker.fetch(request(),env)).status,504);assert.ok(cancelled);
});
test('multipart duplicate fields and non-file images rejected',async()=>{
 const {worker,calls}=fixture();
 for(const field of ['image','tags']){const req=request({tags:'[]'});const data=await req.formData();data.append(field,field==='image'?new Blob([png],{type:'image/png'}):'[]');const r=await worker.fetch(new Request(req.url,{method:'POST',headers:{'oai-authenticated-user-id':'u','X-LT-Share-Request':'summary-v1'},body:data}),env);assert.equal(r.status,400);}
 assert.equal(calls.length,0);
});
test('HTML q=0 cannot trigger SPA; prototype names are not assets; API methods isolated',async()=>{
 const worker=createWorker({'/index.html':{mime:'text/html',base64:btoa('SPA')}});
 assert.equal((await worker.fetch(new Request('https://lt.example/page',{headers:{accept:'text/html;q=0'}}))).status,404);
 assert.equal((await worker.fetch(new Request('https://lt.example/toString'))).status,404);
 assert.equal((await worker.fetch(new Request('https://lt.example/api/summary'))).status,405);
});

test('status checks authenticated bridge health without inference and fails closed',async()=>{
 for(const status of [401,403,503]) {const {worker,calls}=fixture(()=>new Response('private',{status}));const r=await worker.fetch(new Request('https://lt.example/api/ai/status'),env);assert.equal((await r.json()).available,false);assert.equal(calls[0][0],'https://lt-share-ai.example.workers.dev/health');assert.equal(calls[0][1].headers.Authorization,'Bearer test-secret');assert.equal(calls[0][1].method,'GET');}
 const {worker}=fixture(()=>Response.json({available:true}));assert.equal((await (await worker.fetch(new Request('https://lt.example/api/ai/status'),env)).json()).available,true);
 const {worker:slow}=fixture(()=>new Promise(()=>{}),{timeoutMs:5});assert.equal((await (await slow.fetch(new Request('https://lt.example/api/ai/status'),env)).json()).available,false);
});
