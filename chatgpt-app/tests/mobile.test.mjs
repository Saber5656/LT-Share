import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../server/mcp.js';
import * as model from '../web/model.js';

const worker=createWorker('<html><body>mobile editor</body></html>');
const draft={body:'青い画面に「RESET」ボタン。\n写真からの投稿案です。',tags:['LT','イベント'],includeDeveloper:true};
async function call(name,args){return (await (await worker.fetch(new Request('https://example.test/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}))).json()).result;}

test('phone link opens the real editor and keeps the draft in its fragment',async()=>{
  const result=await call('render_lt_post',{draftId:'phone-draft',...draft});
  const link=new URL(result.structuredContent.editorUrl);
  assert.equal(link.origin,'https://example.test');
  assert.equal(link.pathname,'/');assert.equal(link.search,'');
  assert.deepEqual(JSON.parse(new URLSearchParams(link.hash.slice(1)).get('draft')),draft);
  assert.ok(result.content.some(item=>item.text?.includes(link.href)));
  const response=await worker.fetch(new Request(link.origin+'/'));
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.equal(await response.text(),'<html><body>mobile editor</body></html>');
});
test('phone draft import preserves Japanese text, tags and developer choice',()=>{
  assert.equal(typeof model.parseMobileDraft,'function');
  const hash='#'+new URLSearchParams({draft:JSON.stringify(draft)});
  assert.deepEqual(model.parseMobileDraft(hash),draft);
  const html={...draft,body:'<script>alert(1)</script> & 日本語'};
  assert.equal(model.parseMobileDraft('#'+new URLSearchParams({draft:JSON.stringify(html)})).body,html.body);
});
test('invalid and excessive phone links never populate an editor',()=>{
  assert.equal(typeof model.parseMobileDraft,'function');
  const bad=['', '#draft=%', '#draft=null', '#draft=[]', '#draft={', '#draft='+ 'a'.repeat(64001)];
  for(const value of [null,[],{}, {...draft,body:4},{...draft,body:'x'.repeat(2001)},{...draft,tags:Array(13).fill('x')},{...draft,tags:['x'.repeat(81)]},{...draft,includeDeveloper:'yes'},{...draft,unexpected:true}])bad.push('#'+new URLSearchParams({draft:JSON.stringify(value)}));
  for(const hash of bad)assert.equal(model.parseMobileDraft(hash),null);
});
test('blank editor links remain editable without fabricating a summary',async()=>{
  const result=await call('open_lt_share',{});
  const url=new URL(result.structuredContent.editorUrl);
  const imported=model.parseMobileDraft(url.hash);
  assert.deepEqual(imported,{body:'',tags:[],includeDeveloper:false});
});
test('X receives edited text and tags through a native HTTPS composer link',()=>{
  const edited={...draft,body:'編集した本文 & <写真> 😀'};
  const text=model.composePost(edited),link=new URL(model.xIntentUrl(text));
  assert.equal(link.origin,'https://x.com');assert.equal(link.pathname,'/intent/tweet');
  assert.equal(link.searchParams.get('text'),'編集した本文 & <写真> 😀\n\n#LT #イベント\n\n開発者：');
});
