import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocalAiClient } from '../lib/localAi/client.ts';
import { checkLocalAiSupport, type LocalGpu } from '../lib/localAi/summary.ts';
import type { LocalAiState } from '../lib/localAi/protocol.ts';
import type { AiProvider } from '../lib/ai.ts';
import { prepareSummaryImage } from '../lib/summaryImage.ts';

export type LocalAiView = LocalAiState | {phase:'checking'};
export function useLocalAi() {
  const [client] = useState(() => new LocalAiClient(() => new Worker(new URL('../lib/localAi/worker.ts',import.meta.url),{type:'module'})));
  const [supported,setSupported] = useState<boolean|null>(null);
  const [state,setState] = useState(client.getSnapshot());
  useEffect(() => {
    let alive=true;
    const unsubscribe=client.subscribe(setState);
    void checkLocalAiSupport((navigator as unknown as {gpu?:LocalGpu}).gpu).then(value => {if(alive)setSupported(value);});
    return () => {alive=false;unsubscribe();client.dispose();};
  },[client]);
  const prepare = useCallback(async () => { if (supported) await client.prepare(); },[client,supported]);
  const cancel = useCallback(() => client.cancel(),[client]);
  const provider = useMemo<AiProvider>(() => ({async generate({image}) {
    // Capture cancellation before video decoding finishes, too.
    const before = client.getSnapshot();
    if (before.phase !== 'ready') throw new Error('Model is not ready');
    const prepared = await prepareSummaryImage(image);
    if (client.getSnapshot() !== before) throw new DOMException('Cancelled','AbortError');
    return client.generate(prepared);
  }}),[client]);
  const view:LocalAiView = supported === null ? {phase:'checking'} : !supported ? {phase:'unsupported'} : state;
  return {state:view,prepare,cancel,provider};
}
