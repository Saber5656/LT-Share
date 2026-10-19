import {test,expect,type Page,type Route} from '@playwright/test';
const image='tests/fixtures/lt-photo.jpg';
const body=(page:Page)=>page.getByRole('textbox',{name:'投稿文',exact:true});
async function start(page:Page,available=true){
 await page.addInitScript(()=>localStorage.setItem('lt-share:welcome-seen','1'));
 await page.route('**/api/ai/status',r=>r.fulfill({json:{available,provider:'cloudflare',model:'vision'}}));
 await page.goto('/');await expect(page.getByLabel('写真から自動で投稿文をつくる')).toBeVisible();
}
test('automatic server summary without preparation or model downloads',async({page})=>{
 const downloads:string[]=[];page.on('request',r=>{if(/huggingface|\.onnx|\.wasm/.test(r.url()))downloads.push(r.url());});
 await page.route('**/api/summary',async r=>{expect(r.request().headers()['x-lt-share-request']).toBe('summary-v1');expect(r.request().headers()['content-type']).toContain('multipart/form-data');await r.fulfill({json:{text:'サーバーの要約'}});});
 await start(page);await page.getByTestId('pick-photo').setInputFiles(image);await expect(body(page)).toHaveValue('サーバーの要約');expect(downloads).toEqual([]);await expect(page.getByText(/0.9GB|端末内AI|準備中/)).toHaveCount(0);
});
for(const clear of [false,true])test(`editing survives late result clear=${clear}`,async({page})=>{
 let pending:Route|undefined;await page.route('**/api/summary',r=>{pending=r;});await start(page);await page.getByTestId('pick-photo').setInputFiles(image);await expect.poll(()=>!!pending).toBe(true);await body(page).fill('自分の文章');if(clear)await body(page).fill('');await pending!.fulfill({json:{text:'遅い結果'}});await expect(page.getByRole('button',{name:'生成を中止'})).toBeHidden();await expect(body(page)).toHaveValue(clear?'':'自分の文章');
});
test('unavailable remains manual and connection can be rechecked',async({page})=>{await start(page,false);await expect(page.getByText(/サーバー要約を利用できません/)).toBeVisible();await body(page).fill('手入力');await page.route('**/api/ai/status',r=>r.fulfill({json:{available:true,provider:'cloudflare',model:'vision'}}));await page.getByRole('button',{name:'接続を再確認'}).click();await expect(page.getByText('要約サーバーに接続しました。',{exact:true})).toBeVisible();await expect(body(page)).toHaveValue('手入力');});
test('cancel ignores response and explicit retry needs no preparation',async({page})=>{let pending:Route|undefined;await page.route('**/api/summary',r=>{pending=r;});await start(page);await page.getByTestId('pick-photo').setInputFiles(image);await expect.poll(()=>!!pending).toBe(true);await page.getByRole('button',{name:'生成を中止'}).click();await pending!.fulfill({json:{text:'中止後'}}).catch(()=>{});await expect(body(page)).toHaveValue('');await page.route('**/api/summary',r=>r.fulfill({json:{text:'再試行'}}));await page.getByRole('button',{name:'投稿文をつくる',exact:true}).click();await expect(body(page)).toHaveValue('再試行');});
test('opt out persists and suppresses automatic upload',async({page})=>{let requests=0;await page.route('**/api/summary',r=>{requests++;return r.fulfill({json:{text:'要約'}});});await start(page);await page.getByLabel('写真から自動で投稿文をつくる').uncheck();await page.reload();await expect(page.getByLabel('写真から自動で投稿文をつくる')).not.toBeChecked();await page.getByTestId('pick-photo').setInputFiles(image);await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();expect(requests).toBe(0);});
test('new photo cannot receive old result',async({page})=>{const pending:Route[]=[];await page.route('**/api/summary',r=>{pending.push(r);});await start(page);await page.getByTestId('pick-photo').setInputFiles(image);await expect.poll(()=>pending.length).toBe(1);await page.getByTestId('pick-photo').setInputFiles(image);await expect.poll(()=>pending.length).toBe(2);await pending[0]!.fulfill({json:{text:'古い写真'}}).catch(()=>{});await pending[1]!.fulfill({json:{text:'新しい写真'}});await expect(body(page)).toHaveValue('新しい写真');});
test('explicit regeneration replaces user text',async({page})=>{await page.route('**/api/summary',r=>r.fulfill({json:{text:'作り直した本文'}}));await start(page);await body(page).fill('元の本文');await page.getByTestId('pick-photo').setInputFiles(image);await page.getByRole('button',{name:'投稿文を作り直す'}).click();await expect(body(page)).toHaveValue('作り直した本文');});
for(const status of [422,429,503])test(`server ${status} keeps image and manual entry`,async({page})=>{await page.route('**/api/summary',r=>r.fulfill({status,json:{error:'failed'}}));await start(page);await page.getByTestId('pick-photo').setInputFiles(image);await expect(page.getByRole('alert')).toBeVisible();await body(page).fill('手入力で続ける');await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();});

for (const status of [200, 422, 429]) {
 for (const action of ['reload', 'recheck'] as const) {
  test(`saved summary is not resent on ${action} status=${status}`, async ({page}) => {
   let requests=0;
   await page.route('**/api/summary', r => { requests++; return r.fulfill({status,json:{text:requests===1?'保存する本文':'意図しない再生成'}}); });
   await start(page);
   await page.getByTestId('pick-photo').setInputFiles(image);
   await expect.poll(()=>requests).toBe(1);
   if(status===200) await expect(body(page)).toHaveValue('保存する本文');
   else await expect(page.getByRole('alert')).toBeVisible();
   // The controller persists edits after 250ms; allow that write before reload.
   await page.waitForTimeout(500);
   if(action==='reload') await page.reload();
   else await page.getByRole('button',{name:'接続を再確認'}).click();
   await expect(page.getByRole('button',{name:'接続を再確認'})).toBeVisible();
   await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();
   await page.waitForTimeout(300);
   expect(requests).toBe(1);
   await expect(body(page)).toHaveValue(status===200?'保存する本文':'');
  });
 }
}
for (const edit of ['none','clear','off','replace'] as const) {
 test(`new photo waits for pending connection only: ${edit}`,async({page})=>{
  let statusRoute:Route|undefined;let requests=0;
  await page.addInitScript(()=>localStorage.setItem('lt-share:welcome-seen','1'));
  await page.route('**/api/ai/status',r=>{statusRoute=r;});
  await page.route('**/api/summary',r=>{requests++;return r.fulfill({json:{text:'新規写真の本文'}});});
  await page.goto('/');await page.getByTestId('pick-photo').setInputFiles(image);
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();
  if(edit==='clear'){await body(page).fill('書いて消す');await body(page).fill('');}
  if(edit==='off')await page.getByLabel('写真から自動で投稿文をつくる').uncheck();
  if(edit==='replace')await page.getByTestId('pick-photo').setInputFiles(image);
  await expect.poll(()=>!!statusRoute).toBe(true);
  await statusRoute!.fulfill({json:{available:true,provider:'cloudflare',model:'vision'}});
  await expect(page.getByRole('button',{name:'接続を再確認'})).toBeVisible();
  if(edit==='none'||edit==='replace'){await expect(body(page)).toHaveValue('新規写真の本文');expect(requests).toBe(1);}
  else {await page.waitForTimeout(300);expect(requests).toBe(0);await expect(body(page)).toHaveValue('');}
 });
}

test('new video waits for pending connection and uploads a still image once',async({page})=>{
 let statusRoute:Route|undefined;let requests=0;
 await page.addInitScript(()=>localStorage.setItem('lt-share:welcome-seen','1'));
 await page.route('**/api/ai/status',r=>{statusRoute=r;});
 await page.route('**/api/summary',r=>{
  requests++;
  expect(r.request().postDataBuffer()?.toString()).toContain('Content-Type: image/jpeg');
  return r.fulfill({json:{text:'動画の静止画からの本文'}});
 });
 await page.goto('/');
 // Produce a decodable video in the browser; no fake video or inference mock.
 const bytes=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
  const context=canvas.getContext('2d')!;
  const stream=canvas.captureStream(10);
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
  const chunks:Blob[]=[];
  recorder.ondataavailable=event=>chunks.push(event.data);
  const stopped=new Promise<void>(resolve=>{recorder.onstop=()=>resolve();});
  recorder.start();
  context.fillStyle='white';context.fillRect(0,0,160,90);
  await new Promise(resolve=>setTimeout(resolve,150));
  context.fillStyle='black';context.fillText('LT video',10,40);
  await new Promise(resolve=>setTimeout(resolve,150));
  recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
  return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
 });
 await page.getByTestId('pick-video').setInputFiles({name:'talk.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});
 await expect(page.locator('.media-frame video')).toBeVisible();
 await expect.poll(()=>!!statusRoute).toBe(true);
 await statusRoute!.fulfill({json:{available:true,provider:'cloudflare',model:'vision'}});
 await expect(body(page)).toHaveValue('動画の静止画からの本文');expect(requests).toBe(1);
 statusRoute=undefined;
 await page.getByRole('button',{name:'接続を再確認'}).click();
 await expect.poll(()=>!!statusRoute).toBe(true);
 await page.unroute('**/api/ai/status');
 await statusRoute!.fulfill({json:{available:true,provider:'cloudflare',model:'vision'}});
 await expect(page.getByText('要約サーバーに接続しました。',{exact:true})).toBeVisible();
 await page.waitForTimeout(300);expect(requests).toBe(1);
});
