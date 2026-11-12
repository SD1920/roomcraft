// Provider adapters with a fake fetch: request shape, JSON extraction, error kinds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callModel, extractJson, schemaText, ModelError } from '../utils/llm/providers.js'
import { activeModels, ROSTER } from '../utils/llm/models.js'

const env = { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o', HF_TOKEN: 'h' }
const req = { system: 'sys', turns: [{ role: 'user', text: 'hi' }], schema: { type: 'OBJECT', properties: { reply: { type: 'STRING' } } } }
const reply = (status, body) => async () => ({ ok: status < 400, status, statusText: '', json: async () => body })

test('extractJson finds the object in fences, think blocks and chatter', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('```json\n{"a": "x}y"}\n```'), { a: 'x}y' })
  assert.deepEqual(extractJson('<think>maybe {"no":1}</think> Sure! {"a":{"b":[1,2]}} done'), { a: { b: [1, 2] } })
  assert.deepEqual(extractJson('bad {oops} then {"a":2}'), { a: 2 })
  assert.equal(extractJson('no json here'), null)
  assert.equal(extractJson(undefined), null)
})

test('schemaText writes a template and shortens long id lists', () => {
  const t = schemaText({
    type: 'OBJECT',
    properties: {
      kind: { type: 'STRING', enum: ['a', 'b'] },
      ids: { type: 'STRING', enum: Array.from({ length: 20 }, (_, i) => `x${i}`), nullable: true },
      n: { type: 'NUMBER', nullable: true },
      list: { type: 'ARRAY', items: { type: 'STRING' } },
    },
  })
  assert.match(t, /"kind": "a" \| "b"/)
  assert.match(t, /"ids": "one of the ids listed above" or null/)
  assert.match(t, /"n": number or null/)
  assert.match(t, /"list": \[ "text", \.\.\. \]/)
})

test('OpenAI-style providers: URL, key header, JSON mode, schema in the prompt', async () => {
  let seen
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return reply(200, { choices: [{ message: { content: '{"reply":"hi"}' } }] })() }
  const out = await callModel({ provider: 'groq', model: 'm' }, req, { env, fetchImpl })
  assert.deepEqual(out, { reply: 'hi' })
  assert.equal(seen.url, 'https://api.groq.com/openai/v1/chat/completions')
  assert.equal(seen.opts.headers.Authorization, 'Bearer q')
  const body = JSON.parse(seen.opts.body)
  assert.equal(body.model, 'm')
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.match(body.messages[0].content, /exactly this shape/)

  await callModel({ provider: 'huggingface', model: 'm' }, req, { env, fetchImpl })
  assert.equal(seen.url, 'https://router.huggingface.co/v1/chat/completions')
  assert.equal(JSON.parse(seen.opts.body).response_format, undefined)
})

test('Gemini: responseSchema and the key header', async () => {
  let seen
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return reply(200, { candidates: [{ content: { parts: [{ text: '{"reply":"g"}' }] } }] })() }
  assert.deepEqual(await callModel({ provider: 'gemini', model: 'gemini-x' }, req, { env, fetchImpl }), { reply: 'g' })
  assert.match(seen.url, /models\/gemini-x:generateContent$/)
  assert.equal(seen.opts.headers['x-goog-api-key'], 'g')
  assert.deepEqual(JSON.parse(seen.opts.body).generationConfig.responseSchema, req.schema)
})

test('HTTP errors become the right kinds', async () => {
  const kind = async (status) => {
    try { await callModel({ provider: 'groq', model: 'm' }, req, { env, fetchImpl: reply(status, { error: { message: 'x' } }) }); return 'none' } catch (e) { return e instanceof ModelError ? e.kind : 'other' }
  }
  assert.equal(await kind(401), 'auth')
  assert.equal(await kind(403), 'auth')
  assert.equal(await kind(404), 'retired')
  assert.equal(await kind(429), 'busy')
  assert.equal(await kind(503), 'busy')
  assert.equal(await kind(400), 'refused')
})

test('no JSON in the answer is "unreadable"; a missing key is "auth"; a dropped connection is "network"', async () => {
  await assert.rejects(callModel({ provider: 'groq', model: 'm' }, req, { env, fetchImpl: reply(200, { choices: [{ message: { content: 'sorry' } }] }) }), (e) => e.kind === 'unreadable')
  await assert.rejects(callModel({ provider: 'groq', model: 'm' }, req, { env: {}, fetchImpl: reply(200, {}) }), (e) => e.kind === 'auth')
  await assert.rejects(callModel({ provider: 'groq', model: 'm' }, req, { env, fetchImpl: async () => { throw new TypeError('fetch failed') } }), (e) => e.kind === 'network')
})

test('an abort is passed through for the router to judge', async () => {
  const fetchImpl = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
  await assert.rejects(callModel({ provider: 'groq', model: 'm' }, req, { env, fetchImpl }), (e) => e.name === 'AbortError')
})

test('only models whose provider has a key are used; AI_MODELS overrides the list', () => {
  assert.equal(activeModels({}).length, 0)
  assert.ok(activeModels({ GEMINI_API_KEY: 'g' }).every((m) => m.provider === 'gemini'))
  assert.equal(activeModels(env).length, ROSTER.length)
  assert.ok(ROSTER.length >= 10)
  assert.deepEqual(activeModels({ ...env, AI_MODELS: 'groq:x, nope:y ,gemini:z' }), [{ provider: 'groq', model: 'x' }, { provider: 'gemini', model: 'z' }])
})
