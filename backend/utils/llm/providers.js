// utils/llm/providers.js
// One call to one model, whatever the provider, returning parsed JSON.
//
// Gemini has its own API and can be forced into a JSON schema
// (responseSchema). Groq, OpenRouter and Hugging Face all speak the OpenAI
// chat format, so one adapter covers them: the schema is written into the
// prompt, JSON mode is asked for where the provider supports it, and
// extractJson() pulls the object out of whatever comes back.

import { PROVIDER_KEYS } from './models.js'

/** Why a call failed. `kind` decides what the router does next. */
export class ModelError extends Error {
  /** @param kind busy | retired | auth | refused | unreadable | network */
  constructor(kind, message) { super(message); this.kind = kind }
}

const OPENAI_URLS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  huggingface: 'https://router.huggingface.co/v1/chat/completions',
}
// JSON mode is accepted by Groq and OpenRouter; Hugging Face depends on the host, so not asked for
const JSON_MODE = new Set(['groq', 'openrouter'])

function kindOf(status) {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'retired'
  if (status === 408 || status === 429 || status >= 500) return 'busy'
  return 'refused'
}

/** The first complete JSON object in a text (fences, <think> blocks and chatter around it are ignored) */
export function extractJson(text) {
  if (typeof text !== 'string') return null
  const s = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0, inString = false, escaped = false
    for (let i = start; i < s.length; i++) {
      const c = s[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
      } else if (c === '"') inString = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)) } catch { break }
      }
    }
  }
  return null
}

/**
 * A Gemini responseSchema written out as a short JSON template for models
 * that cannot be forced into a schema. Long id lists are not repeated: the
 * prompt already lists them.
 */
export function schemaText(schema) {
  const walk = (s) => {
    if (!s) return 'null'
    const nul = s.nullable ? ' or null' : ''
    if (s.enum) return s.enum.length > 12 ? `"one of the ids listed above"${nul}` : `${s.enum.map((e) => JSON.stringify(e)).join(' | ')}${nul}`
    switch (s.type) {
      case 'OBJECT': {
        const fields = Object.entries(s.properties || {}).map(([k, v]) => `"${k}": ${walk(v)}`)
        return `{ ${fields.join(', ')} }${nul}`
      }
      case 'ARRAY': return `[ ${walk(s.items)}, ... ]${nul}`
      case 'NUMBER': return `number${nul}`
      case 'INTEGER': return `integer${nul}`
      case 'BOOLEAN': return `true | false${nul}`
      default: return `"text"${nul}`
    }
  }
  return walk(schema)
}

async function readJson(res) {
  try { return await res.json() } catch { return null }
}

async function callGemini(model, { system, turns, schema, temperature, signal, key, fetchImpl }) {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })),
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
    }),
    signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw new ModelError(kindOf(res.status), `${res.status}: ${json?.error?.message || res.statusText}`)
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  const answer = extractJson(text)
  if (!answer) throw new ModelError('unreadable', 'no JSON in the answer')
  return answer
}

async function callOpenAiStyle(provider, model, { system, turns, schema, temperature, signal, key, fetchImpl }) {
  const instructions = `${system}\n\nAnswer with ONE JSON object and nothing else, in exactly this shape:\n${schemaText(schema)}`
  const res = await fetchImpl(OPENAI_URLS[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://roomcraft-ivory.vercel.app', 'X-Title': 'RoomCraft' } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
      ],
      temperature,
      max_tokens: 2000,
      ...(JSON_MODE.has(provider) ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw new ModelError(kindOf(res.status), `${res.status}: ${json?.error?.message || json?.error || res.statusText}`)
  const answer = extractJson(json?.choices?.[0]?.message?.content)
  if (!answer) throw new ModelError('unreadable', 'no JSON in the answer')
  return answer
}

/**
 * @param m {provider, model}
 * @param req {system, turns: [{role, text}], schema, temperature, signal}
 * @returns the parsed JSON answer; throws ModelError
 */
export async function callModel(m, req, { env = process.env, fetchImpl = fetch } = {}) {
  const key = env[PROVIDER_KEYS[m.provider]]
  if (!key) throw new ModelError('auth', `no ${PROVIDER_KEYS[m.provider]}`)
  const opts = { ...req, temperature: req.temperature ?? 0.4, key, fetchImpl }
  try {
    return m.provider === 'gemini' ? await callGemini(m.model, opts) : await callOpenAiStyle(m.provider, m.model, opts)
  } catch (err) {
    if (err instanceof ModelError) throw err
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw err   // the router decides what an abort means
    throw new ModelError('network', err?.message || 'no connection')
  }
}
