// AI enlargement, done in tiles so large images can be enlarged more than once.
export interface Src { el: CanvasImageSource; w: number; h: number }

const TILE = 1024;          // core tile size sent to the AI (keeps each request small)
const OVERLAP = 32;         // extra context around each tile to hide seams
const PARALLEL = 4;         // tiles processed at the same time
export const MAX_OUT_PX = 120_000_000; // browser memory limit for the result
const MAX_SIDE = 30_000;    // browser canvas side limit

/** Largest useful factor (4 or 2) the browser can still hold, or 0 if none. */
export function nextScale(w: number, h: number): number {
  for (const s of [4, 2]) if (w * h * s * s <= MAX_OUT_PX && Math.max(w, h) * s <= MAX_SIDE) return s;
  return 0;
}

async function upscaleTile(c: HTMLCanvasElement, scale: number): Promise<HTMLImageElement> {
  const body = JSON.stringify({ image: c.toDataURL('image/jpeg', 0.94), scale });
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('/api/upscale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 || r.status === 400) throw Object.assign(new Error(j.error || 'AI enlargement is not available.'), { fatal: true });
      if (!r.ok || !j.url) throw new Error(j.error || 'AI enlargement is not available right now.');
      const blob = await (await fetch(j.url)).blob();
      const url = URL.createObjectURL(blob);
      return await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('The enlarged image could not be opened.'));
        i.src = url;
      });
    } catch (e) {
      lastErr = e as Error;
      if ((e as { fatal?: boolean }).fatal) break;
      await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
    }
  }
  throw lastErr!;
}

export async function enlargeTiled(src: Src, scale: number, onProgress: (done: number, total: number) => void): Promise<Src> {
  const out = document.createElement('canvas');
  out.width = src.w * scale; out.height = src.h * scale;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('This image is too large for your browser to enlarge further.');

  const tiles: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < src.h; y += TILE) for (let x = 0; x < src.w; x += TILE)
    tiles.push({ x, y, w: Math.min(TILE, src.w - x), h: Math.min(TILE, src.h - y) });

  let done = 0, next = 0;
  onProgress(0, tiles.length);
  const worker = async () => {
    while (next < tiles.length) {
      const t = tiles[next++];
      // tile plus surrounding context
      const sx = Math.max(0, t.x - OVERLAP), sy = Math.max(0, t.y - OVERLAP);
      const ex = Math.min(src.w, t.x + t.w + OVERLAP), ey = Math.min(src.h, t.y + t.h + OVERLAP);
      const c = document.createElement('canvas');
      c.width = ex - sx; c.height = ey - sy;
      c.getContext('2d')!.drawImage(src.el, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
      const big = await upscaleTile(c, scale);
      const k = big.naturalWidth / c.width; // actual factor returned
      octx.drawImage(big, (t.x - sx) * k, (t.y - sy) * k, t.w * k, t.h * k, t.x * scale, t.y * scale, t.w * scale, t.h * scale);
      URL.revokeObjectURL(big.src);
      onProgress(++done, tiles.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tiles.length) }, worker));
  return { el: out, w: out.width, h: out.height };
}
