import { checkLocalAiSupport, type LocalGpu } from './summary.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import type { loadLocalModel } from './runtime.ts';

let model: Awaited<ReturnType<typeof loadLocalModel>> | null = null;
let busy = false;
const send = (data:WorkerResponse) => self.postMessage(data);
self.addEventListener('message', async (event:MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || !Number.isInteger(request.id) || !['load','generate'].includes(request.type)) return;
  if (busy) { send({type:'error',id:request.id,code:'failed'}); return; }
  busy = true;
  try {
    if (request.type === 'load') {
      if (!await checkLocalAiSupport((navigator as unknown as {gpu?:LocalGpu}).gpu)) {
        send({type:'error',id:request.id,code:'unsupported'}); return;
      }
      // Loaded only after the person explicitly starts preparation.
      const runtime = await import('./runtime.ts');
      model = await runtime.loadLocalModel(progress => send({type:'progress',id:request.id,progress}));
      send({type:'loaded',id:request.id});
    } else {
      if (!model || !(request.image instanceof Blob)) throw new Error('not ready');
      send({type:'result',id:request.id,text:await model.generate(request.image)});
    }
  } catch (error) {
    if (import.meta.env.DEV && (!(error instanceof Error) || error.message !== 'unreadable')) console.error('Local AI:',error instanceof Error ? error.message : String(error));
    send({type:'error',id:request.id,code:error instanceof Error && error.message === 'unreadable' ? 'unreadable' : 'failed'});
  } finally { busy = false; }
});
