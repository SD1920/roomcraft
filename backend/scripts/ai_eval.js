// scripts/ai_eval.js
// How well does the assistant answer? About 30 typical requests, each with the
// action kinds a correct answer contains, scored for:
//   right action  every expected kind is there (questions: no action needed)
//   valid         a readable answer at all (HTTP 200)
//   time          median and 95th percentile
//
//   node backend/scripts/ai_eval.js --url https://<preview-or-live-site>
//       the full router through the real API, logged in as a demo account
//       (the site needs DEMO_MODE=true); paced for the 12-per-minute limit
//   node backend/scripts/ai_eval.js --models
//       each model ALONE, called directly with the keys in this shell's
//       environment (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN):
//       shows which models to keep in utils/llm/models.js
//   --only 10   just the first 10 prompts

import { furnitureDefinitions, stylePresets, floorPresets, ROOM_TYPES, wallPaints } from '../../frontend/src/data/roomPresets.js'

const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? true }

export const PROMPTS = [
  ['What wall colour would suit this room?', ['set_wall_color']],
  ['Paint the walls sage green', ['set_wall_color']],
  ['Make the left wall dusty blue', ['set_wall_color']],
  ['Change the floor to marble', ['set_floor']],
  ['I want a warmer wooden floor', ['set_floor']],
  ['Add a study desk and a chair', ['add_furniture']],
  ['Put a TV on the back wall', ['add_furniture']],
  ['Add two bean bags in the corner', ['add_furniture']],
  ['What else should I add?', ['add_furniture']],
  ['Add a floor lamp near the bed', ['add_furniture']],
  ['Remove the bookshelf', ['remove_furniture']],
  ['Get rid of the wardrobe and add an almirah', ['remove_furniture', 'add_furniture']],
  ['Furnish this room as a cozy study', ['furnish_room']],
  ['Make a hostel room for 3 people', ['furnish_room']],
  ['Turn it into a living room, modern style', ['furnish_room']],
  ['Add a window on the left wall', ['add_opening']],
  ['Add another door', ['add_opening']],
  ['Remove the window', ['remove_opening']],
  ['Make the room bigger', ['resize_room']],
  ['Make the room 15 by 18 feet', ['resize_room']],
  ['Make it 2 ft wider', ['resize_room']],
  ['Add a door and a window and make the room bigger', ['add_opening', 'resize_room']],
  ['Paint the walls beige and change the floor to dark wood', ['set_wall_color', 'set_floor']],
  ['Make it feel bigger', []],
  ['Is there enough light in this room?', []],
  ['How big is this room?', []],
  ['What style is this room?', []],
  ['Make the room 4 metres by 5 metres', ['resize_room']],
  ['Kamre ki deewar neeli kar do', ['set_wall_color']],   // Hinglish: paint the walls blue
  ['add bunk bed', ['add_furniture']],
]

export const catalog = {
  room_types: ROOM_TYPES.map((r) => ({ id: r.id, name: r.name })),
  styles: Object.entries(stylePresets).map(([id, s]) => ({ id, name: s.name, description: s.description })),
  floors: floorPresets.map((f) => ({ id: f.id, name: f.name })),
  paints: wallPaints.map((p) => ({ name: p.name, color: p.color })),
  furniture: Object.entries(furnitureDefinitions).map(([id, d]) => ({ id, name: d.name, category: d.category, wall_mounted: Boolean(d.wallMounted), sizes: [] })),
}
export const room = {
  room_type: 'bedroom', width_ft: 12, length_ft: 14, height_ft: 9, style: 'minimal', floor_type: 'lightWood',
  wall_colors: { front: '#f5f5f0', back: '#f5f5f0', left: '#f5f5f0', right: '#f5f5f0' }, connected_rooms: 0,
  openings: [
    { id: 'door-1', type: 'door', wall: 'front', position: 0, width: 3 },
    { id: 'window-1', type: 'window', wall: 'back', position: 0, width: 4 },
  ],
  furniture: [
    { id: 'bed-1', type: 'bed', name: 'Bed', x: 0, z: 3.5, width: 5, depth: 6.5 },
    { id: 'wardrobe-1', type: 'wardrobe', name: 'Wardrobe', x: -3.9, z: -5.9, width: 4, depth: 2 },
    { id: 'bookshelf-1', type: 'bookshelf', name: 'Bookshelf', x: 5.2, z: -2, width: 3, depth: 1.2 },
  ],
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0 }

/** @param ask (message) => {ok, actions?, model?, quick?} */
async function run(name, ask, pauseMs = 0) {
  const prompts = PROMPTS.slice(0, Number(arg('--only')) || PROMPTS.length)
  let right = 0, valid = 0, quick = 0
  const times = [], misses = []
  for (const [message, want] of prompts) {
    const t0 = Date.now()
    let r
    try { r = await ask(message) } catch (err) { r = { ok: false, error: err.message } }
    const ms = Date.now() - t0
    times.push(ms)
    const got = (r.actions || []).map((a) => a.kind)
    const good = r.ok && (want.length ? want.every((k) => got.includes(k)) : true)
    if (r.ok) valid++
    if (r.quick) quick++
    if (good) right++
    else misses.push(`  ✗ "${message}" wanted [${want}] got [${got}]${r.error ? ` (${r.error})` : ''}`)
    process.stdout.write(good ? '.' : 'x')
    if (pauseMs) await sleep(pauseMs)
  }
  const n = prompts.length
  console.log(`\n${name}: right action ${right}/${n} (${Math.round(100 * right / n)}%), valid ${valid}/${n}, ` +
    `quick mode ${quick}, median ${(pct(times, 0.5) / 1000).toFixed(1)} s, p95 ${(pct(times, 0.95) / 1000).toFixed(1)} s`)
  if (misses.length) console.log(misses.join('\n'))
  return { name, right, n, valid }
}

async function viaApi(base) {
  const url = base.replace(/\/$/, '')
  const login = await fetch(`${url}/api/auth/demo`, { method: 'POST' })
  if (!login.ok) throw new Error(`demo login failed: ${login.status} (is DEMO_MODE on for this deployment?)`)
  const { token } = await login.json()
  if (!token) throw new Error('demo login gave no token')
  return run(`router @ ${url}`, async (message) => {
    const res = await fetch(`${url}/api/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, history: [], room, catalog }),
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, actions: body.actions, quick: body.quick, error: res.ok ? null : `${res.status} ${body.message || ''}` }
  }, 5_200)   // 12 requests per minute per user
}

async function perModel() {
  // the controller's own prompt and checks, called for one model at a time
  const { activeModels, modelKey } = await import('../utils/llm/models.js')
  const models = activeModels()
  if (!models.length) throw new Error('no keys in this shell: set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / HF_TOKEN')
  const results = []
  for (const m of models) {
    results.push(await run(modelKey(m), async (message) => {
      let status, body
      const res = { status(s) { status = s; return this }, json(b) { body = b; return this } }
      process.env.AI_MODELS = modelKey(m)
      const { chatRoom } = await import('../controllers/assistantController.js')
      await chatRoom({ body: { message, history: [], room, catalog } }, res)
      return { ok: status === 200 && !body.quick, actions: body.actions, quick: body.quick, error: body.quick ? 'model failed' : body.message }
    }, 2_000))
  }
  console.log('\nsummary (best first):')
  for (const r of results.sort((a, b) => b.right - a.right)) console.log(`  ${String(r.right).padStart(2)}/${r.n}  valid ${r.valid}/${r.n}  ${r.name}`)
}

const url = arg('--url')
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').slice(-3).join('/'))
if (isMain) try {
  if (url && url !== true) await viaApi(url)
  else if (args.includes('--models')) await perModel()
  else console.log('usage: node backend/scripts/ai_eval.js --url https://<site>   |   --models   [--only N]')
} catch (err) {
  console.error(`ai_eval: ${err.message}`)
  process.exitCode = 1
}
