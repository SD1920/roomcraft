// Asking Gemini what furniture is in a camera frame, and checking its answer.
//
// Pure: builds the request body and reads the response, no network. Shared by
// the laptop's dev endpoint (server/gemini_detect.js) and, later, the team
// backend, so both send and accept exactly the same thing.
//
// Gemini is held to the app's own type ids by structured output: `type` is
// an enum of the 86 catalog ids plus door, window and other, so it cannot
// invent a name the app does not know. Boxes come back in Gemini's native
// form, [ymin, xmin, ymax, xmax] scaled to 0-1000.

export const EXTRA_TYPES = ['door', 'window', 'other'];

export function promptText(catalogTypes) {
  const names = catalogTypes.map((t) => `${t.id} (${t.name})`).join(', ');
  return [
    'This is a photo taken inside a room in an Indian home, college or office.',
    'List every piece of furniture, appliance, door and window you can see.',
    'For each, give `type`: the closest match from this list of ids:',
    `${names}, door, window. Use "other" if nothing fits.`,
    'An almirah or tall steel or wooden cupboard is "almirah" or "wardrobe", not a fridge.',
    'Give `box_2d` as [ymin, xmin, ymax, xmax] scaled to 0-1000, around the whole object.',
    'Give `confidence` from 0 to 1. Do not list people, bags, clothes or small objects.',
  ].join(' ');
}

/** The generateContent request body for one JPEG frame. */
export function buildRequest(jpegBase64, catalogTypes) {
  const ids = [...catalogTypes.map((t) => t.id), ...EXTRA_TYPES];
  return {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        { text: promptText(catalogTypes) },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING', enum: ids },
                box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
                confidence: { type: 'NUMBER' },
              },
              required: ['type', 'box_2d'],
            },
          },
        },
        required: ['items'],
      },
    },
  };
}

/**
 * Read Gemini's reply into the same item shape the on-phone detector gives.
 * Anything malformed is dropped and counted, never guessed at.
 * @param width, height the frame's size in pixels, to turn 0-1000 into pixels
 * @returns {{items: {label, score, box: {x, y, w, h}}[], dropped: number}}
 */
export function parseResponse(json, catalogTypes, width, height) {
  const allowed = new Set([...catalogTypes.map((t) => t.id), ...EXTRA_TYPES]);
  const text = json?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
  if (!text) {
    const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || 'no text in the reply';
    throw new Error(`Gemini gave no answer (${reason}).`);
  }
  let body;
  try {
    // structured output should be bare JSON; strip a code fence in case
    body = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error('Gemini\'s answer was not valid JSON.');
  }
  const raw = Array.isArray(body?.items) ? body.items : [];
  const items = [];
  let dropped = 0;
  for (const it of raw) {
    const b = it?.box_2d;
    const ok = allowed.has(it?.type) && Array.isArray(b) && b.length === 4
      && b.every((v) => Number.isFinite(v) && v >= 0 && v <= 1000) && b[2] > b[0] && b[3] > b[1];
    if (!ok) { dropped += 1; continue; }
    const [ymin, xmin, ymax, xmax] = b;
    items.push({
      label: it.type,
      score: Number.isFinite(it.confidence) ? Math.max(0, Math.min(1, it.confidence)) : null,
      box: {
        x: (xmin / 1000) * width,
        y: (ymin / 1000) * height,
        w: ((xmax - xmin) / 1000) * width,
        h: ((ymax - ymin) / 1000) * height,
      },
    });
  }
  return { items, dropped };
}
