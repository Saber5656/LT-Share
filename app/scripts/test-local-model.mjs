// Opt-in real model check. Downloads ~0.9GB once into an isolated browser profile.
// Run with the dev server on LT_LOCAL_AI_URL (default port 4396).
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.LT_LOCAL_AI_URL || 'http://127.0.0.1:4396';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Local QA server required');
await mkdir('.local-ai-qa',{recursive:true});
const context = await chromium.launchPersistentContext(resolve('.local-ai-qa/profile'), {channel:'chrome',headless:true,viewport:{width:390,height:844}});
const page = await context.newPage();
const requests=[]; const errors=[];
page.on('request',r=>requests.push({method:r.method(),url:r.url().split('?')[0]}));
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  // Isolate real Worker inference from Vite HMR reloads while app UI is edited.
  await page.route('**/__local-model-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>LT Share local model QA</title>'}));
  await page.goto(base+'/__local-model-qa');
  const hardware=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter();return {userAgent:navigator.userAgent,gpu:!!a,features:a?[...a.features]:[],vendor:a?.info?.vendor,architecture:a?.info?.architecture};});
  console.log(JSON.stringify({step:'hardware',...hardware}));
  if(!hardware.gpu || !hardware.features.includes('shader-f16')) throw new Error('WebGPU/f16 unavailable in this QA browser');
  await page.evaluate(()=>{
    const worker=new Worker('/src/lib/localAi/worker.ts',{type:'module'});
    window.ltLocalQa={worker,progress:0,messages:[],loadedAt:null};
    worker.addEventListener('message',e=>{const s=window.ltLocalQa;s.messages.push(e.data);if(e.data.type==='progress')s.progress=e.data.progress;if(e.data.type==='loaded')s.loadedAt=performance.now();});
    worker.addEventListener('error',e=>window.ltLocalQa.messages.push({type:'crash',message:e.message}));
    window.ltLocalQa.startedAt=performance.now();worker.postMessage({type:'load',id:1});
  });
  let last=-1;
  const monitor=setInterval(async()=>{try{const p=await page.evaluate(()=>Math.floor(window.ltLocalQa.progress*100));if(p!==last){last=p;console.log(JSON.stringify({step:'loading',percent:p}));}}catch{}},10000);
  try{await page.waitForFunction(()=>window.ltLocalQa.messages.some(m=>['loaded','error','crash'].includes(m.type)),{},{timeout:600000});}finally{clearInterval(monitor);}
  const loaded=await page.evaluate(()=>({messages:window.ltLocalQa.messages.filter(m=>m.type!=='progress'),loadMs:window.ltLocalQa.loadedAt-window.ltLocalQa.startedAt}));
  console.log(JSON.stringify({step:'load',...loaded}));
  if(!loaded.messages.some(m=>m.type==='loaded'))throw new Error('Model load failed');
  const bytes=[...await readFile('tests/fixtures/lt-photo.jpg')];
  const result=await page.evaluate(async bytes=>{
    const s=window.ltLocalQa;
    const run=(image,id)=>new Promise(resolve=>{const start=performance.now();const listener=e=>{if(e.data.id===id&&['result','error'].includes(e.data.type)){s.worker.removeEventListener('message',listener);resolve({...e.data,durationMs:performance.now()-start});}};s.worker.addEventListener('message',listener);s.worker.postMessage({type:'generate',id,image});});
    const photo=await run(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}),2);
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,640,360);
    const blank=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
    return {photo,blank:await run(blank,3)};
  },bytes);
  const report={hardware,...loaded,...result,errors,requests};
  await writeFile('.local-ai-qa/result.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({step:'inference',...result,errors,nonGetRequests:requests.filter(r=>r.method!=='GET')}));
  if(result.photo.type!=='result'||!result.photo.text)throw new Error('Photo inference failed');
  if(result.blank.type!=='error'||result.blank.code!=='unreadable')throw new Error('Blank image was not rejected');
  if(requests.some(r=>r.method!=='GET'))throw new Error('Unexpected outbound upload');
} catch(error) {
  await writeFile('.local-ai-qa/failure.json',JSON.stringify({message:String(error),errors,requests},null,2)+'\n');
  throw error;
} finally { await context.close(); }
