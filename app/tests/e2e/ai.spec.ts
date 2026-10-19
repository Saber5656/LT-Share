import {test,expect,type Page} from '@playwright/test';
const image='tests/fixtures/lt-photo.jpg';
async function start(page:Page, status={available:true,provider:'groq'}) {
  await page.addInitScript(()=>localStorage.setItem('lt-share:welcome-seen','1'));
  await page.route('**/api/ai/status',r=>r.fulfill({json:status}));
  await page.goto('/');
  await expect(page.getByLabel('写真から自動で投稿文をつくる')).toBeVisible();
}
test('photo starts summarization before device save and fills editable body',async({page})=>{
  let calls=0;
  await page.route('**/api/summary',async route=>{calls++;await expect(route.request().headerValue('x-lt-share-request')).resolves.toBe('summary-v1');await route.fulfill({json:{text:'Rust製CLIの引数処理と配布の仕組みを紹介するLT。'}});});
  await start(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect(page.getByRole('textbox',{name:'投稿文',exact:true})).toHaveValue('Rust製CLIの引数処理と配布の仕組みを紹介するLT。');
  await expect(page.getByText('まだ端末に保存されていません',{exact:true})).toBeVisible();expect(calls).toBe(1);
});
test('editing during generation survives the delayed reply',async({page})=>{
  let release:()=>void=()=>{};const held=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/summary',async r=>{await held;await r.fulfill({json:{text:'遅れたAI結果'}});});
  await start(page);await page.getByTestId('pick-photo').setInputFiles(image);
  await expect(page.getByText('投稿文を作成中です。先に編集することもできます。')).toBeVisible();
  await page.getByRole('textbox',{name:'投稿文',exact:true}).fill('自分で書いた本文');release();
  await expect(page.getByText('投稿文を作成中です。先に編集することもできます。')).toBeHidden();
  await expect(page.getByRole('textbox',{name:'投稿文',exact:true})).toHaveValue('自分で書いた本文');
});
test('quota stops, preserves media and allows manual text',async({page})=>{
  let calls=0;await page.route('**/api/summary',r=>{calls++;return r.fulfill({status:429,json:{code:'quota'}});});
  await start(page);await page.getByTestId('pick-photo').setInputFiles(image);await expect(page.getByText(/利用上限に達しました/)).toBeVisible();
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();await page.getByRole('textbox',{name:'投稿文',exact:true}).fill('手入力で続けます');expect(calls).toBe(1);
});
test('automatic summary can be disabled and preference survives reload',async({page})=>{
  let calls=0;await page.route('**/api/summary',r=>{calls++;return r.fulfill({json:{text:'呼ばれない'}});});await start(page);
  await page.getByLabel('写真から自動で投稿文をつくる').uncheck();await page.reload();await expect(page.getByLabel('写真から自動で投稿文をつくる')).not.toBeChecked();
  await page.getByTestId('pick-photo').setInputFiles(image);await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();expect(calls).toBe(0);
});
test('not configured is stated honestly and does not make model calls',async({page})=>{
  let calls=0;await page.route('**/api/summary',r=>{calls++;return r.abort();});await start(page,{available:false,provider:'groq'});
  await expect(page.getByText(/現在、自動作成を利用できません/)).toBeVisible();await page.getByTestId('pick-photo').setInputFiles(image);await page.getByRole('textbox',{name:'投稿文',exact:true}).fill('そのまま入力できます');expect(calls).toBe(0);
});
