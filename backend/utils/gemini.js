// utils/gemini.js
// One call to Google Gemini that must answer with JSON in a given shape.
// Busy / rate-limited answers are retried after a short wait, then the next
// model is tried; anything else (bad key, bad request) fails at once.

// lite first: a chat must answer in seconds (6 Nov: lite 1.5 s, the full model busy with 503s)
const DEFAULT_MODEL = 'gemini-flash-lite-latest'
const DEFAULT_FALLBACKS = ['gemini-flash-latest']
const ATTEMPTS_PER_MODEL = 2
const RETRY_WAIT_MS = 1500
const RETRYABLE = new Set([429, 500, 503])
// one attempt may not hang: a stalled call counts as busy and is retried
const ATTEMPT_TIMEOUT_MS = 25_000
// all attempts together stay under the app's 90 s wait, so the user always gets an answer
const TOTAL_BUDGET_MS = 50_000

export class GeminiError extends Error {
  constructor(status, message) { super(message); this.status = status }
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
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
  const fallbacks = process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_FALLBACKS
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })),
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
  })

  let last = 'no answer'
  const deadline = Date.now() + TOTAL_BUDGET_MS
  for (const name of [model, ...fallbacks.filter((m) => m !== model)]) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_WAIT_MS * attempt))
      const left = deadline - Date.now()
      if (left < 5000) break
      let res
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)),
        })
      } catch (err) {
        last = err?.name === 'TimeoutError' ? `${name} took over ${ATTEMPT_TIMEOUT_MS / 1000} s` : `${name}: ${err?.message}`
        continue
      }
      const json = await res.json().catch(() => null)
      if (res.ok) {
        const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
        try { return JSON.parse(text) } catch { throw new GeminiError(502, 'The AI answered in a form the app could not read. Please try again.') }
      }
      last = `${res.status}: ${json?.error?.message || res.statusText}`
      if (!RETRYABLE.has(res.status)) throw new GeminiError(502, `The AI service refused the request (${last}).`)
    }
  }
  throw new GeminiError(503, `The AI service is busy right now (${last}). Please try again in a minute.`)
}
