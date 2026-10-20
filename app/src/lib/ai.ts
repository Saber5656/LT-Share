import { prepareSummaryImage } from './summaryImage.ts';

export type AiInput = { image: Blob; tags: string[]; signal?: AbortSignal };
export type AiProvider = { generate(input: AiInput): Promise<string> };
export type AiStatus = { available: boolean; provider?: 'cloudflare'; model?: string; reason?: string };
export class AiQuotaError extends Error {
  constructor(message = 'AI usage limit reached') { super(message); this.name = 'AiQuotaError'; }
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export async function loadAiStatus(fetcher: Fetcher = fetch): Promise<AiStatus> {
  try {
    const response = await fetcher('/api/ai/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { available: false, reason: 'unavailable' };
    const data = await response.json();
    return { available: data.available === true && data.provider === 'cloudflare', provider: data.provider === 'cloudflare' ? data.provider : undefined, model: typeof data.model === 'string' ? data.model : undefined, reason: typeof data.reason === 'string' ? data.reason : undefined };
  } catch { return { available: false, reason: 'unavailable' }; }
}
export function createHttpAiProvider(fetcher: Fetcher = fetch, prepare: (blob: Blob, signal?: AbortSignal) => Promise<Blob> = async blob => blob): AiProvider {
  return { async generate({ image, tags, signal }) {
    signal?.throwIfAborted();
    const prepared = await prepare(image, signal);
    signal?.throwIfAborted();
    const form = new FormData(); form.set('image', prepared, 'lt-summary.jpg'); form.set('tags', JSON.stringify(tags));
    const response = await fetcher('/api/summary', { method: 'POST', headers: { 'X-LT-Share-Request': 'summary-v1' }, body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000) });
    if (response.status === 429) throw new AiQuotaError();
    if (!response.ok) throw new Error(response.status === 422 ? 'Image cannot be read' : 'Summary unavailable');
    const data = await response.json();
    if (typeof data.text !== 'string' || !data.text.trim() || Array.from(data.text).length > 140) throw new Error('Invalid summary');
    return data.text.trim();
  } };
}
export function getAiProvider(): AiProvider { return createHttpAiProvider(fetch, prepareSummaryImage); }
