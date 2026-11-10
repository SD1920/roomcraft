// POST /api/detect: one camera frame in, furniture boxes out, via Gemini.
//
// Runs on the LAPTOP, inside the Vite dev server (see vite.config.js), so
// the Gemini API key never reaches the phone. The same handleDetect() is
// what the team's Express backend should call; only the wiring differs:
//
//   import { handleDetect } from './gemini_detect.js'
//   app.post('/api/detect', express.json({ limit: '4mb' }), async (req, res) => {
//     try { res.json(await handleDetect(req.body, { apiKey: process.env.GEMINI_API_KEY })) }
//     catch (e) { res.status(e.status || 500).json({ error: e.message }) }
//   })
//
// Request body:  { image: <base64 JPEG, no data: prefix>, width, height }
// Response body: { items: [{label, score, box: {x, y, w, h}}], dropped, model, ms }

import { readFileSync } from 'node:fs';
import { buildRequest, parseResponse } from '../src/roomscan/detect/gemini_format.js';

// "-latest" follows Google's current Flash model. Set GEMINI_MODEL in
// .env.local to pin one; if this name stops existing, Gemini's error says so.
export const DEFAULT_MODEL = 'gemini-flash-latest';
// Tried, in order, when the main model stays busy. Set GEMINI_FALLBACK_MODELS
// (comma-separated) in .env.local to change them.
export const DEFAULT_FALLBACK_MODELS = ['gemini-flash-lite-latest'];
const RETRY_STATUSES = new Set([429, 500, 503]);
const ATTEMPTS_PER_MODEL = 2;
const RETRY_WAIT_MS = 1500;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const catalog = JSON.parse(readFileSync(new URL('../src/roomscan/data/furniture_catalog.json', import.meta.url), 'utf8'));

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * @param body {image, width, height}
 * @param options.apiKey Gemini API key (required)
 * @param options.model model name, default DEFAULT_MODEL
 * @param options.fallbackModels tried in order when `model` stays busy
 * @param options.fetch fetch implementation, for tests
 * @param options.sleep wait function, for tests
 */
export async function handleDetect(body, {
  apiKey,
  model = DEFAULT_MODEL,
  fallbackModels = DEFAULT_FALLBACK_MODELS,
  fetch: doFetch = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  if (!apiKey) throw fail(503, 'No Gemini API key on the server. Laptop: put GEMINI_API_KEY in .env.local and restart. Vercel: add it under Settings > Environment Variables and redeploy.');
  const { image, width, height } = body ?? {};
  if (typeof image !== 'string' || image.length === 0) throw fail(400, 'No image sent.');
  if (image.length * 0.75 > MAX_IMAGE_BYTES) throw fail(413, 'Image too large.');
  if (!(width > 0 && height > 0)) throw fail(400, 'Image width and height are required.');

  const t0 = Date.now();
  const request = JSON.stringify(buildRequest(image, catalog.types));
  const tried = [];
  let last = null;
  // First phone run with a key: "503: This model is currently experiencing
  // high demand". Busy and rate-limited answers are retried after a short
  // wait, then the next model is tried; anything else (bad key, wrong model
  // name, bad request) fails at once, because waiting will not fix it.
  for (const name of [model, ...fallbackModels.filter((m) => m && m !== model)]) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      if (attempt > 0) await sleep(RETRY_WAIT_MS * attempt);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`;
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: request,
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        const { items, dropped } = parseResponse(json, catalog.types, width, height);
        return { items, dropped, model: name, tried: [...tried, name], ms: Date.now() - t0 };
      }
      // pass Gemini's own reason through: a wrong model name, a bad key and a
      // rate limit each need a different fix
      last = { status: res.status, message: json?.error?.message ?? 'no details' };
      if (!RETRY_STATUSES.has(res.status)) {
        throw fail(res.status === 429 ? 429 : 502, `Gemini (${name}) said ${res.status}: ${last.message}`);
      }
    }
    tried.push(name);
  }
  throw fail(last.status === 429 ? 429 : 503,
    `Gemini is busy (tried ${tried.join(', ')}; last said ${last.status}: ${last.message}). Try Detect again in a minute.`);
}

/** Connect/Vite middleware around handleDetect. */
export function detectMiddleware(env) {
  return async (req, res) => {
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    try {
      // Vercel has already parsed a JSON body; Vite's dev server has not
      let body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : null;
      if (!body) {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES * 1.5) return send(413, { error: 'Request too large.' });
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      send(200, await handleDetect(body, {
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || DEFAULT_MODEL,
        fallbackModels: env.GEMINI_FALLBACK_MODELS
          ? env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
          : DEFAULT_FALLBACK_MODELS,
      }));
    } catch (e) {
      send(e.status || 500, { error: e.message });
    }
  };
}
