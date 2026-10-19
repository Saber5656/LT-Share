import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpAiProvider,loadAiStatus,AiQuotaError} from '../../src/lib/ai.ts';
const photo=new Blob(['photo'],{type:'image/jpeg'});
test('provider sends photo to own origin and reads actual text',async()=>{let seen:RequestInit|undefined;const p=createHttpAiProvider(async(url,init)=>{assert.equal(url,'/api/summary');seen=init;return new Response(JSON.stringify({text:'写真の内容。'}));});assert.equal(await p.generate({image:photo,tags:['#LT']}),'写真の内容。');assert.equal((seen?.headers as Record<string,string>)['X-LT-Share-Request'],'summary-v1');assert.ok(seen?.body instanceof FormData);});
test('quota is typed, unavailable and empty results never produce fake text',async()=>{const q=createHttpAiProvider(async()=>new Response('{}',{status:429}));await assert.rejects(q.generate({image:photo,tags:[]}),AiQuotaError);const p=createHttpAiProvider(async()=>new Response(JSON.stringify({text:''})));await assert.rejects(p.generate({image:photo,tags:[]}));});
test('status fails closed unless server confirms actual availability',async()=>{assert.equal((await loadAiStatus(async()=>new Response('<html>fallback</html>'))).available,false);assert.equal((await loadAiStatus(async()=>new Response(JSON.stringify({available:true,provider:'groq'})))).available,true);});
