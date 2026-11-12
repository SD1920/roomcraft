// The model router with fake providers: no network, no keys.
// Run: node --test backend/tests/
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { askJson, AllModelsFailed, resetRouterState } from '../utils/llm/router.js'
import { ModelError } from '../utils/llm/providers.js'

const M = (name, provider = 'groq') => ({ provider, model: name })
const ok = (a) => ({ ok: true, value: a })
const acceptAll = (a) => ok(a)
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
})
const FAST = { hedgeMs: 30, attemptMs: 200, budgetMs: 1500 }

/** a fake `call`: behaviours per model name */
function fakes(behaviour, log = []) {
  return async (m, req) => {
    log.push(m.model)
    const b = behaviour[m.model]
    if (typeof b === 'function') return b(req)
    throw new Error(`no fake for ${m.model}`)
  }
}

beforeEach(() => resetRouterState())

test('first good answer wins', async () => {
  const r = await askJson({}, acceptAll, { ...FAST, models: [M('a'), M('b')], call: fakes({ a: () => ({ reply: 'A' }), b: () => ({ reply: 'B' }) }) })
  assert.equal(r.value.reply, 'A')
  assert.equal(r.model, 'groq:a')
})

test('busy, retired, unreadable and network failures move on to the next model', async () => {
  const log = []
  const r = await askJson({}, acceptAll, {
    ...FAST,
    models: [M('busy'), M('gone'), M('junk'), M('net'), M('good')],
    call: fakes({
      busy: () => { throw new ModelError('busy', '503') },
      gone: () => { throw new ModelError('retired', '404') },
      junk: () => { throw new ModelError('unreadable', 'no JSON') },
      net: () => { throw new Error('ECONNRESET') },
      good: () => ({ reply: 'ok' }),
    }, log),
  })
  assert.equal(r.model, 'groq:good')
  assert.deepEqual(log, ['busy', 'gone', 'junk', 'net', 'good'])
  assert.equal(r.tried.length, 4)
})

test('a slow model is hedged: the next one starts and the faster answer wins', async () => {
  const r = await askJson({}, acceptAll, {
    ...FAST, attemptMs: 1000,
    models: [M('slow'), M('quick')],
    call: fakes({ slow: async (req) => { await sleep(600, req.signal); return { reply: 'slow' } }, quick: () => ({ reply: 'quick' }) }),
  })
  assert.equal(r.value.reply, 'quick')
})

test('the losers of a race are cancelled', async () => {
  let aborted = false
  await askJson({}, acceptAll, {
    ...FAST, attemptMs: 1000,
    models: [M('slow'), M('quick')],
    call: fakes({
      slow: async (req) => { req.signal.addEventListener('abort', () => { aborted = true }); await sleep(800, req.signal); return {} },
      quick: async () => { await sleep(60); return { reply: 'q' } },
    }),
  })
  assert.equal(aborted, true)
})

test('an attempt over its time limit counts as slow', async () => {
  const r = await askJson({}, acceptAll, {
    hedgeMs: 5000, attemptMs: 50, budgetMs: 2000,
    models: [M('hang'), M('ok')],
    call: fakes({ hang: async (req) => { await sleep(5000, req.signal); return {} }, ok: () => ({ reply: 'ok' }) }),
  })
  assert.equal(r.model, 'groq:ok')
  assert.match(r.tried[0], /hang: slow/)
})

test('at most maxParallel models run at once', async () => {
  let running = 0, peak = 0
  const slow = async (req) => { running++; peak = Math.max(peak, running); try { await sleep(150, req.signal) } finally { running-- } ; return { reply: 'x' } }
  await askJson({}, acceptAll, {
    hedgeMs: 10, attemptMs: 1000, budgetMs: 2000, maxParallel: 2,
    models: ['a', 'b', 'c', 'd'].map((n) => M(n)),
    call: fakes({ a: slow, b: slow, c: slow, d: slow }),
  })
  assert.ok(peak <= 2, `peak ${peak}`)
})

test('an answer that fails validation is not accepted; the next model is asked', async () => {
  const validate = (a) => (a.actions?.length ? ok(a) : { ok: false, reason: 'no action' })
  const r = await askJson({}, validate, {
    ...FAST,
    models: [M('talker'), M('doer')],
    call: fakes({ talker: () => ({ reply: 'I have changed it', actions: [] }), doer: () => ({ reply: 'Tap below', actions: [1] }) }),
  })
  assert.equal(r.model, 'groq:doer')
})

test('soft answers: after softAccept of them the first one is used', async () => {
  const log = []
  const validate = (a) => ({ ok: false, reason: 'no action', soft: a })
  const r = await askJson({}, validate, {
    ...FAST, softAccept: 2,
    models: ['a', 'b', 'c', 'd'].map((n) => M(n)),
    call: fakes(Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [n, () => ({ reply: n })])), log),
  })
  assert.equal(r.soft, true)
  assert.equal(r.value.reply, 'a')
  assert.ok(log.length <= 3, `asked ${log.length}`)
})

test('a soft answer is used when every model has been tried', async () => {
  const validate = (a) => (a.soft ? { ok: false, reason: 'no action', soft: a } : { ok: false, reason: 'bad' })
  const r = await askJson({}, validate, {
    ...FAST,
    models: [M('a'), M('b')],
    call: fakes({ a: () => ({ reply: 'a', soft: true }), b: () => ({ reply: 'b' }) }),
  })
  assert.equal(r.soft, true)
  assert.equal(r.value.reply, 'a')
})

test('every model failing throws AllModelsFailed with what was tried', async () => {
  await assert.rejects(
    askJson({}, acceptAll, { ...FAST, models: [M('a'), M('b')], call: fakes({ a: () => { throw new ModelError('busy', '503') }, b: () => { throw new ModelError('busy', '429') } }) }),
    (err) => err instanceof AllModelsFailed && err.tried.length === 2,
  )
})

test('no models (no keys) throws AllModelsFailed at once', async () => {
  await assert.rejects(askJson({}, acceptAll, { ...FAST, models: [] }), AllModelsFailed)
})

test('a refused key drops the rest of that provider for the request', async () => {
  const log = []
  const r = await askJson({}, acceptAll, {
    ...FAST,
    models: [M('g1', 'groq'), M('g2', 'groq'), M('h1', 'huggingface')],
    call: fakes({ g1: () => { throw new ModelError('auth', '401') }, g2: () => ({ reply: 'never' }), h1: () => ({ reply: 'hf' }) }, log),
  })
  assert.equal(r.model, 'huggingface:h1')
  assert.deepEqual(log, ['g1', 'h1'])
})

test('circuit breaker: a busy model goes to the back of the line next time', async () => {
  const models = [M('a'), M('b')]
  let calls = 0
  const call = fakes({ a: () => { calls++; throw new ModelError('busy', '503') }, b: () => ({ reply: 'b' }) })
  await askJson({}, acceptAll, { ...FAST, models, call })
  const log = []
  await askJson({}, acceptAll, { ...FAST, models, call: fakes({ a: () => ({ reply: 'a' }), b: () => ({ reply: 'b' }) }, log) })
  assert.equal(calls, 1)
  assert.equal(log[0], 'b')
})

test('the last good model is tried first', async () => {
  const models = [M('a'), M('b')]
  resetRouterState()
  await askJson({}, acceptAll, { ...FAST, models, call: fakes({ a: () => { throw new ModelError('refused', '400') }, b: () => ({ reply: 'b' }) }) })
  const log = []
  await askJson({}, acceptAll, { ...FAST, models, call: fakes({ a: () => ({ reply: 'a' }), b: () => ({ reply: 'b' }) }, log) })
  assert.equal(log[0], 'b')
})

test('the whole call ends within its budget', async () => {
  const t0 = Date.now()
  const hang = async (req) => { await sleep(10_000, req.signal); return {} }
  await assert.rejects(askJson({}, acceptAll, {
    hedgeMs: 20, attemptMs: 10_000, budgetMs: 300, maxParallel: 3,
    models: ['a', 'b', 'c', 'd'].map((n) => M(n)),
    call: fakes({ a: hang, b: hang, c: hang, d: hang }),
  }), AllModelsFailed)
  assert.ok(Date.now() - t0 < 800, `took ${Date.now() - t0} ms`)
})

test('a validator that throws counts as a bad answer, not a crash', async () => {
  let n = 0
  const validate = (a) => { if (n++ === 0) throw new Error('boom'); return ok(a) }
  const r = await askJson({}, validate, { ...FAST, models: [M('a'), M('b')], call: fakes({ a: () => ({}), b: () => ({ reply: 'b' }) }) })
  assert.equal(r.model, 'groq:b')
})
