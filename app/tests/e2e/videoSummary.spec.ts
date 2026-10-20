import {test,expect,type Page} from '@playwright/test';
async function start(page:Page){
 await page.addInitScript(()=>localStorage.setItem('lt-share:welcome-seen','1'));
 await page.route('**/api/ai/status',r=>r.fulfill({json:{available:true,provider:'cloudflare',model:'vision'}}));
 await page.goto('/');
 await expect(page.getByRole('button',{name:'接続を再確認'})).toBeVisible();
}
async function clip(page:Page,blackOnly=false){
 const bytes=await page.evaluate(async blackOnly=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
  const ctx=canvas.getContext('2d')!,stream=canvas.captureStream(15);
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks:Blob[]=[];
  recorder.ondataavailable=e=>chunks.push(e.data);
  const done=new Promise<void>(resolve=>{recorder.onstop=()=>resolve();});
  recorder.start();
  for(const [color,delay] of [['black',1200],[blackOnly?'black':'lime',850],[blackOnly?'black':'yellow',850]] as const){
   ctx.fillStyle=color;ctx.fillRect(0,0,320,180);
   const draw=setInterval(()=>ctx.fillRect(0,0,320,180),50);
   await new Promise(resolve=>setTimeout(resolve,delay));clearInterval(draw);
  }
  recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
  return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
 },blackOnly);
 return {name:'black-then-slides.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)};
}
test('video starting black sends later and end slides in one bounded JPEG',async({page})=>{
 let uploaded:Buffer|undefined;
 await page.route('**/api/summary',async r=>{
  const form=await new Request('https://test.invalid',{method:'POST',headers:{'content-type':r.request().headers()['content-type']!},body:new Uint8Array(r.request().postDataBuffer()!)}).formData();
  const image=form.get('image') as File;expect(image.type).toBe('image/jpeg');expect(image.size).toBeLessThanOrEqual(3*1024*1024);
  uploaded=Buffer.from(await image.arrayBuffer());await r.fulfill({json:{text:'動画全体の要約'}});
 });
 await start(page);
 const file=await clip(page);
 await page.evaluate(()=>{
  const labels:string[]=[];Object.assign(window,{videoSheetLabels:labels});
  const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,maxWidth){labels.push(text);if(maxWidth===undefined)original.call(this,text,x,y);else original.call(this,text,x,y,maxWidth);};
 });
 await page.getByTestId('pick-video').setInputFiles(file);
 await expect(page.getByRole('textbox',{name:'投稿文',exact:true})).toHaveValue('動画全体の要約');
 const stats=await page.evaluate(async bytes=>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let green=0,yellow=0;
  for(let i=0;i<data.length;i+=4){if(data[i]!<80&&data[i+1]!>160&&data[i+2]!<80)green++;if(data[i]!>160&&data[i+1]!>160&&data[i+2]!<80)yellow++;}
  return {green,yellow,width:canvas.width,height:canvas.height};
 },Array.from(uploaded!));
 expect(stats.green).toBeGreaterThan(1000);expect(stats.yellow).toBeGreaterThan(1000);
 expect(stats.width).toBe(640);expect(stats.height).toBe(208);
 const labels=await page.evaluate(()=>(window as unknown as {videoSheetLabels:string[]}).videoSheetLabels);
 expect(labels).toHaveLength(2);expect(labels[0]).toMatch(/^1  0:01\./);expect(labels[1]).toMatch(/^2  0:02\./);
});
test('all-black video fails without uploading or inventing text',async({page})=>{
 let requests=0;await page.route('**/api/summary',r=>{requests++;return r.fulfill({json:{text:'invented'}});});
 await start(page);await page.getByTestId('pick-video').setInputFiles(await clip(page,true));
 await expect(page.getByRole('alert')).toBeVisible();expect(requests).toBe(0);
 await expect(page.getByRole('textbox',{name:'投稿文',exact:true})).toHaveValue('');
});
test('cancel during video loading never uploads and keeps manual text',async({page})=>{
 let requests=0;await page.route('**/api/summary',r=>{requests++;return r.fulfill({json:{text:'late'}});});
 await start(page);const file=await clip(page);
 await page.evaluate(()=>{
  const original=document.createElement.bind(document);
  document.createElement=((tag:string,options?:ElementCreationOptions)=>{
   const element=original(tag,options);
   if(tag==='video')element.addEventListener('loadeddata',e=>e.stopImmediatePropagation(),{capture:true});
   return element;
  }) as typeof document.createElement;
 });
 await page.getByTestId('pick-video').setInputFiles(file);
 await page.getByRole('button',{name:'生成を中止'}).click();
 await page.getByRole('textbox',{name:'投稿文',exact:true}).fill('手入力');
 await expect(page.getByRole('button',{name:'生成を中止'})).toBeHidden();
 await expect(page.getByRole('textbox',{name:'投稿文',exact:true})).toHaveValue('手入力');expect(requests).toBe(0);
});
