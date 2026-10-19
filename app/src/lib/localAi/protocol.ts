export type WorkerRequest =
  | { type: 'load'; id: number }
  | { type: 'generate'; id: number; image: Blob };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: number; label?: string }
  | { type: 'loaded'; id: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; code: 'unsupported' | 'unreadable' | 'failed'; message?: string };

export interface LocalAiState {
  phase: 'idle' | 'loading' | 'ready' | 'generating' | 'error' | 'unsupported';
  progress?: number;
  message?: string;
}
