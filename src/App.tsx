import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRESETS, UNIT_TO_IN, Unit, UseKind, fmtLength, rateDpi } from './presets';
import { Crop, download, makePdf, makeTiff, renderCrop } from './exporters';

type Panels = 'off' | 'v' | 'h';
const PDF_MAX_IN = 200; // PDF pages cannot exceed 200 inches at 100%

function round(n: number, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('That file could not be opened as an image.'));
    i.src = src;
  });
}

export default function App() {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [upscaled, setUpscaled] = useState(false);
  const [presetId, setPresetId] = useState('trailer53');
  const preset0 = PRESETS.find((p) => p.id === 'trailer53')!;
  const [kind, setKind] = useState<UseKind>(preset0.kind);
  const [unit, setUnit] = useState<Unit>('ft');
  const [wIn, setWIn] = useState(preset0.widthIn);
  const [hIn, setHIn] = useState(preset0.heightIn);
  const [bleedIn, setBleedIn] = useState(preset0.bleedIn);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [mirror, setMirror] = useState(false);
  const [panels, setPanels] = useState<Panels>('off');
  const [panelIn, setPanelIn] = useState(54);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewW, setViewW] = useState(900);

  const outW = wIn + 2 * bleedIn;
  const outH = hIn + 2 * bleedIn;
  const preset = PRESETS.find((p) => p.id === presetId);

  const crop: Crop | null = useMemo(() => {
    if (!img || outW <= 0 || outH <= 0) return null;
    const A = outW / outH;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    let cw: number, ch: number;
    if (iw / ih > A) { ch = ih; cw = ih * A; } else { cw = iw; ch = iw / A; }
    cw /= zoom; ch /= zoom;
    return { x: (iw - cw) * pos.x, y: (ih - ch) * pos.y, w: cw, h: ch };
  }, [img, outW, outH, zoom, pos]);

  const dpi = crop ? crop.w / outW : 0;
  const rating = rateDpi(dpi, kind);
  const target = kind === 'window' ? 150 : 72;

  // ----- loading -----
  const openFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) { setError('Please drop an image file (PNG, JPG or WebP).'); return; }
    try {
      const i = await loadImage(URL.createObjectURL(f));
      setImg(i); setFileName(f.name.replace(/\.[^.]+$/, '')); setUpscaled(false);
      setZoom(1); setPos({ x: 0.5, y: 0.5 });
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    const paste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
      if (f) openFile(f);
    };
    window.addEventListener('paste', paste);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); window.removeEventListener('paste', paste); };
  }, [openFile]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  // ----- preview -----
  const view = useMemo(() => {
    const maxH = 460;
    let w = viewW, h = (viewW * outH) / outW;
    if (h > maxH) { h = maxH; w = (maxH * outW) / outH; }
    return { w: Math.max(50, Math.floor(w)), h: Math.max(30, Math.floor(h)), ppi: w / outW };
  }, [viewW, outW, outH]);

  useEffect(() => {
    const c = canvasRef.current; if (!c || !img || !crop) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = view.w * dpr; c.height = view.h * dpr;
    c.style.width = `${view.w}px`; c.style.height = `${view.h}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    if (mirror) { ctx.translate(view.w, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, view.w, view.h);
    ctx.restore();
    const s = view.ppi, b = bleedIn * s;
    // bleed shading
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, view.w, b); ctx.fillRect(0, view.h - b, view.w, b);
    ctx.fillRect(0, b, b, view.h - 2 * b); ctx.fillRect(view.w - b, b, b, view.h - 2 * b);
    // trim line
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff3b6b';
    ctx.strokeRect(b, b, view.w - 2 * b, view.h - 2 * b);
    // safe zone (keep text/logos inside)
    const safe = (kind === 'window' ? 1 : 3) * s;
    ctx.setLineDash([2, 4]); ctx.strokeStyle = '#38e1ff';
    if (view.w - 2 * (b + safe) > 0 && view.h - 2 * (b + safe) > 0)
      ctx.strokeRect(b + safe, b + safe, view.w - 2 * (b + safe), view.h - 2 * (b + safe));
    // print panel seams
    if (panels !== 'off' && panelIn > 1) {
      ctx.setLineDash([10, 6]); ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 1;
      const step = panelIn * s;
      if (panels === 'v') for (let x = step; x < view.w - 1; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, view.h); ctx.stroke(); }
      else for (let y = step; y < view.h - 1; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(view.w, y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
  }, [img, crop, view, mirror, bleedIn, kind, panels, panelIn]);

  // drag to reposition
  const drag = useRef<{ x: number; y: number; pos: { x: number; y: number } } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pos };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !img || !crop) return;
    const k = crop.w / view.w; // image px per screen px
    const freeX = img.naturalWidth - crop.w, freeY = img.naturalHeight - crop.h;
    const dx = (e.clientX - drag.current.x) * k * (mirror ? -1 : 1);
    const dy = (e.clientY - drag.current.y) * k;
    setPos({
      x: freeX > 0.5 ? Math.min(1, Math.max(0, drag.current.pos.x - dx / freeX)) : 0.5,
      y: freeY > 0.5 ? Math.min(1, Math.max(0, drag.current.pos.y - dy / freeY)) : 0.5,
    });
  };
  const onPointerUp = () => { drag.current = null; };

  // ----- actions -----
  const choosePreset = (id: string) => {
    setPresetId(id);
    const p = PRESETS.find((x) => x.id === id)!;
    if (id !== 'custom') { setWIn(p.widthIn); setHIn(p.heightIn); setBleedIn(p.bleedIn); }
    setKind(p.kind);
    if (p.kind === 'window') setUnit('in');
  };

  const enlarge = async () => {
    if (!img) return;
    setError(''); setBusy('Enlarging with AI. This usually takes 20 to 60 seconds…');
    try {
      // keep the upload small enough for the server
      const maxPx = 2_000_000;
      const s = Math.min(1, Math.sqrt(maxPx / (img.naturalWidth * img.naturalHeight)));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const r = await fetch('/api/upscale', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: c.toDataURL('image/jpeg', 0.93), scale: 4 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw new Error(j.error || 'AI enlargement is not available right now.');
      const blob = await (await fetch(j.url)).blob();
      const big = await loadImage(URL.createObjectURL(blob));
      setImg(big); setUpscaled(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };

  const baseName = () => `${fileName || 'print'}_${round(wIn, 1)}x${round(hIn, 1)}in_bleed${bleedIn}in${mirror ? '_mirrored' : ''}`;

  const exportPdf = async () => {
    if (!img || !crop) return;
    setError(''); setBusy('Building PDF…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const fullSize = outW <= PDF_MAX_IN && outH <= PDF_MAX_IN;
      const canvas = renderCrop(img, crop, mirror);
      const bytes = await makePdf(canvas, { trimWIn: wIn, trimHIn: hIn, bleedIn, scale: fullSize ? 1 : 0.1, title: baseName() });
      download(bytes, `${baseName()}${fullSize ? '' : '_1-10scale'}.pdf`, 'application/pdf');
    } catch (e) { setError('Export failed: ' + (e as Error).message); }
    finally { setBusy(''); }
  };

  const exportTiff = async () => {
    if (!img || !crop) return;
    setError(''); setBusy('Building TIFF…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const canvas = renderCrop(img, crop, mirror);
      download(makeTiff(canvas, dpi), `${baseName()}.tif`, 'image/tiff');
    } catch (e) { setError('Export failed: ' + (e as Error).message + '. Try the PDF instead.'); }
    finally { setBusy(''); }
  };

  // ----- inputs in chosen unit -----
  const toUnit = (inches: number) => round(inches / UNIT_TO_IN[unit], unit === 'in' ? 2 : 3);
  const fromUnit = (v: string) => Math.max(0, parseFloat(v) || 0) * UNIT_TO_IN[unit];
  const pdfScaled = outW > PDF_MAX_IN || outH > PDF_MAX_IN;
  const needPx = { w: Math.ceil(outW * target), h: Math.ceil(outH * target) };

  return (
    <div className="app">
      <header>
        <div className="logo">Wrap<span>Prep</span></div>
        <p>Turn AI images into print-ready files for trucks, trailers and windows.</p>
      </header>

      {!img ? (
        <div
          className={`drop ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); openFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
        >
          <div className="drop-icon">⬆</div>
          <strong>Drag and drop your AI image here</strong>
          <span>or click to choose a file, or paste with Ctrl/Cmd+V</span>
          <span className="muted">PNG, JPG or WebP</span>
        </div>
      ) : null}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} />

      {error && <div className="alert">{error}</div>}

      {img && crop && (
        <div className="layout">
          <aside className="panel">
            <section>
              <h3>1. What is it for?</h3>
              <select value={presetId} onChange={(e) => choosePreset(e.target.value)}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {preset?.note && <p className="hint">{preset.note}</p>}
              <div className="seg">
                <button className={kind === 'vehicle' ? 'on' : ''} onClick={() => setKind('vehicle')}>Vehicle / trailer</button>
                <button className={kind === 'window' ? 'on' : ''} onClick={() => setKind('window')}>Window</button>
              </div>
            </section>

            <section>
              <h3>2. Finished size</h3>
              <div className="seg small">
                {(['in', 'ft', 'cm', 'm'] as Unit[]).map((u) => (
                  <button key={u} className={unit === u ? 'on' : ''} onClick={() => setUnit(u)}>{u}</button>
                ))}
              </div>
              <div className="row">
                <label>Width<input type="number" min={0} step="any" value={toUnit(wIn)} onChange={(e) => { setWIn(fromUnit(e.target.value)); setPresetId('custom'); }} /></label>
                <label>Height<input type="number" min={0} step="any" value={toUnit(hIn)} onChange={(e) => { setHIn(fromUnit(e.target.value)); setPresetId('custom'); }} /></label>
              </div>
              <label>Bleed on each side (inches)
                <input type="number" min={0} step={0.25} value={bleedIn} onChange={(e) => setBleedIn(Math.max(0, parseFloat(e.target.value) || 0))} />
              </label>
              <p className="hint">Bleed is extra image past the edge that gets trimmed or wrapped around. Wraps usually use 2 to 3 inches, windows about half an inch.</p>
            </section>

            <section>
              <h3>3. Position</h3>
              <label>Zoom in <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} /></label>
              <p className="hint">Drag the picture to move it.</p>
              <label className="check"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror it (for printing on the inside of glass)</label>
              <label>Show print panel seams
                <select value={panels} onChange={(e) => setPanels(e.target.value as Panels)}>
                  <option value="off">Off</option>
                  <option value="v">Vertical panels</option>
                  <option value="h">Horizontal panels</option>
                </select>
              </label>
              {panels !== 'off' && (
                <label>Panel width (inches)<input type="number" min={6} value={panelIn} onChange={(e) => setPanelIn(parseFloat(e.target.value) || 0)} /></label>
              )}
            </section>
          </aside>

          <main>
            <div className="preview" ref={wrapRef}>
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
              />
            </div>
            <div className="legend">
              <span><i className="l-trim" /> Cut line</span>
              <span><i className="l-bleed" /> Bleed (trimmed off)</span>
              <span><i className="l-safe" /> Keep text and logos inside</span>
              {panels !== 'off' && <span><i className="l-panel" /> Panel seams</span>}
            </div>

            <div className={`quality ${rating.level}`}>
              <div className="q-badge">{rating.title}</div>
              <div>
                <strong>{Math.round(dpi)} dots per inch at full size</strong>
                <p>{rating.detail}</p>
                <p className="muted">
                  Your image is {img.naturalWidth.toLocaleString()} × {img.naturalHeight.toLocaleString()} pixels{upscaled ? ' (AI enlarged)' : ''}.
                  For "Sharp" at {fmtLength(outW)} × {fmtLength(outH)} with bleed you'd want about {needPx.w.toLocaleString()} × {needPx.h.toLocaleString()} pixels.
                </p>
              </div>
            </div>

            <div className="actions">
              {!upscaled && rating.level !== 'good' && (
                <button className="primary" disabled={!!busy} onClick={enlarge}>✨ Enlarge with AI (4×)</button>
              )}
              <button className={upscaled || rating.level === 'good' ? 'primary' : ''} disabled={!!busy} onClick={exportPdf}>Download PDF</button>
              <button disabled={!!busy} onClick={exportTiff}>Download TIFF</button>
              <button className="ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>Use a different image</button>
            </div>
            {busy && <div className="busy"><span className="spinner" /> {busy}</div>}

            <div className="summary">
              <div><span>Finished size</span><b>{fmtLength(wIn)} × {fmtLength(hIn)}</b></div>
              <div><span>With bleed</span><b>{fmtLength(outW)} × {fmtLength(outH)}</b></div>
              <div><span>PDF</span><b>{pdfScaled ? '1:10 scale (normal for large wraps; tell your printer)' : 'Full size, 100%'}</b></div>
            </div>
          </main>
        </div>
      )}
      <footer>Sizes are typical starting points. Always measure the actual vehicle or window and confirm file needs with your print shop.</footer>
    </div>
  );
}
