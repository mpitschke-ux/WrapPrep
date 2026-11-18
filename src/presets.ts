export type UseKind = 'vehicle' | 'window';

export interface Preset {
  id: string;
  label: string;
  kind: UseKind;
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  note?: string;
}

// Typical sizes only. Every vehicle differs, so always measure before printing.
export const PRESETS: Preset[] = [
  { id: 'trailer53', label: '53 ft trailer, one side', kind: 'vehicle', widthIn: 630, heightIn: 102, bleedIn: 3, note: 'Typical dry van. Measure rivet line to rivet line.' },
  { id: 'trailer48', label: '48 ft trailer, one side', kind: 'vehicle', widthIn: 570, heightIn: 102, bleedIn: 3 },
  { id: 'box26', label: '26 ft box truck, one side', kind: 'vehicle', widthIn: 312, heightIn: 96, bleedIn: 3 },
  { id: 'box16', label: '16 ft box truck, one side', kind: 'vehicle', widthIn: 192, heightIn: 90, bleedIn: 3 },
  { id: 'trailerRear', label: 'Trailer rear doors', kind: 'vehicle', widthIn: 98, heightIn: 108, bleedIn: 3 },
  { id: 'van', label: 'High-roof cargo van, one side', kind: 'vehicle', widthIn: 170, heightIn: 72, bleedIn: 3, note: 'Flat panel area only. Full van wraps need a vehicle template.' },
  { id: 'window', label: 'Storefront window', kind: 'window', widthIn: 72, heightIn: 96, bleedIn: 0.5 },
  { id: 'windowWide', label: 'Wide storefront window', kind: 'window', widthIn: 120, heightIn: 84, bleedIn: 0.5 },
  { id: 'custom', label: 'Custom size', kind: 'vehicle', widthIn: 120, heightIn: 48, bleedIn: 2 },
];

export type Unit = 'in' | 'ft' | 'cm' | 'm';
export const UNIT_TO_IN: Record<Unit, number> = { in: 1, ft: 12, cm: 1 / 2.54, m: 100 / 2.54 };

export function fmtLength(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rem = Math.round((inches - ft * 12) * 10) / 10;
  if (ft === 0) return `${rem}"`;
  return rem ? `${ft}' ${rem}"` : `${ft}'`;
}

export interface Rating {
  level: 'good' | 'ok' | 'poor';
  title: string;
  detail: string;
}

export function rateDpi(dpi: number, kind: UseKind): Rating {
  const [good, ok] = kind === 'window' ? [150, 75] : [72, 35];
  if (dpi >= good)
    return { level: 'good', title: 'Sharp', detail: 'This will look crisp, even up close.' };
  if (dpi >= ok)
    return {
      level: 'ok',
      title: 'Acceptable',
      detail:
        kind === 'window'
          ? 'Fine from a few steps back, a little soft for people standing at the glass. Enlarging with AI is recommended.'
          : 'Fine from a few feet away, which is how most vehicles are seen. Enlarging with AI would make it crisper.',
    };
  return {
    level: 'poor',
    title: 'Too low',
    detail: 'This will look blurry or blocky at this size. Enlarge it with AI or use a bigger image.',
  };
}
