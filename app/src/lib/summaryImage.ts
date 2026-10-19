/** A reduced copy for inference. The original remains untouched in device storage. */
export function fitSummaryImage(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) throw new Error('Invalid image size');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function prepareSummaryImage(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  const video = blob.type.startsWith('video/');
  const element = video ? document.createElement('video') : new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Media preview timed out')), 15000);
      const finish = (error?: Error) => { clearTimeout(timer); element.onerror = null; if (error) reject(error); else resolve(); };
      element.onerror = () => finish(new Error('This media cannot be read'));
      if (element instanceof HTMLVideoElement) {
        element.muted = true; element.playsInline = true; element.preload = 'auto';
        element.onloadeddata = () => {
          const target = Number.isFinite(element.duration) ? Math.min(1, element.duration / 2) : 0;
          if (target > 0) { element.onseeked = () => finish(); element.currentTime = target; }
          else finish();
        };
      } else element.onload = () => finish();
      element.src = url;
    });
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
    const size = fitSummaryImage(width, height), canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image conversion unavailable');
    context.drawImage(element, 0, 0, size.width, size.height);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/jpeg', 0.85));
    if (result.size > 3 * 1024 * 1024) throw new Error('Image is too large');
    return result;
  } finally {
    if (element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
    URL.revokeObjectURL(url);
  }
}
