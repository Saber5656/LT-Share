import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareWorker} from '../../server/cloudflare-ai.mjs';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0]);
const req=(headers={},body=png)=>new Request('https://lt-share-ai.example.workers.dev/summary',{method:'POST',headers:{Authorization:'Bearer test-secret','Content-Type':'image/png',...headers},body});
const result=(value={summary:'画面の技術について説明するLT。',readable:true})=>({choices:[{message:{content:JSON.stringify(value)}}]});
function setup(run=async()=>result(),options={}) {const calls=[];return {calls,worker:createCloudflareWorker(options),env:{LT_AI_SERVICE_TOKEN:'test-secret',LT_AI_FREE_TIER_CONFIRMED:'true',AI:{run(...args){calls.push(args);return run(...args);}}}};}
test('requires bridge secret and confirmed free tier before calling AI',async()=>{
 const {worker,env,calls}=setup();
 for(const headers of [{Authorization:''},{Authorization:'Bearer wrong'},{Authorization:'Bearer test-secret-more'}])assert.equal((await worker.fetch(req(headers),env)).status,401);
 assert.equal((await worker.fetch(req(),{...env,LT_AI_FREE_TIER_CONFIRMED:'false'})).status,503);
 assert.equal((await worker.fetch(req(),{...env,LT_AI_SERVICE_TOKEN:''})).status,503);
 assert.equal(calls.length,0);
});
test('runs fixed vision model with image bytes, bounded output and factual JSON prompt',async()=>{
 const {worker,env,calls}=setup();const r=await worker.fetch(req(),env);assert.equal(r.status,200);assert.deepEqual(await r.json(),{text:'画面の技術について説明するLT。'});
 assert.equal(calls.length,1);const [model,input]=calls[0];assert.equal(model,'@cf/qwen/qwen3.8-27b');assert.ok(input.max_completion_tokens<=700);assert.deepEqual(input.response_format,{type:'json_object'});
 assert.match(input.messages[0].content,/画像.*指示/);assert.match(input.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);assert.equal(JSON.stringify(input).includes('test-secret'),false);
});
test('rejects image spoofing, oversized streams, unknown routes and methods',async()=>{
 const {worker,env,calls}=setup();assert.equal((await worker.fetch(req({'Content-Type':'image/jpeg'}),env)).status,415);
 assert.equal((await worker.fetch(req({},new Uint8Array()),env)).status,415);
 assert.equal((await worker.fetch(req({},new Uint8Array(3*1024*1024+1)),env)).status,413);
 assert.equal((await worker.fetch(new Request('https://worker.example/nope'),env)).status,404);
 assert.equal((await worker.fetch(new Request('https://worker.example/summary'),env)).status,405);assert.equal(calls.length,0);
});
test('unreadable, malformed, and excessive results are rejected',async()=>{
 for(const [value,status] of [[{summary:'',readable:false},422],[{summary:'',readable:true},502],[{summary:'x'.repeat(141),readable:true},502],[{summary:'x',readable:'yes'},502],[{},502]]){
 const {worker,env}=setup(async()=>result(value));assert.equal((await worker.fetch(req(),env)).status,status);}
});
test('maps free quota, unavailable paid model and provider failure without retries or secrets',async()=>{
 for(const [message,status] of [['3036: daily free allocation exhausted',429],['3040: capacity',429],['5035: paid plan required',503],['5018: permission denied',503],['private provider message',502]]){
 const {worker,env,calls}=setup(async()=>{throw Error(message)});const r=await worker.fetch(req(),env);assert.equal(r.status,status);assert.ok(!(await r.text()).includes(message));assert.equal(calls.length,1);}
});
test('timeout bounds wait without retrying',async()=>{const {worker,env,calls}=setup(()=>new Promise(()=>{}),{timeoutMs:5});assert.equal((await worker.fetch(req(),env)).status,504);assert.equal(calls.length,1);assert.ok(calls[0][2].signal.aborted);});

test('health checks authorization and configuration without consuming AI',async()=>{const {worker,env,calls}=setup();const url='https://worker.example/health';assert.equal((await worker.fetch(new Request(url),env)).status,401);assert.deepEqual(await (await worker.fetch(new Request(url,{headers:{Authorization:'Bearer test-secret'}}),env)).json(),{available:true});assert.equal(calls.length,0);});
test('deadline stays a timeout when AI rejects synchronously on abort',async()=>{
 const {worker,env,calls}=setup((_model,_input,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));}),{timeoutMs:5});
 const r=await worker.fetch(req(),env);assert.equal(r.status,504);assert.deepEqual(await r.json(),{code:'timeout'});assert.ok(calls[0][2].signal.aborted);assert.equal(calls.length,1);
});
