/** A reduced copy for inference. The original remains untouched in device storage. */
export function fitSummaryImage(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) throw new Error('Invalid image size');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Keep endpoints inside the playable range; short clips still get a middle/end view. */
export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration unavailable');
  const count = Math.min(12, Math.max(3, Math.ceil(duration / 5) + 1));
  const end = duration - Math.min(0.05, duration / 10);
  return Array.from({length:count}, (_, index) => end * index / (count - 1));
}

/** Conservative: even small dim highlights can be slide text, so retain them. */
export function isNearBlackFrame(pixels: Uint8ClampedArray): boolean {
  let total = 0, peak = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
    total += luminance; peak = Math.max(peak, luminance);
  }
  return pixels.length === 0 || (total / (pixels.length / 4) < 5 && peak < 16);
}

function waitForMedia(element: HTMLMediaElement | HTMLImageElement, event: string, start: () => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      element.removeEventListener(event, ready);
      element.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('This media cannot be read'));
    const aborted = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error('Media preview timed out')), 15000);
    element.addEventListener(event, ready, {once:true});
    element.addEventListener('error', failed, {once:true});
    signal.addEventListener('abort', aborted, {once:true});
    try { signal.throwIfAborted(); start(); } catch (error) { finish(error); }
  });
}

function encode(canvas: HTMLCanvasElement, quality: number, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) { abort(); return; }
    try {
      canvas.toBlob(value => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(signal.reason);
        else if (value) resolve(value);
        else reject(new Error('Image conversion failed'));
      }, 'image/jpeg', quality);
    } catch (error) { signal.removeEventListener('abort', abort); reject(error); }
  });
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image conversion unavailable');
  return ctx;
}
function timestamp(seconds: number): string {
  const tenths = Math.floor(seconds * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2,'0')}.${tenths % 10}`;
}

async function videoSheet(video: HTMLVideoElement, signal: AbortSignal): Promise<Blob> {
  // MediaRecorder WebM often has no duration metadata. Seeking to its end lets
  // the decoder determine the real bound, without assuming it is a short clip.
  if (!Number.isFinite(video.duration)) {
    await waitForMedia(video, 'seeked', () => { video.currentTime = 1e10; }, signal);
  }
  const times = videoSampleTimes(video.duration);
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  if (!(video.videoWidth > 0 && video.videoHeight > 0)) throw new Error('Invalid video size');
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const labelHeight = 28, columns = Math.min(3, times.length);
  const sheet = document.createElement('canvas');
  sheet.width = width * columns; sheet.height = (height + labelHeight) * Math.ceil(times.length / columns);
  const ctx = context(sheet); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,sheet.width,sheet.height);
  const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
  const frameContext = context(frame);
  let kept = 0;
  for (const time of times) {
    signal.throwIfAborted();
    if (Math.abs(video.currentTime - time) > 0.001) {
      await waitForMedia(video, 'seeked', () => { video.currentTime = time; }, signal);
    }
    frameContext.drawImage(video, 0, 0, width, height);
    // Read the bounded thumbnail, retaining tiny highlights rather than using a dark mean alone.
    if (isNearBlackFrame(frameContext.getImageData(0,0,width,height).data)) continue;
    const x = (kept % columns) * width, y = Math.floor(kept / columns) * (height + labelHeight);
    ctx.drawImage(frame,x,y);
    ctx.fillStyle = '#000'; ctx.font = '18px sans-serif';
    ctx.fillText(`${kept + 1}  ${timestamp(time)}`,x + 8,y + height + 20);
    kept++;
  }
  if (!kept) throw new Error('No readable video frames');
  const output = document.createElement('canvas');
  output.width = width * Math.min(columns, kept);
  output.height = (height + labelHeight) * Math.ceil(kept / columns);
  context(output).drawImage(sheet,0,0);
  // Bound payload size without ever sending the original video.
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await encode(output,quality,signal);
    if (blob.size <= 3 * 1024 * 1024) return blob;
  }
  throw new Error('Image is too large');
}

export async function prepareSummaryImage(blob: Blob, abortSignal?: AbortSignal): Promise<Blob> {
  const signal = abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const element = blob.type.startsWith('video/') ? document.createElement('video') : new Image();
  try {
    if (element instanceof HTMLVideoElement) {
      element.muted = true; element.playsInline = true; element.preload = 'auto';
      await waitForMedia(element, 'loadeddata', () => { element.src = url; }, signal);
      return await videoSheet(element,signal);
    }
    await waitForMedia(element, 'load', () => { element.src = url; }, signal);
    const size = fitSummaryImage(element.naturalWidth,element.naturalHeight);
    const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    context(canvas).drawImage(element,0,0,size.width,size.height);
    const result = await encode(canvas,0.85,signal);
    if (result.size > 3 * 1024 * 1024) throw new Error('Image is too large');
    return result;
  } finally {
    if (element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
    else element.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
