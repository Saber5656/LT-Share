import {timingSafeEqual} from 'node:crypto';
import {MODEL, IMAGE_LIMIT, PROMPT, json, error, boundedBytes, imageMime, base64} from './ai-worker.mjs';

// Only the authenticated Sites server has this secret. No browser/API key distribution.
function authenticated(request, secret) {
  const actual = new TextEncoder().encode(request.headers.get('Authorization') ?? '');
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function providerError(cause) {
  // Workers AI reports documented numeric error codes in its thrown errors.
  const message = String(cause?.message ?? '');
  if (/\b(3036|3040)\b/.test(message)) return error(429,'quota');
  if (/\b(5035|5018|3023|3041)\b/.test(message)) return error(503,'unavailable');
  if (/\b(3007|3008)\b/.test(message)) return error(504,'timeout');
  return error(502,'provider_error');
}
export function createCloudflareWorker({timeoutMs=22000}={}) {
  return {async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!['/summary','/health'].includes(path)) return error(404,'not_found');
    if (request.method !== (path === '/health' ? 'GET' : 'POST')) return error(405,'method_not_allowed');
    const secret = typeof env.LT_AI_SERVICE_TOKEN === 'string' ? env.LT_AI_SERVICE_TOKEN.trim() : '';
    if (!secret || env.LT_AI_FREE_TIER_CONFIRMED !== 'true' || !env.AI) return error(503,'unavailable');
    if (!authenticated(request, secret)) return error(401,'unauthenticated');
    if (path === '/health') return json({available:true});
    let bytes;
    try { bytes = await boundedBytes(request.body, IMAGE_LIMIT); }
    catch (cause) { return error(cause instanceof RangeError ? 413 : 400,'invalid_image'); }
    const mime = imageMime(bytes);
    if (!mime || request.headers.get('Content-Type') !== mime) return error(415,'invalid_image');
    let timer;
    let timedOut = false;
    const controller = new AbortController();
    try {
      // One bounded inference; no automatic retry, provider fallback, or paid upgrade.
      // A client cancellation stops waiting; already accepted inference may still complete.
      const input = {
        max_completion_tokens:700,
        store:false,
        response_format:{type:'json_object'},
        reasoning_effort:'low',
        chat_template_kwargs:{enable_thinking:false},
        messages:[
          {role:'system',content:PROMPT},
          {role:'user',content:[{type:'text',text:'この画像の見える事実を要約してください。'},{type:'image_url',image_url:{url:`data:${mime};base64,${base64(bytes)}`}}]}
        ]
      };
      const response = await Promise.race([
        env.AI.run(MODEL,input,{signal:AbortSignal.any([request.signal,controller.signal])}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(Error('3007: timeout'));},Math.min(22000,Math.max(1,timeoutMs)));})
      ]);
      const content = response?.choices?.[0]?.message?.content ?? response?.response;
      if (typeof content !== 'string' || content.length > 16384) return error(502,'invalid_result');
      let value;
      try { value = JSON.parse(content); } catch { return error(502,'invalid_result'); }
      if (!value || typeof value.summary !== 'string' || typeof value.readable !== 'boolean' || Array.from(value.summary).length > 140) return error(502,'invalid_result');
      if (!value.readable) return error(422,'unreadable');
      const text = value.summary.trim();
      return text ? json({text}) : error(502,'invalid_result');
    } catch (cause) { return timedOut ? error(504,'timeout') : providerError(cause); }
    finally {clearTimeout(timer);}
  }};
}
export default createCloudflareWorker();
