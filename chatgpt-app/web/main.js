import './style.css';
import {createBridge} from './bridge.js';
import {newSession,nextDraft,applyResult,beginRequest,editBody,composePost,summaryPrompt,restoreSession,normalizeTags,xWeightedLength} from './model.js';
const $=id=>document.getElementById(id), bridge=createBridge();
let session=restoreSession(window.openai?.widgetState?.privateContent?.session),fresh=true,busy=false,previewUrl=null;
const feedback=text=>{$('feedback').textContent=text;};
function persist(){
  try{window.openai?.setWidgetState?.({modelContent:{draftId:session.current.draftId,requestId:session.current.requestId,tags:session.current.tags,body:session.current.body},privateContent:{session},imageIds:session.current.fileId?[session.current.fileId]:[]});}catch{feedback('画面の状態を保持できません。必要な投稿案をファイルに保存してください。');}
}
function sync(){
  const d=session.current;$('tags').value=d.tags.map(t=>'#'+t).join(' ');$('body').value=d.body;$('developer').checked=d.includeDeveloper;
  $('history-count').textContent=session.history.length;$('length').textContent=Array.from(d.body).length+'文字';
  $('source').textContent=d.source==='user'?'編集済み':d.source==='chatgpt'?'ChatGPTで作成':'未入力';
  $('generation-status').textContent=d.status==='waiting'?'要約を依頼しました。会話に返る新しい投稿カードも確認してください。内容が読めなかった場合は、会話で理由を確認できます。':d.status==='done'?'投稿文を確認して、必要なら編集してください。':'';
  $('release-wait').hidden=d.status!=='waiting';$('retry-hint').hidden=d.status!=='waiting';$('confirm').disabled=!d.body.trim();$('generate').disabled=!bridge.ready||busy||d.status==='waiting';$('choose').disabled=busy;$('library').disabled=busy;$('next').disabled=busy||(!d.body.trim()&&!d.fileId&&d.status!=='waiting');
  $('photo-name').textContent=d.fileName||'写真を選ぶか、この会話に写真を添付してください。';
  $('library').hidden=!window.openai?.selectFiles;
  $('history-list').replaceChildren(...session.history.map(d=>{const article=document.createElement('article'),pre=document.createElement('pre');pre.textContent=composePost(d)||'投稿文なし（要約待ちの内容は会話を確認してください）';article.append(pre);return article;}));
  persist();bridge.ready&&window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.body.scrollHeight}},'*');
}
function result(data){
  if(!data||typeof data.draftId!=='string'||typeof data.body!=='string'||data.body.length>2000)return;
  if(fresh && !session.current.body && !session.current.fileId && session.history.length===0){
    const candidate={...newSession(data.draftId),current:{...newSession(data.draftId).current,...data,source:data.body?'chatgpt':'empty',status:data.body?'done':'idle',requestId:null}};
    session=restoreSession(candidate);fresh=false;
  } else session=applyResult(session,data);
  sync();
}
bridge.subscribe((method,params)=>{
  if(method==='ui/notifications/tool-result')result(params?.structuredContent);
  if(method==='ui/notifications/host-context-changed' && ['dark','light'].includes(params?.theme))document.documentElement.dataset.theme=params.theme;
  if(method==='ui/notifications/tool-cancelled'){session.current.status='idle';session.current.requestId=null;sync();feedback('処理がキャンセルされました。本文やタグは残っています。');}
});
$('tags').addEventListener('change',()=>{session={...session,current:{...session.current,tags:normalizeTags($('tags').value)}};fresh=false;sync();});
$('body').addEventListener('input',()=>{session=editBody(session,$('body').value);fresh=false;persist();$('length').textContent=Array.from(session.current.body).length+'文字';$('source').textContent='編集済み';$('confirm').disabled=!session.current.body.trim();$('next').disabled=busy||!session.current.body.trim();});
$('developer').addEventListener('change',()=>{session.current.includeDeveloper=$('developer').checked;fresh=false;persist();});
$('choose').onclick=()=>{if(!window.openai?.uploadFile){feedback('この環境では写真を画面から送信できません。ChatGPTの会話に写真を添付してから、要約を依頼してください。');return;}$('photo').click();};
$('photo').onchange=async()=>{
  const file=$('photo').files?.[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024){feedback('20MB以下のJPEG・PNG・WebP写真を選んでください。');$('photo').value='';return;}
  busy=true;feedback('写真をChatGPTに送信しています…');sync();
  try{const localPreview=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('写真を表示できません'));reader.readAsDataURL(file);});const uploaded=await window.openai.uploadFile(file);if(typeof uploaded?.fileId!=='string')throw new Error('写真の送信結果を確認できません');
    session.current={...session.current,fileId:uploaded.fileId,fileName:file.name,requestId:null,status:'idle'};fresh=false;
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('preview').src=localPreview;$('preview').hidden=false;feedback('写真を送信しました。要約を依頼できます。');
  }catch{feedback('写真を送信できませんでした。もう一度選ぶか、会話に直接添付してください。');}finally{busy=false;$('photo').value='';sync();}
};
$('library').onclick=async()=>{busy=true;sync();try{const files=await window.openai.selectFiles();const file=files?.[0];if(file){if(!/^image\//.test(file.mimeType))throw new Error();session.current={...session.current,fileId:file.fileId,fileName:file.fileName,requestId:null,status:'idle'};fresh=false;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('preview').hidden=true;feedback('写真を選択しました。');}}catch{feedback('写真を選択できませんでした。会話に写真を添付して進めることもできます。');}finally{busy=false;sync();}};
$('generate').onclick=async()=>{
  if(busy||!bridge.ready)return;busy=true;fresh=false;session=beginRequest(session,crypto.randomUUID());const draftId=session.current.draftId,requestId=session.current.requestId;sync();
  try{await bridge.request('ui/update-model-context',{content:[{type:'text',text:summaryPrompt(session)}]});await bridge.request('ui/message',{role:'user',content:[{type:'text',text:summaryPrompt(session)}]});feedback('');}
  catch{if(session.current.draftId===draftId && session.current.requestId===requestId)session.current.status='idle';feedback('要約の依頼を送信できませんでした。会話側を確認してから、もう一度依頼できます。');}
  finally{busy=false;sync();}
};
$('release-wait').onclick=()=>{session.current.status='idle';session.current.requestId=null;feedback('待機を解除しました。会話の返答を確認してから、必要なら再依頼してください。');sync();};
$('next').onclick=()=>{session=nextDraft(session);fresh=false;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('preview').hidden=true;feedback('前の投稿案をこの画面に残しました。ハッシュタグは引き継ぎました。');sync();};
$('history-toggle').onclick=()=>{$('history').hidden=!$('history').hidden;};
$('confirm').onclick=()=>{const text=composePost(session.current);$('post-text').value=text;const count=xWeightedLength(text);$('limit').textContent='X換算の目安 '+count+' / 280'+(count>280?'。本文かハッシュタグを短くしてください。':'。最終確認はXで行ってください。');$('open-x').disabled=count>280;$('post-status').textContent='';$('post').showModal();};
$('close-post').onclick=()=>$('post').close();
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('post-text').value);$('post-status').textContent='本文をコピーしました。';}catch{$('post-text').focus();$('post-text').select();$('post-status').textContent='コピーを許可できませんでした。本文を選択して手動でコピーしてください。';}};
$('open-x').onclick=async()=>{try{const url='https://x.com/intent/post?text='+encodeURIComponent($('post-text').value.toWellFormed());if(bridge.ready)await bridge.request('ui/open-link',{url});else window.open(url,'_blank','noopener,noreferrer');$('post-status').textContent='Xを開く操作を行いました。投稿はXで確認してください。';}catch{$('post-status').textContent='Xを開けませんでした。本文をコピーしてXに貼り付けてください。';}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(session,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lt-share-drafts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
sync();
bridge.connect().then(context=>{if(['light','dark'].includes(context?.hostContext?.theme))document.documentElement.dataset.theme=context.hostContext.theme;$('connection').textContent='ChatGPTの会話と接続しました。写真の送信後に要約を依頼できます。';sync();}).catch(()=>{$('connection').textContent='ChatGPTの会話内で開くと、本人のChatGPTに要約を依頼できます。ここでは本文の編集と確認ができます。';sync();});
