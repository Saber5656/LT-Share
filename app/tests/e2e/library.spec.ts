import {test, expect, type Page, type FileChooser} from '@playwright/test';

const PHOTO = 'tests/fixtures/lt-photo.jpg';
const body = (page: Page) => page.getByRole('textbox', {name:'投稿文', exact:true});
const libraryButton = (page: Page) => page.getByRole('button', {name:'写真・動画を選ぶ', exact:true});

async function start(page: Page) {
  const summaries: Buffer[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('lt-share:welcome-seen', '1');
    Object.assign(window, {libraryShareCalls: 0});
    Object.defineProperty(navigator, 'canShare', {configurable:true, value:() => true});
    Object.defineProperty(navigator, 'share', {configurable:true, value:async () => {
      const state = window as unknown as {libraryShareCalls:number};
      state.libraryShareCalls++;
    }});
  });
  await page.route('**/api/ai/status', route => route.fulfill({json:{available:true, provider:'cloudflare', model:'vision'}}));
  await page.route('**/api/summary', route => {
    expect(route.request().headers()['x-lt-share-request']).toBe('summary-v1');
    summaries.push(route.request().postDataBuffer()!);
    return route.fulfill({json:{text:`ライブラリ要約${summaries.length}`}});
  });
  await page.goto('/');
  await expect(page.getByText('要約サーバーに接続しました。', {exact:true})).toBeVisible();
  return summaries;
}

async function openLibrary(page: Page): Promise<FileChooser> {
  const opened = page.waitForEvent('filechooser');
  await libraryButton(page).click();
  const chooser = await opened;
  expect(await chooser.element().getAttribute('data-testid')).toBe('pick-library');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return chooser;
}

async function captureAfter(page: Page, state: 'empty' | 'saved-photo') {
  if (process.env.LT_LIBRARY_AFTER !== '1') return;
  await page.setViewportSize({width:390, height:844});
  await page.evaluate(() => window.scrollTo({top:0, behavior:'instant'}));
  await page.screenshot({path:`/tmp/lt-share-library-after-${state}-full.png`, fullPage:true});
  await page.screenshot({path:`/tmp/lt-share-library-after-${state}-viewport.png`});
  if (state === 'saved-photo') {
    await page.evaluate(() => window.scrollTo({top:document.documentElement.scrollHeight, behavior:'instant'}));
    await page.screenshot({path:'/tmp/lt-share-library-after-saved-photo-bottom-viewport.png'});
  }
}

test('library selector opens mixed media without capture and keeps camera inputs', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await start(page);
  // Explicit opt-in keeps this baseline artifact from being overwritten by later full runs.
  if (process.env.LT_LIBRARY_BEFORE === '1') {
    await page.screenshot({path:'/tmp/lt-share-library-before.png', fullPage:true});
  }
  await captureAfter(page, 'empty');
  await expect(libraryButton(page)).toBeVisible({timeout:1500});
  const chooser = await openLibrary(page);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*,video/*');
  expect(await chooser.element().getAttribute('capture')).toBeNull();
  await expect(page.getByTestId('pick-photo')).toHaveAttribute('accept', 'image/*');
  await expect(page.getByTestId('pick-photo')).toHaveAttribute('capture', 'environment');
  await expect(page.getByTestId('pick-video')).toHaveAttribute('accept', 'video/*');
  await expect(page.getByTestId('pick-video')).toHaveAttribute('capture', 'environment');
  await chooser.setFiles([]);
});

async function choosePhoto(page: Page) {
  await (await openLibrary(page)).setFiles(PHOTO);
  await expect(page.getByRole('img', {name:'記録した写真'})).toBeVisible();
}

async function makeVideo(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=90;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, {mimeType:'video/webm'});
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<void>(resolve => {recorder.onstop=()=>resolve();});
    recorder.start();
    context.fillStyle='white'; context.fillRect(0,0,160,90);
    await new Promise(resolve=>setTimeout(resolve,150));
    context.fillStyle='black'; context.fillText('LT video',10,40);
    await new Promise(resolve=>setTimeout(resolve,150));
    recorder.stop(); await stopped; stream.getTracks().forEach(track=>track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
  });
  return {name:'library-talk.webm', mimeType:'video/webm', buffer:Buffer.from(bytes)};
}

test('library photo previews and automatically summarizes without confirming original first', async ({page}) => {
  const requests = await start(page);
  await choosePhoto(page);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.toString()).toContain('Content-Type: image/jpeg');
  expect(await page.getByRole('img',{name:'記録した写真'}).evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBeGreaterThan(0);
});

test('library video decodes, previews and uploads only a JPEG still for summary', async ({page}) => {
  const requests=await start(page);
  const video=await makeVideo(page);
  await (await openLibrary(page)).setFiles(video);
  const preview=page.locator('.media-frame video');
  await expect(preview).toBeVisible();
  await expect.poll(()=>preview.evaluate((element:HTMLVideoElement)=>element.videoWidth)).toBeGreaterThan(0);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.toString()).toContain('Content-Type: image/jpeg');
  expect(requests[0]!.toString()).not.toContain('Content-Type: video/webm');
});

test('cancelling library picker preserves body tags and existing media', async ({page}) => {
  const requests=await start(page);
  await choosePhoto(page);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  await body(page).fill('手入力を残す');
  await page.getByLabel('ハッシュタグを追加').fill('Keep');
  await page.getByLabel('ハッシュタグを追加').press('Enter');
  const previousUrl=await page.getByRole('img',{name:'記録した写真'}).getAttribute('src');
  const chooser=await openLibrary(page);
  // Empty file selection models dismissing the OS picker; no media is supplied.
  await chooser.setFiles([]);
  await expect(body(page)).toHaveValue('手入力を残す');
  await expect(page.locator('.tag-chip')).toHaveText(['#Keep']);
  await expect(page.getByRole('img',{name:'記録した写真'})).toHaveAttribute('src',previousUrl!);
  expect(requests).toHaveLength(1);
});

test('library replacement opens directly and summarizes the new selection', async ({page}) => {
  const requests=await start(page);
  await page.getByTestId('pick-photo').setInputFiles(PHOTO);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  const chooser=await openLibrary(page);
  expect(await chooser.element().getAttribute('capture')).toBeNull();
  await chooser.setFiles(PHOTO);
  await expect(body(page)).toHaveValue('ライブラリ要約2');
  expect(requests).toHaveLength(2);
});

test('same library file can be selected again without confirmation', async ({page}) => {
  const requests=await start(page);
  await choosePhoto(page);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  await choosePhoto(page);
  await expect(body(page)).toHaveValue('ライブラリ要約2');
  expect(requests).toHaveLength(2);
});

test('library import uses no share or download and the original survives reload', async ({page}) => {
  const requests=await start(page);
  let downloads=0; page.on('download',()=>downloads++);
  await choosePhoto(page);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  expect(await page.evaluate(()=>(window as unknown as {libraryShareCalls:number}).libraryShareCalls)).toBe(0);
  expect(downloads).toBe(0);
  // Wait past the controller's 250ms persistence debounce before restoring the page.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await captureAfter(page, 'saved-photo');
});

test('library original can be posted and archived without a save confirmation', async ({page}) => {
  await start(page);
  await page.getByLabel('ハッシュタグを追加').fill('LibraryLT');
  await page.getByLabel('ハッシュタグを追加').press('Enter');
  await choosePhoto(page);
  await expect(body(page)).toHaveValue('ライブラリ要約1');
  await page.getByRole('button',{name:'ポスト確認',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'ポスト確認',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'閉じる',exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button',{name:'次の投稿へ',exact:true}).click();
  await expect(page.getByText('2本目の投稿案',{exact:true})).toBeVisible();
  await expect(page.locator('.tag-chip')).toHaveText(['#LibraryLT']);
  await expect(body(page)).toHaveValue('');
  await page.getByRole('button',{name:/保存した投稿案 1/}).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(page.getByTestId('draft-row')).toContainText('ライブラリ要約1');
  await expect(page.getByTestId('draft-row')).toContainText('#LibraryLT');
});
