import {test,expect,type Page} from '@playwright/test';
test.use({launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}});
async function start(page:Page){await page.addInitScript(()=>localStorage.setItem('lt-share:welcome-seen','1'));await page.route('**/api/ai/status',r=>r.fulfill({json:{available:false}}));await page.goto('/');}
test('camera opens inline, captures live frame, and releases tracks when closed',async({page})=>{
 await start(page);await page.getByRole('button',{name:'記録する',exact:true}).click();
 const camera=page.getByRole('dialog',{name:'写真を撮る',exact:true});await expect(camera).toBeVisible({timeout:2000});
 const preview=camera.locator('video');await expect.poll(()=>preview.evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBeGreaterThan(0);
 await preview.evaluate((v:HTMLVideoElement)=>{(window as any).__cameraStream=v.srcObject;});
 await camera.getByRole('button',{name:'撮影する',exact:true}).click();
 await expect(camera).toHaveCount(0);await expect(page.getByRole('img',{name:'記録した写真'})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__cameraStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await expect(page.getByRole('button',{name:'保存できた',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'次の投稿へ',exact:true}).click();await expect(page.getByText('2本目の投稿案',{exact:true})).toBeVisible();
});
test('camera cancel keeps draft and permission failure offers library',async({page})=>{
 await start(page);await page.getByRole('textbox',{name:'投稿文',exact:true}).fill('残す文章');
 await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>Promise.reject(new DOMException('denied','NotAllowedError'))}));
 await page.getByRole('button',{name:'記録する',exact:true}).click();const camera=page.getByRole('dialog',{name:'写真を撮る',exact:true});
 await expect(camera.getByRole('alert')).toContainText('許可');await expect(camera.getByRole('button',{name:'撮影する',exact:true})).toBeDisabled();
 const chooserPromise=page.waitForEvent('filechooser');await camera.getByRole('button',{name:'写真・動画を選ぶ',exact:true}).click();await (await chooserPromise).setFiles([]);
 await expect(camera).toHaveCount(0);await expect(page.getByRole('textbox',{name:'投稿文',exact:true})).toHaveValue('残す文章');
});
test('camera can record a decodable video and stop every stream',async({page})=>{
 await start(page);await page.getByRole('radio',{name:'動画',exact:true}).click();await page.getByRole('button',{name:'記録する',exact:true}).click();
 const camera=page.getByRole('dialog',{name:'動画を撮る',exact:true});await expect(camera).toBeVisible();
 await camera.getByRole('button',{name:'録画を開始',exact:true}).click();await expect(camera.getByRole('button',{name:'録画を停止',exact:true})).toBeVisible();await page.waitForTimeout(500);
 await camera.getByRole('button',{name:'録画を停止',exact:true}).click();await expect(camera).toHaveCount(0);
 const video=page.locator('.media-frame video');await expect(video).toBeVisible();await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBeGreaterThan(0);
});
test('closing while permission is pending stops late camera tracks',async({page})=>{
 await start(page);
 await page.evaluate(()=>{const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); (window as any).__lateStream=null; navigator.mediaDevices.getUserMedia=async options=>{const stream=await native(options);(window as any).__lateStream=stream;await new Promise(resolve=>(window as any).__releaseCamera=resolve);return stream;};});
 await page.getByRole('button',{name:'記録する',exact:true}).click();const camera=page.getByRole('dialog',{name:'写真を撮る',exact:true});
 await expect.poll(()=>page.evaluate(()=>!!(window as any).__releaseCamera)).toBe(true);
 await camera.getByRole('button',{name:'閉じる',exact:true}).click();await page.evaluate(()=>(window as any).__releaseCamera());
 await expect.poll(()=>page.evaluate(()=>(window as any).__lateStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await expect(page.getByRole('img',{name:'記録した写真'})).toHaveCount(0);
});
test('leaving the page stops camera without creating a recording',async({page})=>{
 await start(page);await page.getByRole('button',{name:'記録する',exact:true}).click();const camera=page.getByRole('dialog',{name:'写真を撮る',exact:true});
 const preview=camera.locator('video');await expect.poll(()=>preview.evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBeGreaterThan(0);
 await preview.evaluate((v:HTMLVideoElement)=>{(window as any).__cameraStream=v.srcObject;});
 await page.screenshot({path:'/tmp/lt-feedback-camera.png',animations:'disabled'});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(camera).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__cameraStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await expect(page.getByRole('img',{name:'記録した写真'})).toHaveCount(0);
});
