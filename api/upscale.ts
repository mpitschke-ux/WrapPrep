// Serverless function (Vercel). Sends an image to Replicate's Real-ESRGAN model
// and returns the enlarged image's URL. Needs REPLICATE_API_TOKEN set in the host.
import type { VercelRequest, VercelResponse } from '@vercel/node';

const VERSION =
  process.env.REPLICATE_MODEL_VERSION ||
  'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa'; // nightmareai/real-esrgan

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(503).json({ error: 'AI enlargement is not set up yet on this site.' });

  const { image, scale } = (req.body || {}) as { image?: string; scale?: number };
  if (!image || !image.startsWith('data:image/')) return res.status(400).json({ error: 'No image received.' });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait=55' };
  let r = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ version: VERSION, input: { image, scale: Math.min(4, Math.max(2, scale || 4)), face_enhance: false } }),
  });
  let pred = await r.json();
  const started = Date.now();
  while (pred && !['succeeded', 'failed', 'canceled'].includes(pred.status) && Date.now() - started < 55000) {
    await new Promise((s) => setTimeout(s, 1500));
    r = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } });
    pred = await r.json();
  }
  if (pred?.status !== 'succeeded') {
    return res.status(502).json({ error: pred?.error || pred?.detail || 'The enlargement did not finish. Please try again.' });
  }
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  return res.status(200).json({ url });
}
