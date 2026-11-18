import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export interface Crop { x: number; y: number; w: number; h: number }

/** Draw the chosen part of the image at its native pixels (no fake resolution). */
export function renderCrop(img: CanvasImageSource, crop: Crop, mirror: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(crop.w));
  c.height = Math.max(1, Math.round(crop.h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (mirror) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  return c;
}

function canvasToBytes(c: HTMLCanvasElement, type: string, q?: number): Promise<Uint8Array> {
  return new Promise((res, rej) =>
    c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('Could not encode image'))), type, q),
  );
}

export interface PdfOpts {
  trimWIn: number;
  trimHIn: number;
  bleedIn: number;
  scale: number; // 1 = full size, 0.1 = 1:10
  title: string;
}

export async function makePdf(canvas: HTMLCanvasElement, o: PdfOpts): Promise<Uint8Array> {
  const pt = 72 * o.scale;
  const W = (o.trimWIn + 2 * o.bleedIn) * pt;
  const H = (o.trimHIn + 2 * o.bleedIn) * pt;
  const b = o.bleedIn * pt;
  const doc = await PDFDocument.create();
  doc.setTitle(o.title);
  doc.setCreator('WrapPrep');
  const jpg = await doc.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.95));
  const page = doc.addPage([W, H]);
  page.drawImage(jpg, { x: 0, y: 0, width: W, height: H });
  page.setBleedBox(0, 0, W, H);
  page.setTrimBox(b, b, W - 2 * b, H - 2 * b);
  if (o.scale !== 1) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(1 / o.scale));
  return doc.save();
}

/** Uncompressed RGB TIFF with the resolution tag set so it opens at the true physical size. */
export function makeTiff(canvas: HTMLCanvasElement, dpi: number): Uint8Array {
  const w = canvas.width, h = canvas.height;
  const rgba = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const pixelBytes = w * h * 3;
  const nTags = 13;
  const ifdSize = 2 + nTags * 12 + 4;
  const headerSize = 8;
  const extraOff = headerSize + ifdSize; // BitsPerSample(6) + XRes(8) + YRes(8)
  const dataOff = extraOff + 22;
  const buf = new ArrayBuffer(dataOff + pixelBytes);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  v.setUint16(0, 0x4949);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  let p = 8;
  v.setUint16(p, nTags, true); p += 2;
  const tag = (id: number, type: number, count: number, value: number) => {
    v.setUint16(p, id, true); v.setUint16(p + 2, type, true); v.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(p + 8, value, true); else v.setUint32(p + 8, value, true);
    p += 12;
  };
  tag(256, 4, 1, w);
  tag(257, 4, 1, h);
  tag(258, 3, 3, extraOff);
  tag(259, 3, 1, 1);
  tag(262, 3, 1, 2);
  tag(273, 4, 1, dataOff);
  tag(277, 3, 1, 3);
  tag(278, 4, 1, h);
  tag(279, 4, 1, pixelBytes);
  tag(282, 5, 1, extraOff + 6);
  tag(283, 5, 1, extraOff + 14);
  tag(284, 3, 1, 1);
  tag(296, 3, 1, 2);
  v.setUint32(p, 0, true);
  v.setUint16(extraOff, 8, true); v.setUint16(extraOff + 2, 8, true); v.setUint16(extraOff + 4, 8, true);
  const num = Math.round(dpi * 10000);
  v.setUint32(extraOff + 6, num, true); v.setUint32(extraOff + 10, 10000, true);
  v.setUint32(extraOff + 14, num, true); v.setUint32(extraOff + 18, 10000, true);
  let o = dataOff;
  for (let i = 0; i < rgba.length; i += 4) {
    u8[o++] = rgba[i]; u8[o++] = rgba[i + 1]; u8[o++] = rgba[i + 2];
  }
  return u8;
}

export function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
