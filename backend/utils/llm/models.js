// utils/llm/models.js
// Every language model the assistant may use, best first.
//
// A model is only used when its provider's key is set, so the app works with
// any subset of keys (just Gemini is fine). Providers rename and retire
// models; a name that no longer exists answers 404 and the router skips it.
// Checked against the providers' model lists on 12 Nov 2026.
//
// Override the whole list without a code change: AI_MODELS env, comma
// separated "provider:model", e.g.
//   AI_MODELS=groq:llama-3.3-70b-versatile,gemini:gemini-3.1-flash-lite

export const PROVIDER_KEYS = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: 'HF_TOKEN',
}

export const ROSTER = [
  // fast and reliable with JSON
  { provider: 'groq', model: 'openai/gpt-oss-120b' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
  // next
  { provider: 'gemini', model: 'gemini-flash-lite-latest' },
  { provider: 'gemini', model: 'gemini-3.6-flash' },
  { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { provider: 'groq', model: 'qwen/qwen3-32b' },
  { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
  { provider: 'huggingface', model: 'openai/gpt-oss-120b' },
  // last resorts
  { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' },
  { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free' },
  { provider: 'huggingface', model: 'google/gemma-4-31B-it' },
  { provider: 'huggingface', model: 'meta-llama/Llama-3.3-70B-Instruct' },
  { provider: 'gemini', model: 'gemini-3.5-flash' },
  { provider: 'gemini', model: 'gemini-flash-latest' },
]

export const modelKey = (m) => `${m.provider}:${m.model}`

/** The models that can be used now: from AI_MODELS or the roster, with a key set */
export function activeModels(env = process.env) {
  const fromEnv = (env.AI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(':')
    return i > 0 ? { provider: s.slice(0, i), model: s.slice(i + 1) } : null
  }).filter((m) => m && PROVIDER_KEYS[m.provider])
  const list = fromEnv.length ? fromEnv : ROSTER
  return list.filter((m) => env[PROVIDER_KEYS[m.provider]])
}
