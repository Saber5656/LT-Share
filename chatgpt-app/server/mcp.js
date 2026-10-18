const URI = 'ui://lt-share/composer-v1.html';
const MIME = 'text/html;profile=mcp-app';
const MAX_BYTES = 64 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0);
const validTags = tags => Array.isArray(tags) && tags.length <= 12 && tags.every(tag => string(tag, 80, true));
const textSchema = (maxLength, minLength = 0) => ({type:'string', minLength, maxLength});
const tagsSchema = {type:'array',maxItems:12,items:textSchema(80,1)};
const annotations = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const toolMeta = {ui:{resourceUri:URI},'openai/outputTemplate':URI};
const tools = [
 {name:'open_lt_share',title:'LT Shareを開く',description:'会話内の写真をもとにLTの投稿下書きを作る画面を開きます。AI生成やXへの投稿は行いません。',inputSchema:{type:'object',properties:{tags:{...tagsSchema,default:[]}},additionalProperties:false},annotations,_meta:toolMeta},
 {name:'render_lt_post',title:'LT投稿の下書きを表示',description:'最初にユーザーがこの会話で提供した写真を確認し、観察できる事実だけを日本語で約100文字に要約してください。見えない内容や詳細を創作しないでください。その後このツールで下書きを表示します。このツール自体がAI生成やX投稿を行うと説明しないでください。',inputSchema:{type:'object',properties:{draftId:textSchema(128,1),requestId:textSchema(128,1),body:textSchema(2000),tags:tagsSchema,includeDeveloper:{type:'boolean',default:false}},required:['draftId','body','tags'],additionalProperties:false},annotations,_meta:toolMeta}
];
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const failure = (id,code,message,status=200) => json({jsonrpc:'2.0',id,error:{code,message}},status);
const toolError = () => ({isError:true,content:[{type:'text',text:'ツール名または入力が不正です。文字数・型・必須項目を確認してください。'}]});
const rendered = structuredContent => ({content:[{type:'text',text:`LT Shareの下書き\n${structuredContent.body}\nタグ: ${structuredContent.tags.join(' ')}`}],structuredContent});
function callTool(params) {
 if (!object(params)) return toolError();
 const args = params.arguments === undefined ? {} : params.arguments;
 if (!object(args)) return toolError();
 if (params.name === 'open_lt_share') {
  if (Object.keys(args).some(key=>key!=='tags') || (args.tags !== undefined && !validTags(args.tags))) return toolError();
  return rendered({draftId:globalThis.crypto.randomUUID(),body:'',tags:args.tags ?? [],includeDeveloper:false,requestId:null});
 }
 if (params.name === 'render_lt_post') {
  if (Object.keys(args).some(key=>!['draftId','requestId','body','tags','includeDeveloper'].includes(key)) || !string(args.draftId,128,true) || !string(args.body,2000) || !validTags(args.tags) || (args.requestId !== undefined && !string(args.requestId,128,true)) || (args.includeDeveloper !== undefined && typeof args.includeDeveloper !== 'boolean')) return toolError();
  return rendered({kind:'lt-post',draftId:args.draftId,requestId:args.requestId ?? null,body:args.body,tags:args.tags,includeDeveloper:args.includeDeveloper ?? false});
 }
 return toolError();
}
// Read incrementally: Content-Length alone does not bound chunked request bodies.
async function readBounded(request) {
 const reader = request.body?.getReader();
 if (!reader) return '';
 const decoder = new TextDecoder();
 let size=0, body='';
 try {
  while (true) {
   const {done,value}=await reader.read();
   if (done) break;
   size+=value.byteLength;
   if (size>MAX_BYTES) { await reader.cancel(); throw new RangeError('Request too large'); }
   body+=decoder.decode(value,{stream:true});
  }
  return body+decoder.decode();
 } finally { reader.releaseLock(); }
}
export function createWorker(widgetHtml) {
 if (typeof widgetHtml !== 'string') throw new TypeError('widgetHtml must be a string');
 const resource={uri:URI,name:'lt-share-composer',title:'LT Share',mimeType:MIME};
 return {async fetch(request) {
  const path=new URL(request.url).pathname;
  if (path === '/' && request.method === 'GET') return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><title>LT Share</title><h1>LT Share</h1><p>ChatGPTにこのアプリを接続して、会話内で写真からLTの投稿下書きを作れます。接続先はこのサイトの /mcp です。</p><p>会話に写真を添付し、見える事実を日本語で約100文字にまとめるよう依頼すると、下書き画面が開きます。内容とタグを確認して利用してください。Xへの自動投稿は行いません。</p><p>独自のAPIキーやデータベースは不要です。このサーバーは写真や下書きを保存しません。</p></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if (path === '/health' && request.method === 'GET') return json({status:'ok'});
  if (path !== '/mcp') return new Response('Not found',{status:404});
  if (request.method !== 'POST') return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  let message;
  try { message=JSON.parse(await readBounded(request)); }
  catch(error) { return error instanceof RangeError ? failure(null,-32600,'Request exceeds 64KB',413) : failure(null,-32700,'Parse error',400); }
  if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || ('id' in message && message.id !== null && !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isFinite(message.id)))) || ('params' in message && !object(message.params) && !Array.isArray(message.params))) return failure(null,-32600,'Invalid Request',400);
  const id=message.id ?? null;
  if (!('id' in message)) return new Response(null,{status:202});
  const params=message.params;
  let result;
  switch(message.method) {
   case 'server/discover':
    result={protocolVersion:'2026-07-28',supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}},serverInfo:{name:'lt-share',version:'1.0.0'}}; break;
   case 'initialize':
    result={protocolVersion:message.method === 'initialize' && params?.protocolVersion === '2025-06-18' ? '2025-06-18':'2026-07-28',capabilities:{tools:{},resources:{}},serverInfo:{name:'lt-share',version:'1.0.0'}}; break;
   case 'ping': result={}; break;
   case 'tools/list': result={tools}; break;
   case 'tools/call': result=callTool(params); break;
   case 'resources/list': result={resources:[resource]}; break;
   case 'resources/read':
    if (params?.uri !== URI) return failure(id,-32602,'Unknown resource');
    result={contents:[{uri:URI,mimeType:MIME,text:widgetHtml,_meta:{ui:{prefersBorder:true,permissions:{camera:{},clipboardWrite:{}},csp:{connectDomains:[],resourceDomains:[]}}}}]}; break;
   default: return failure(id,-32601,'Method not found');
  }
  return json({jsonrpc:'2.0',id,result});
 }};
}
