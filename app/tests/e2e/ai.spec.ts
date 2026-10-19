import {test,expect,type Page} from '@playwright/test';
const image='tests/fixtures/lt-photo.jpg';
const body=(page:Page)=>page.getByRole('textbox',{name:'投稿文',exact:true});
async function start(page:Page,supported=true) {
  await page.addInitScript(({supported})=>{
    localStorage.setItem('lt-share:welcome-seen','1');
    Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>supported?{features:new Set(['shader-f16'])}:null}});
    const fixture={workers:[] as FakeWorker[],requests:[] as {type:string;id:number}[]};
    class FakeWorker extends EventTarget {
      terminated=false;
      constructor(..._args:unknown[]) {super();fixture.workers.push(this);}
      postMessage(request:{type:string;id:number}) {fixture.requests.push(request);}
      terminate(){this.terminated=true;}
    }
    Object.assign(window,{Worker:FakeWorker,localAiFixture:fixture});
  },{supported});
  await page.goto('/');
  await expect(page.getByLabel('写真から自動で投稿文をつくる')).toBeVisible();
}
async function count(page:Page,type:string) {
  return page.evaluate(type=>(window as any).localAiFixture.requests.filter((r:any)=>r.type===type).length,type);
}
async function reply(page:Page,data:Record<string,unknown>,workerIndex=-1) {
  await page.evaluate(({data,workerIndex})=>{
    const f=(window as any).localAiFixture;
    const id=f.requests.at(-1).id;
    f.workers.at(workerIndex).dispatchEvent(new MessageEvent('message',{data:{id,...data}}));
  },{data,workerIndex});
}
async function prepare(page:Page) {
  await page.getByRole('button',{name:'端末内AIを準備',exact:true}).click();
  await expect.poll(()=>count(page,'load')).toBeGreaterThan(0);
  await reply(page,{type:'loaded'});
  await expect(page.getByText('端末内AIの準備ができました。',{exact:true})).toBeVisible();
}
test('no model or cloud requests before explicit prepare; progress and photo generation',async({page})=>{
  const network:string[]=[];page.on('request',r=>{if(/\/api\/|huggingface|\.onnx|\.wasm/.test(r.url()))network.push(r.url());});
  await start(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();
  expect(await count(page,'load')).toBe(0);expect(network).toEqual([]);
  await page.getByRole('button',{name:'端末内AIを準備',exact:true}).click();
  await reply(page,{type:'progress',progress:0.4});
  await expect(page.getByRole('progressbar')).toHaveAttribute('value','0.4');
  await expect(page.getByRole('button',{name:'準備を中止'})).toBeVisible();
  await reply(page,{type:'loaded'});
  await expect.poll(()=>count(page,'generate')).toBe(1);
  await reply(page,{type:'result',text:'写真から端末内で作成した投稿文'});
  await expect(body(page)).toHaveValue('写真から端末内で作成した投稿文');
  expect(network).toEqual([]);
});
test('editing during generation survives response',async({page})=>{
  await start(page);await prepare(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect.poll(()=>count(page,'generate')).toBe(1);
  await body(page).fill('自分で書いた本文');await reply(page,{type:'result',text:'遅れた結果'});
  await expect(page.getByRole('button',{name:'生成を中止'})).toBeHidden();
  await expect(body(page)).toHaveValue('自分で書いた本文');
});
test('unsupported keeps manual input and photo without download',async({page})=>{
  await start(page,false);await expect(page.getByText(/この端末では端末内AIを利用できません/)).toBeVisible();
  await page.getByTestId('pick-photo').setInputFiles(image);await body(page).fill('手入力で続けます');
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();expect(await count(page,'load')).toBe(0);
});
test('cancel ignores late result and allows explicit preparation again',async({page})=>{
  await start(page);await prepare(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect.poll(()=>count(page,'generate')).toBe(1);
  await page.getByRole('button',{name:'生成を中止'}).click();
  await reply(page,{type:'result',text:'中止後の結果'});
  await expect(body(page)).toHaveValue('');
  await expect(page.getByRole('button',{name:'端末内AIを準備',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).localAiFixture.workers[0].terminated)).toBe(true);
});
test('reload does not automatically load and preserves preference',async({page})=>{
  await start(page);await prepare(page);await page.getByLabel('写真から自動で投稿文をつくる').uncheck();
  await page.reload();await expect(page.getByRole('button',{name:'端末内AIを準備',exact:true})).toBeVisible();
  await expect(page.getByLabel('写真から自動で投稿文をつくる')).not.toBeChecked();
  expect(await count(page,'load')).toBe(0);
  await prepare(page);expect(await count(page,'load')).toBe(1);
});
for(const clear of [false,true]) test(`editing while preparing is preserved (clear=${clear})`,async({page})=>{
  await start(page);await page.getByRole('button',{name:'端末内AIを準備',exact:true}).click();
  await page.getByTestId('pick-photo').setInputFiles(image);
  await body(page).fill('準備中に書いた本文');if(clear)await body(page).fill('');
  await reply(page,{type:'loaded'});
  await expect(page.getByText('端末内AIの準備ができました。',{exact:true})).toBeVisible();
  await expect(body(page)).toHaveValue(clear?'':'準備中に書いた本文');expect(await count(page,'generate')).toBe(0);
});
test('ordinary failure allows retry without redownloading',async({page})=>{
  await start(page);await prepare(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect.poll(()=>count(page,'generate')).toBe(1);await reply(page,{type:'error',code:'unreadable'});
  await expect(page.getByText('投稿文を作成できませんでした。記録はそのまま残っています。')).toBeVisible();
  await page.getByRole('button',{name:'再試行',exact:true}).click();await expect.poll(()=>count(page,'generate')).toBe(2);
  await reply(page,{type:'result',text:'再試行の結果'});await expect(body(page)).toHaveValue('再試行の結果');expect(await count(page,'load')).toBe(1);
});
test('next photo during generation is retained and can be generated manually',async({page})=>{
  await start(page);await prepare(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect.poll(()=>count(page,'generate')).toBe(1);
  await page.getByTestId('pick-photo').setInputFiles({name:'next.jpg',mimeType:'image/jpeg',buffer:await (await import('node:fs/promises')).readFile(image)});
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();
  await reply(page,{type:'result',text:'古い写真の結果'});
  await expect(page.getByText('端末内AIの準備ができました。',{exact:true})).toBeVisible();
  await expect(body(page)).toHaveValue('');expect(await count(page,'generate')).toBe(1);
  await page.getByRole('button',{name:'投稿文をつくる',exact:true}).click();await expect.poll(()=>count(page,'generate')).toBe(2);
  await reply(page,{type:'result',text:'新しい写真の結果'});await expect(body(page)).toHaveValue('新しい写真の結果');
});
test('explicit regeneration can replace existing user text',async({page})=>{
  await start(page);await prepare(page);await body(page).fill('元の手入力');
  await page.getByTestId('pick-photo').setInputFiles(image);
  await page.getByRole('button',{name:'投稿文を作り直す'}).click();
  await expect.poll(()=>count(page,'generate')).toBe(1);
  await reply(page,{type:'result',text:'明示的に作り直した本文'});
  await expect(body(page)).toHaveValue('明示的に作り直した本文');
});
test('preparation cancel and failure permit explicit retry',async({page})=>{
  await start(page);await page.getByRole('button',{name:'端末内AIを準備',exact:true}).click();
  await page.getByRole('button',{name:'準備を中止'}).click();await reply(page,{type:'loaded'});
  await page.getByRole('button',{name:'端末内AIを準備',exact:true}).click();
  await reply(page,{type:'error',code:'failed'});
  await expect(page.getByText(/端末内AIを利用できませんでした/)).toBeVisible();
  await prepare(page);expect(await count(page,'load')).toBe(3);
});
test('preparation completion uses latest media and opt-out suppresses auto generation',async({page})=>{
  await start(page);await page.getByRole('button',{name:'端末内AIを準備',exact:true}).click();
  await page.getByTestId('pick-photo').setInputFiles(image);
  await page.getByTestId('pick-photo').setInputFiles({name:'latest.jpg',mimeType:'image/jpeg',buffer:await (await import('node:fs/promises')).readFile(image)});
  await reply(page,{type:'loaded'});await expect.poll(()=>count(page,'generate')).toBe(1);
  await reply(page,{type:'result',text:'最新写真の本文'});await expect(body(page)).toHaveValue('最新写真の本文');
  await page.getByLabel('写真から自動で投稿文をつくる').uncheck();
  await page.getByTestId('pick-photo').setInputFiles(image);
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();expect(await count(page,'generate')).toBe(1);
});

test('cancelled manual replacement stays protected after model preparation',async({page})=>{
  await start(page);await prepare(page);await body(page).fill('中止後も残す手入力');
  await page.getByTestId('pick-photo').setInputFiles(image);
  await page.getByRole('button',{name:'投稿文を作り直す'}).click();
  await expect.poll(()=>count(page,'generate')).toBe(1);
  await page.getByRole('button',{name:'生成を中止'}).click();
  await prepare(page);
  await expect(body(page)).toHaveValue('中止後も残す手入力');
  expect(await count(page,'generate')).toBe(1);
});
