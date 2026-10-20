import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBridge} from '../web/bridge.js';
function host(){let listener;const sent=[];const parent={postMessage:m=>sent.push(m)};const w={parent,addEventListener:(_n,l)=>listener=l,removeEventListener(){}};return {w,sent,receive:m=>listener({source:parent,data:m}),forge:m=>listener({source:{},data:m})};}
test('ignores forged messages and correlates real parent response',async()=>{const h=host();const b=createBridge(h.w);const p=b.request('ui/open-link',{url:'https://x.com'});h.forge({jsonrpc:'2.0',id:h.sent[0].id,result:{ok:false}});h.receive({jsonrpc:'2.0',id:h.sent[0].id,result:{ok:true}});assert.deepEqual(await p,{ok:true});b.close();});
test('initializes standard bridge before becoming ready',async()=>{const h=host();const b=createBridge(h.w);const p=b.connect();assert.equal(h.sent[0].method,'ui/initialize');h.receive({jsonrpc:'2.0',id:h.sent[0].id,result:{hostContext:{theme:'dark'}}});await p;assert.equal(b.ready,true);assert.equal(h.sent[1].method,'ui/notifications/initialized');b.close();});
test('host errors are failures and no silent follow-up retry',async()=>{const h=host();const b=createBridge(h.w);const p=b.request('ui/message',{});h.receive({jsonrpc:'2.0',id:h.sent[0].id,error:{message:'denied'}});await assert.rejects(p,/denied/);assert.equal(h.sent.length,1);b.close();});

test('successful RPC with isError marks host refusal',async()=>{const h=host();const b=createBridge(h.w);const p=b.request('ui/message',{});h.receive({jsonrpc:'2.0',id:h.sent[0].id,result:{isError:true}});await assert.rejects(p);b.close();});
