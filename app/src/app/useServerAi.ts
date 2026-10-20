import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAiProvider, loadAiStatus, type AiProvider } from '../lib/ai.ts';
export type ServerAiView = {phase: 'checking' | 'ready' | 'unavailable'; reason?: string};
export function useServerAi() {
  const [state, setState] = useState<ServerAiView>({phase:'checking'});
  const revision = useRef(0);
  const active = useRef<AbortController | null>(null);
  const cancel = useCallback(() => { active.current?.abort(); active.current = null; }, []);
  const recheck = useCallback(async () => {
    const current = ++revision.current;
    setState({phase:'checking'});
    const status = await loadAiStatus();
    if (revision.current === current) setState({phase:status.available?'ready':'unavailable',reason:status.reason});
  }, []);
  useEffect(() => { void recheck(); return () => { revision.current++; cancel(); }; }, [recheck,cancel]);
  const provider = useMemo<AiProvider>(() => ({async generate(input) {
    cancel();
    const controller = new AbortController(); active.current = controller;
    try { return await getAiProvider().generate({...input,signal:controller.signal}); }
    finally { if(active.current === controller) active.current = null; }
  }}), [cancel]);
  return {state,recheck,cancel,provider};
}
