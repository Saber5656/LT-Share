import type { LocalAiState, WorkerRequest } from './protocol.ts';
export type { LocalAiState } from './protocol.ts';

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  terminate(): void;
}
type Pending = {
  id: number;
  type: 'load' | 'generate';
  promise: Promise<unknown>;
  resolve: (value?: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class LocalAiClient {
  private state: LocalAiState = Object.freeze({ phase: 'idle' });
  private listeners = new Set<(state: LocalAiState) => void>();
  private worker?: WorkerLike;
  private pending?: Pending;
  private nextId = 0;
  private detach?: () => void;
  private createWorker: () => WorkerLike;
  private options: { loadTimeoutMs?: number; generationTimeoutMs?: number };

  constructor(createWorker: () => WorkerLike, options: { loadTimeoutMs?: number; generationTimeoutMs?: number } = {}) {
    this.createWorker = createWorker;
    this.options = options;
  }
  getSnapshot = (): LocalAiState => this.state;
  subscribe = (listener: (state: LocalAiState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: LocalAiState) {
    this.state = Object.freeze(state);
    for (const listener of [...this.listeners]) {
      // Subscriber failures must not strand the request or interrupt cleanup.
      try { listener(this.state); } catch { /* isolate consumers */ }
    }
  }
  prepare(): Promise<void> {
    if (this.pending?.type === 'load') return this.pending.promise as Promise<void>;
    if (this.state.phase === 'ready' || this.state.phase === 'generating') return Promise.resolve();
    if (this.state.phase === 'unsupported') return Promise.reject(new Error(this.state.message ?? 'Unsupported'));
    try {
      const worker = this.createWorker();
      this.worker = worker;
      const message: EventListener = event => {
        if (this.worker === worker) this.receive((event as MessageEvent).data);
      };
      const failure: EventListener = () => {
        if (this.worker === worker) this.fail(new Error('Worker communication failed'));
      };
      this.detach = () => {
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', failure);
        worker.removeEventListener('messageerror', failure);
      };
      worker.addEventListener('message', message);
      worker.addEventListener('error', failure);
      worker.addEventListener('messageerror', failure);
      return this.start({ type: 'load', id: ++this.nextId }) as Promise<void>;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.fail(failure);
      return Promise.reject(failure);
    }
  }
  generate(image: Blob): Promise<string> {
    if (this.pending) return Promise.reject(new Error('Local AI is busy'));
    if (this.state.phase !== 'ready' || !this.worker) return Promise.reject(new Error('Local AI is not ready'));
    return this.start({ type: 'generate', id: ++this.nextId, image }) as Promise<string>;
  }
  private start(request: WorkerRequest): Promise<unknown> {
    let resolve!: Pending['resolve'];
    let reject!: Pending['reject'];
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    const timeout = request.type === 'load' ? (this.options.loadTimeoutMs ?? 300_000) : (this.options.generationTimeoutMs ?? 120_000);
    const pending: Pending = {
      id: request.id, type: request.type, promise, resolve, reject,
      timer: setTimeout(() => {
        if (this.pending === pending) this.fail(new Error('Local AI request timed out'));
      }, timeout),
    };
    this.pending = pending;
    this.publish({ phase: request.type === 'load' ? 'loading' : 'generating', progress: 0 });
    // A subscriber may cancel synchronously during the state notification.
    if (this.pending === pending) {
      try { this.worker!.postMessage(request); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    }
    return promise;
  }
  private takePending() {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) clearTimeout(pending.timer);
    return pending;
  }
  private cleanup() {
    const worker = this.worker;
    this.worker = undefined;
    this.detach?.();
    this.detach = undefined;
    worker?.terminate();
  }
  private fail(error: Error, phase: 'error' | 'unsupported' = 'error') {
    const pending = this.takePending();
    this.cleanup();
    this.publish({ phase, message: error.message });
    pending?.reject(error);
  }
  private receive(data: unknown) {
    const pending = this.pending;
    if (!pending) return;
    if (!data || typeof data !== 'object') { this.fail(new Error('Malformed worker reply')); return; }
    const reply = data as Record<string, unknown>;
    if (typeof reply.id !== 'number' || !Number.isSafeInteger(reply.id)) {
      this.fail(new Error('Malformed worker reply')); return;
    }
    if (reply.id !== pending.id) return;
    if (reply.type === 'progress' && typeof reply.progress === 'number' && (reply.label === undefined || typeof reply.label === 'string')) {
      if (!Number.isFinite(reply.progress)) return;
      this.publish({ phase: pending.type === 'load' ? 'loading' : 'generating', progress: Math.min(1, Math.max(0, reply.progress)), ...(typeof reply.label === 'string' ? { message: reply.label } : {}) });
      return;
    }
    if ((reply.type === 'loaded' && pending.type === 'load') ||
        (reply.type === 'result' && pending.type === 'generate' && typeof reply.text === 'string')) {
      this.takePending();
      this.publish({ phase: 'ready' });
      pending.resolve(reply.type === 'result' ? reply.text : undefined);
      return;
    }
    if (reply.type === 'error' && typeof reply.code === 'string' && ['unsupported', 'unreadable', 'failed'].includes(reply.code) &&
        (reply.message === undefined || typeof reply.message === 'string')) {
      const error = new Error(typeof reply.message === 'string' ? reply.message : String(reply.code));
      if (reply.code === 'unsupported') this.fail(error, 'unsupported');
      else if (pending.type === 'load') this.fail(error);
      else {
        this.takePending();
        this.publish({ phase: 'ready', message: error.message });
        pending.reject(error);
      }
      return;
    }
    this.fail(new Error('Malformed worker reply'));
  }
  cancel(): void {
    const pending = this.takePending();
    this.cleanup();
    this.publish({ phase: 'idle' });
    pending?.reject(new DOMException('Local AI request cancelled', 'AbortError'));
  }
  dispose(): void {
    this.listeners.clear();
    this.cancel();
  }
}
