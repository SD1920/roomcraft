// utils/gemini.js
// One call to Google Gemini that must answer with JSON in a given shape.
//
// Reliability: Gemini models get overloaded (503), rate-limited (429) or
// retired (404), often several at once, so one fallback is not enough. The
// call walks a chain of models, moving to the next one straight away instead
// of waiting on a busy one; each attempt is time-limited and the whole call
// has a budget, so the user always gets an answer or a clear message.
// Only a refused key (401/403) stops the chain at once: no model will work.

// Measured 12 Nov 2026 with the assistant's real request: gemini-3.1-flash-lite
// 1.5 s, flash-lite-latest 9.6 s, 3.6-flash 6.8 s, 3.5-flash 21 s, and
// gemini-flash-latest overloaded (503). Fastest first. Aliases ("-latest")
// follow Google's newest model; pinned names keep working when the newest is
// busy. A retired name just answers 404 and is skipped.
export const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
]
const ATTEMPT_TIMEOUT_MS = 12_000   // one model may not hold the call up
const TOTAL_BUDGET_MS = 50_000      // inside the 60 s serverless limit
const SECOND_ROUND_WAIT_MS = 1_500  // all busy: short pause, then once more round the busy ones
const FATAL = new Set([401, 403])   // the key itself is refused

// The model that answered last time is tried first (lasts while the
// serverless instance stays warm).
let lastGood = null

export class GeminiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export function modelChain() {
  const fromEnv = process.env.GEMINI_MODELS?.split(',').map((m) => m.trim()).filter(Boolean)
  const chain = fromEnv?.length ? fromEnv : GEMINI_MODELS
  return lastGood && chain.includes(lastGood) ? [lastGood, ...chain.filter((m) => m !== lastGood)] : chain
}

/**
 * @param system   instructions for the model
 * @param turns    [{role: 'user'|'model', text}], the conversation, last one the user's
 * @param schema   Gemini responseSchema (OpenAPI subset: OBJECT, STRING, enum, nullable…)
 * @returns the parsed JSON answer
 */
export async function askGeminiJson({ system, turns, schema, temperature = 0.4 }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GeminiError(503, 'The AI assistant is not set up: add GEMINI_API_KEY to backend/.env and restart the backend.')
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })),
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
  })

  const deadline = Date.now() + TOTAL_BUDGET_MS
  const tried = []
  let round = modelChain()
  for (let pass = 0; pass < 2 && round.length; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, SECOND_ROUND_WAIT_MS))
    const busy = []
    for (const name of round) {
      const left = deadline - Date.now()
      if (left < 3_000) break
      let res
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)),
        })
      } catch (err) {
        tried.push(`${name}: ${err?.name === 'TimeoutError' ? 'too slow' : 'no connection'}`)
        busy.push(name)
        continue
      }
      const json = await res.json().catch(() => null)
      if (res.ok) {
        const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
        try {
          const answer = JSON.parse(text)
          lastGood = name
          return answer
        } catch {
          tried.push(`${name}: unreadable answer`)
          continue
        }
      }
      tried.push(`${name}: ${res.status}`)
      if (FATAL.has(res.status)) throw new GeminiError(502, `The AI service refused the API key (${res.status}).`)
      if (res.status !== 404) busy.push(name)   // a retired model is not tried again
    }
    round = busy
  }
  console.warn('[gemini] every model failed:', tried.join(', '))
  throw new GeminiError(503, 'The AI is very busy right now (every model we tried was overloaded). Please try again in a minute.')
}
