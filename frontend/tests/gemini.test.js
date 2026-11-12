import { describe, it, expect } from 'vitest';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';
import { buildRequest, parseResponse, EXTRA_TYPES } from '../src/roomscan/detect/gemini_format.js';
import { handleDetect } from '../server/gemini_detect.js';

const TYPES = catalogFile.types;

function reply(items) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] };
}

describe('buildRequest', () => {
  const body = buildRequest('QUJD', TYPES);

  it('sends the image and asks for JSON', () => {
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('holds Gemini to the app\'s 86 types plus door, window and other', () => {
    const allowed = body.generationConfig.responseSchema.properties.items.items.properties.type.enum;
    expect(allowed).toHaveLength(TYPES.length + EXTRA_TYPES.length);
    expect(allowed).toContain('almirah');
    expect(allowed).toContain('door');
  });

  it('tells it that an almirah is not a fridge', () => {
    expect(body.contents[0].parts[1].text).toMatch(/almirah/);
  });
});

describe('parseResponse', () => {
  it('turns 0-1000 boxes into frame pixels', () => {
    const { items, dropped } = parseResponse(reply([{ type: 'almirah', box_2d: [100, 250, 900, 750], confidence: 0.9 }]), TYPES, 640, 1400);
    expect(dropped).toBe(0);
    expect(items).toEqual([{ label: 'almirah', score: 0.9, box: { x: 160, y: 140, w: 320, h: 1120 } }]);
  });

  it('drops a type the app does not have, and a malformed box, and counts them', () => {
    const { items, dropped } = parseResponse(reply([
      { type: 'spaceship', box_2d: [0, 0, 10, 10] },
      { type: 'bed', box_2d: [500, 500, 400, 600] },        // ymax before ymin
      { type: 'bed', box_2d: [0, 0, 1200, 10] },           // off the 0-1000 scale
      { type: 'bed', box_2d: [10, 10, 20] },               // three numbers
      { type: 'desk', box_2d: [300, 100, 700, 500] },
    ]), TYPES, 100, 100);
    expect(items.map((i) => i.label)).toEqual(['desk']);
    expect(dropped).toBe(4);
  });

  it('accepts an answer wrapped in a code fence', () => {
    const json = { candidates: [{ content: { parts: [{ text: '```json\n{"items":[{"type":"door","box_2d":[0,0,1000,500]}]}\n```' }] } }] };
    expect(parseResponse(json, TYPES, 10, 10).items[0].label).toBe('door');
  });

  it('keeps a missing confidence as unknown rather than inventing one', () => {
    const { items } = parseResponse(reply([{ type: 'bed', box_2d: [0, 0, 500, 500] }]), TYPES, 10, 10);
    expect(items[0].score).toBeNull();
  });

  it('says why when there is no answer', () => {
    expect(() => parseResponse({ promptFeedback: { blockReason: 'SAFETY' } }, TYPES, 1, 1)).toThrow(/SAFETY/);
    expect(() => parseResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }, TYPES, 1, 1)).toThrow(/not valid JSON/);
  });
});

describe('handleDetect', () => {
  const ok = (json) => async () => ({ ok: true, status: 200, json: async () => json });
  const body = { image: 'QUJD', width: 640, height: 1400 };

  it('refuses to run without an API key, with a fix in the message', async () => {
    await expect(handleDetect(body, {})).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/GEMINI_API_KEY/) });
  });

  it('refuses a request with no image or no size', async () => {
    await expect(handleDetect({ width: 1, height: 1 }, { apiKey: 'k', fetch: ok({}) })).rejects.toMatchObject({ status: 400 });
    await expect(handleDetect({ image: 'QUJD' }, { apiKey: 'k', fetch: ok({}) })).rejects.toMatchObject({ status: 400 });
  });

  it('calls the model with the key in a header, never in the URL', async () => {
    let seen;
    const fetchSpy = async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => reply([{ type: 'bed', box_2d: [100, 100, 900, 900] }]) };
    };
    const out = await handleDetect(body, { apiKey: 'secret-key', model: 'some-model', fetch: fetchSpy });
    expect(seen.url).toMatch(/models\/some-model:generateContent$/);
    expect(seen.url).not.toMatch(/secret-key/);
    expect(seen.init.headers['x-goog-api-key']).toBe('secret-key');
    expect(out.items[0].label).toBe('bed');
    expect(out.model).toBe('some-model');
  });

  it('passes Gemini\'s own error message through', async () => {
    const bad = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'models/x is not found' } }) });
    await expect(handleDetect(body, { apiKey: 'k', model: 'x', fetch: bad }))
      .rejects.toMatchObject({ status: 502, message: expect.stringMatching(/404: models\/x is not found/) });
  });

  const noWait = async () => {};

  it('keeps a rate limit recognisable after retrying', async () => {
    const limited = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) });
    await expect(handleDetect(body, { apiKey: 'k', fetch: limited, sleep: noWait })).rejects.toMatchObject({ status: 429 });
  });

  it('retries a busy model and succeeds when it recovers', async () => {
    const calls = [];
    const flaky = async (url) => {
      calls.push(url);
      return calls.length === 1
        ? { ok: false, status: 503, json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } }) }
        : { ok: true, status: 200, json: async () => reply([{ type: 'bed', box_2d: [0, 0, 500, 500] }]) };
    };
    const out = await handleDetect(body, { apiKey: 'k', model: 'main', fallbackModels: ['spare'], fetch: flaky, sleep: noWait });
    expect(calls).toHaveLength(2);
    expect(out.model).toBe('main');
  });

  it('moves to the fallback model when the main one stays busy', async () => {
    const urls = [];
    const busyMain = async (url) => {
      urls.push(url);
      return url.includes('/main:')
        ? { ok: false, status: 503, json: async () => ({ error: { message: 'busy' } }) }
        : { ok: true, status: 200, json: async () => reply([{ type: 'almirah', box_2d: [0, 0, 900, 400] }]) };
    };
    const out = await handleDetect(body, { apiKey: 'k', model: 'main', fallbackModels: ['spare'], fetch: busyMain, sleep: noWait });
    expect(out.model).toBe('spare');
    expect(out.tried).toEqual(['main', 'spare']);
    expect(urls.filter((u) => u.includes('/main:'))).toHaveLength(2);
  });

  it('says it is busy, naming what it tried, when every model stays busy', async () => {
    const busy = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) });
    await expect(handleDetect(body, { apiKey: 'k', model: 'main', fallbackModels: ['spare'], fetch: busy, sleep: noWait }))
      .rejects.toMatchObject({ status: 503, message: expect.stringMatching(/busy \(tried main, spare/) });
  });

  it('does not retry a mistake that waiting cannot fix', async () => {
    let n = 0;
    const badKey = async () => { n += 1; return { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) }; };
    await expect(handleDetect(body, { apiKey: 'k', fetch: badKey, sleep: noWait })).rejects.toMatchObject({ status: 502 });
    expect(n).toBe(1);
  });
});
