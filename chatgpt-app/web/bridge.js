// MCP Apps JSON-RPC transport. Only our immediate parent may answer requests.
export function createBridge(win=window) {
  let sequence=0;const pending=new Map(),subscribers=new Set();
  const bridge={ready:false,request,connect,close,subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn);}};
  function receive(event) {
    if(event.source!==win.parent) return;
    const m=event.data;if(!m || m.jsonrpc!=='2.0') return;
    if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error||m.result?.isError?p.reject(new Error(m.error?.message||'ホストが操作を許可しませんでした')):p.resolve(m.result);return;}
    if(typeof m.method==='string') for(const fn of subscribers) fn(m.method,m.params);
  }
  function request(method,params) {
    if(win.parent===win) return Promise.reject(new Error('ChatGPTの会話内で開いてください'));
    const id='lt-'+(++sequence);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('ChatGPTから応答がありません。会話を確認してください。'));},15000);pending.set(id,{resolve,reject,timer});win.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});
  }
  async function connect() {
    const result=await request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'LT Share',version:'0.1.0'},appCapabilities:{availableDisplayModes:['inline','fullscreen']}});
    bridge.ready=true;win.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');return result;
  }
  function close(){win.removeEventListener('message',receive);for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('接続が終了しました'));}pending.clear();subscribers.clear();}
  win.addEventListener('message',receive);return bridge;
}
