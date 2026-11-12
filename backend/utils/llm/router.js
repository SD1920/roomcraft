// utils/llm/router.js
// Ask many models for one JSON answer and take the first GOOD one.
//
// A "hedged race":
//   - start the best available model;
//   - if no good answer has arrived after HEDGE_MS, start the next one too
//     (at most MAX_PARALLEL at once); a failure starts the next one at once;
//   - every answer goes through validate(); the first that passes wins and the
//     others are cancelled;
//   - a model that was busy, slow, retired or refused the key is skipped for a
//     while (circuit breaker); a provider whose key is refused is dropped for
//     this request;
//   - the model that answered last is tried first next time;
//   - everything ends within BUDGET_MS (inside the 60 s serverless limit).
// validate() may call an answer "soft": readable but not what was asked
// (e.g. no action for a request to change something). The next model is tried,
// and after SOFT_ACCEPT soft answers the first of them is used, so a request
// the app cannot do does not burn the whole chain.

import { activeModels, modelKey } from './models.js'
import { callModel, ModelError } from './providers.js'

export const DEFAULTS = {
  hedgeMs: 3_500,
  attemptMs: 12_000,
  budgetMs: 45_000,
  maxParallel: 3,
  softAccept: 3,
  cooldownMs: 60_000,      // busy / slow / no connection
  longCooldownMs: 600_000, // retired model or refused key
}

// per warm serverless instance
const state = { cooldownUntil: new Map(), lastGood: null }
export function resetRouterState() { state.cooldownUntil.clear(); state.lastGood = null }

export class AllModelsFailed extends Error {
  constructor(tried) { super(`every model failed: ${tried.join('; ') || 'no model available'}`); this.tried = tried }
}

/** Order for this request: last good first, cooled-down models last (still usable if nothing else is) */
function orderModels(models, now) {
  const keyed = models.map((m) => ({ m, key: modelKey(m) }))
  const ready = keyed.filter((x) => !(state.cooldownUntil.get(x.key) > now))
  const cooling = keyed.filter((x) => state.cooldownUntil.get(x.key) > now)
  const last = ready.findIndex((x) => x.key === state.lastGood)
  if (last > 0) ready.unshift(...ready.splice(last, 1))
  return [...ready, ...cooling]
}

/**
 * @param req {system, turns, schema, temperature}
 * @param validate (answer) => {ok: true, value} | {ok: false, reason, soft?: value}
 * @param opts {models, call, ...DEFAULTS overrides} (tests inject fakes)
 * @returns {value, model, soft, tried}
 */
export function askJson(req, validate, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const call = o.call || ((m, r) => callModel(m, r))
  const order = orderModels(o.models || activeModels(), Date.now())
  const start = Date.now()
  const deadline = start + o.budgetMs
  const minLeft = Math.min(1_500, o.budgetMs / 10)   // too little time left to start another model

  return new Promise((resolve, reject) => {
    if (!order.length) { reject(new AllModelsFailed(['no model has a key set'])); return }
    let next = 0, running = 0, done = false
    const tried = [], softs = [], badProviders = new Set(), controllers = new Set()
    let hedgeTimer = null

    const finish = (fn) => {
      if (done) return
      done = true
      clearTimeout(hedgeTimer); clearTimeout(budgetTimer)
      for (const c of controllers) c.abort()
      fn()
    }
    const giveUp = () => finish(() => (softs.length
      ? resolve({ value: softs[0].value, model: softs[0].model, soft: true, tried })
      : reject(new AllModelsFailed(tried))))
    const cool = (key, ms) => state.cooldownUntil.set(key, Date.now() + ms)

    const launch = () => {
      if (done) return
      while (next < order.length && badProviders.has(order[next].m.provider)) next++
      const left = deadline - Date.now()
      if (next >= order.length || left < minLeft) { if (running === 0) giveUp(); return }
      const { m, key } = order[next++]
      running++
      const ctrl = new AbortController()
      controllers.add(ctrl)
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, Math.min(o.attemptMs, left))
      const settle = () => { clearTimeout(timer); controllers.delete(ctrl); running-- }

      Promise.resolve().then(() => call(m, { ...req, signal: ctrl.signal })).then((answer) => {
        settle()
        if (done) return
        let v
        try { v = validate(answer) } catch (err) { v = { ok: false, reason: `check failed: ${err.message}` } }
        if (v.ok) {
          state.lastGood = key
          finish(() => resolve({ value: v.value, model: key, soft: false, tried }))
          return
        }
        tried.push(`${key}: ${v.reason}`)
        if (v.soft !== undefined) {
          softs.push({ value: v.soft, model: key })
          if (softs.length >= o.softAccept) { giveUp(); return }
        }
        launch()
      }, (err) => {
        settle()
        if (done) return
        const kind = timedOut ? 'slow' : err instanceof ModelError ? err.kind : 'network'
        tried.push(`${key}: ${kind}`)
        if (kind === 'auth') { badProviders.add(m.provider); cool(key, o.longCooldownMs) }
        else if (kind === 'retired') cool(key, o.longCooldownMs)
        else if (kind !== 'refused' && kind !== 'unreadable') cool(key, o.cooldownMs)
        launch()
      })
      armHedge()
    }

    const armHedge = () => {
      clearTimeout(hedgeTimer)
      hedgeTimer = setTimeout(() => {
        if (!done && running < o.maxParallel) launch()
        if (!done && running > 0) armHedge()
      }, o.hedgeMs)
    }
    const budgetTimer = setTimeout(giveUp, o.budgetMs)
    launch()
  })
}
