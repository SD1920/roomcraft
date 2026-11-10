// controllers/assistantController.js
// The AI room assistant.
//
//   POST /api/assistant/plan  { prompt, history?, catalog }        -> { spec }
//       a typed description -> a room SPEC (size, style, floor, colours,
//       pieces with placement hints). The frontend places the pieces itself
//       (src/utils/promptRoom.js); the model never gives coordinates.
//   POST /api/assistant/chat  { message, history?, room, catalog } -> { reply, actions }
//       suggestions for the open room; each concrete change is an action the
//       user applies with a tap.
//
// `catalog` is what the app can draw (furniture types and sizes, room types,
// styles, floors, paints), sent by the frontend so it never goes out of step
// with the app's furniture list. It only constrains the model's answer; every
// answer is checked against it again here.

import { askGeminiJson, GeminiError } from '../utils/gemini.js'

const WALLS = ['front', 'back', 'left', 'right']
const SPOTS = ['start', 'center', 'end', 'corner', 'any']
const ID = /^[A-Za-z0-9_-]{1,40}$/
const HEX = /^#[0-9a-fA-F]{6}$/
const MAX_TEXT = 1000
const MAX_TURNS = 8

// ── input checks ──────────────────────────────────────────────

function bad(message) { const e = new Error(message); e.status = 400; return e }

const text = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function readCatalog(c) {
  if (!c || typeof c !== 'object') throw bad('Missing catalog.')
  const ids = (list, max) => (Array.isArray(list) ? list : []).slice(0, max).filter((x) => ID.test(x?.id || ''))
  const furniture = ids(c.furniture, 250).map((f) => ({
    id: f.id, name: text(f.name, 40), category: text(f.category, 30), wall_mounted: Boolean(f.wall_mounted),
    sizes: (Array.isArray(f.sizes) ? f.sizes : []).slice(0, 8).map((s) => text(s, 20)).filter(Boolean),
  }))
  const out = {
    furniture,
    room_types: ids(c.room_types, 40).map((r) => ({ id: r.id, name: text(r.name, 40) })),
    styles: ids(c.styles, 20).map((s) => ({ id: s.id, name: text(s.name, 30), description: text(s.description, 120) })),
    floors: ids(c.floors, 30).map((f) => ({ id: f.id, name: text(f.name, 30) })),
    paints: (Array.isArray(c.paints) ? c.paints : []).slice(0, 30).filter((p) => HEX.test(p?.color || '')).map((p) => ({ name: text(p.name, 30), color: p.color })),
  }
  if (out.furniture.length === 0 || out.room_types.length === 0) throw bad('Catalog is empty.')
  return out
}

const readHistory = (h) => (Array.isArray(h) ? h : []).slice(-MAX_TURNS)
  .map((t) => ({ role: t?.role === 'model' ? 'model' : 'user', text: text(t?.text, 1500) }))
  .filter((t) => t.text)

// ── answer schemas (Gemini responseSchema) and checks ─────────

const nullableEnum = (values) => ({ type: 'STRING', enum: values, nullable: true })

function pieceSchema(cat) {
  const ids = cat.furniture.map((f) => f.id)
  return {
    type: 'OBJECT',
    properties: {
      type: { type: 'STRING', enum: ids },
      size: { type: 'STRING', nullable: true, description: 'one of that type\'s sizes, or null' },
      count: { type: 'INTEGER' },
      wall: { type: 'STRING', enum: [...WALLS, 'any'] },
      spot: { type: 'STRING', enum: SPOTS },
      near: nullableEnum(ids),
    },
    required: ['type', 'count', 'wall', 'spot'],
  }
}

function cleanPiece(p, cat) {
  const def = cat.furniture.find((f) => f.id === p?.type)
  if (!def) return null
  const size = def.sizes.find((s) => s.toLowerCase() === String(p.size || '').toLowerCase()) || null
  return {
    type: def.id,
    size,
    count: Math.min(8, Math.max(1, Math.round(Number(p.count) || 1))),
    wall: [...WALLS, 'any'].includes(p.wall) ? p.wall : 'any',
    spot: SPOTS.includes(p.spot) ? p.spot : 'any',
    near: cat.furniture.some((f) => f.id === p.near) ? p.near : null,
  }
}

const num = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && Number(v) >= lo && Number(v) <= hi ? Number(v) : null)

function wallsSchema() {
  return { type: 'OBJECT', nullable: true, properties: Object.fromEntries(WALLS.map((w) => [w, { type: 'STRING', nullable: true }])) }
}

function cleanWalls(w) {
  if (!w || typeof w !== 'object') return null
  const out = {}
  for (const k of WALLS) if (HEX.test(w[k] || '')) out[k] = w[k]
  return Object.keys(out).length ? out : null
}

// ── shared prompt text ────────────────────────────────────────

const LAYOUT_RULES = `Walls: "front" is the wall with the main door (the top of the 2D plan), "back" is opposite it, "left" and "right" are as seen on the plan with the front wall at the top.
Spots along a wall: "start" = its left/top end, "end" = the other end, "corner" = a corner, "center" = the middle, "any" = no preference. A piece in the middle of the room: wall "any", spot "center".
"near" puts a piece next to another one (a chair near the desk, bedside tables near the bed).
Lengths are in feet: convert metres (x 3.281) and centimetres.
Colours are hex like #a8b5a2. Prefer one of the app's paints when it is close to what the person asked for.`

function catalogText(cat) {
  return JSON.stringify({
    room_types: cat.room_types.map((r) => `${r.id} (${r.name})`),
    styles: cat.styles.map((s) => `${s.id}: ${s.description}`),
    floors: cat.floors.map((f) => f.id),
    paints: cat.paints.map((p) => `${p.name} ${p.color}`),
    furniture: cat.furniture.map((f) => `${f.id}${f.wall_mounted ? ' [wall]' : ''}${f.sizes.length ? ` sizes: ${f.sizes.join('/')}` : ''}`),
  })
}

// ── POST /api/assistant/plan ──────────────────────────────────

export const planRoom = async (req, res) => {
  try {
    const prompt = text(req.body?.prompt)
    if (!prompt) return res.status(400).json({ message: 'Describe the room first.' })
    const cat = readCatalog(req.body?.catalog)
    return res.status(200).json({ spec: await planSpec(prompt, readHistory(req.body?.history), cat) })
  } catch (err) {
    return fail(res, err, 'plan')
  }
}

/** A description -> a checked room spec */
async function planSpec(prompt, history, cat) {
    const schema = {
      type: 'OBJECT',
      properties: {
        room_type: nullableEnum(cat.room_types.map((r) => r.id)),
        width_ft: { type: 'NUMBER', nullable: true },
        length_ft: { type: 'NUMBER', nullable: true },
        height_ft: { type: 'NUMBER', nullable: true },
        style: nullableEnum(cat.styles.map((s) => s.id)),
        floor_type: nullableEnum(cat.floors.map((f) => f.id)),
        wall_color_all: { type: 'STRING', nullable: true },
        wall_colors: wallsSchema(),
        furniture: { type: 'ARRAY', items: pieceSchema(cat) },
        openings: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { type: { type: 'STRING', enum: ['door', 'window'] }, wall: { type: 'STRING', enum: WALLS }, spot: { type: 'STRING', enum: ['start', 'center', 'end'] } },
            required: ['type', 'wall', 'spot'],
          },
        },
        assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
        question: { type: 'STRING', nullable: true },
        reply: { type: 'STRING' },
      },
      required: ['furniture', 'openings', 'assumptions', 'reply'],
    }

    const system = `You turn a person's description of a room into a JSON spec for a room-design app. The app places the furniture itself; you only say what goes where.
Fill in what they said, and what clearly follows from it; leave the rest null or empty and the app uses sensible defaults. Do not ask about details the app can default (size, colours, floor, doors).
${LAYOUT_RULES}
List the pieces they asked for, with "count" for several of one kind. Add obviously needed companions (a chair for a desk, chairs for a dining table to match its seats, bedside tables only if they asked for a "complete" bedroom) and say so in "assumptions".
If they only give a wish ("a cozy study for a student"), choose a sensible furniture list for it yourself.
Only list doors and windows they mention; otherwise leave "openings" empty.
"question": only when you cannot make any room at all from what they wrote; otherwise null.
"reply": one or two short, friendly sentences saying what you made.
What the app has: ${catalogText(cat)}`

    const answer = await askGeminiJson({ system, turns: [...history, { role: 'user', text: prompt }], schema })

    const spec = {
      room_type: cat.room_types.some((r) => r.id === answer.room_type) ? answer.room_type : null,
      width_ft: num(answer.width_ft, 4, 80),
      length_ft: num(answer.length_ft, 4, 80),
      height_ft: num(answer.height_ft, 6, 20),
      style: cat.styles.some((s) => s.id === answer.style) ? answer.style : null,
      floor_type: cat.floors.some((f) => f.id === answer.floor_type) ? answer.floor_type : null,
      wall_color_all: HEX.test(answer.wall_color_all || '') ? answer.wall_color_all : null,
      wall_colors: cleanWalls(answer.wall_colors),
      furniture: (Array.isArray(answer.furniture) ? answer.furniture : []).slice(0, 30).map((p) => cleanPiece(p, cat)).filter(Boolean),
      openings: (Array.isArray(answer.openings) ? answer.openings : []).slice(0, 10)
        .filter((o) => ['door', 'window'].includes(o?.type) && WALLS.includes(o?.wall))
        .map((o) => ({ type: o.type, wall: o.wall, spot: ['start', 'center', 'end'].includes(o.spot) ? o.spot : 'center' })),
      assumptions: (Array.isArray(answer.assumptions) ? answer.assumptions : []).slice(0, 10).map((a) => text(a, 200)).filter(Boolean),
      question: text(answer.question, 300) || null,
      reply: text(answer.reply, 400),
    }
    return spec
}

// ── POST /api/assistant/chat ──────────────────────────────────

const ACTION_KINDS = ['set_wall_color', 'set_floor', 'add_furniture', 'remove_furniture', 'furnish_room']

export const chatRoom = async (req, res) => {
  try {
    const message = text(req.body?.message)
    if (!message) return res.status(400).json({ message: 'Type a message first.' })
    const cat = readCatalog(req.body?.catalog)
    const room = req.body?.room && typeof req.body.room === 'object' ? req.body.room : {}
    const roomJson = JSON.stringify(room).slice(0, 12000)
    const furnitureIds = new Set((Array.isArray(room.furniture) ? room.furniture : []).map((f) => String(f?.id)))

    const schema = {
      type: 'OBJECT',
      properties: {
        reply: { type: 'STRING' },
        actions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              kind: { type: 'STRING', enum: ACTION_KINDS },
              label: { type: 'STRING' },
              wall: { type: 'STRING', enum: ['all', ...WALLS], nullable: true },
              color: { type: 'STRING', nullable: true },
              floor_type: nullableEnum(cat.floors.map((f) => f.id)),
              piece: { ...pieceSchema(cat), nullable: true },
              remove_id: { type: 'STRING', nullable: true },
              style: nullableEnum(cat.styles.map((s) => s.id)),
              furniture: { type: 'ARRAY', nullable: true, items: pieceSchema(cat) },
            },
            required: ['kind', 'label', 'wall', 'color', 'floor_type', 'piece', 'remove_id', 'style', 'furniture'],
          },
        },
      },
      required: ['reply', 'actions'],
    }

    const system = `You are a friendly interior-design assistant inside a room-design app. You can see the room the person has open (JSON below; lengths in feet, the room centred on 0, the front wall at -z).
Answer in at most 80 words, specific to this room: its size, its windows (light), its colours and furniture. Plain words, no markdown.
You cannot change the room yourself: a change only happens when the person taps one of your "actions". So:
- every change you suggest or are asked for MUST be in "actions" (a colour you recommend -> set_wall_color, a piece you recommend -> add_furniture, "furnish it as…" -> furnish_room);
- never say you have done, made or changed something; say what the buttons below will do ("Tap below to…");
- do not suggest a piece the room already has unless they want another one.
Actions (at most 4):
- set_wall_color: "wall" (all, front, back, left or right) and "color"
- set_floor: "floor_type"
- add_furniture: "piece" (type, size, count, wall, spot, near)
- remove_furniture: "remove_id", one of the room's furniture ids
- furnish_room: "furniture" (a full list of pieces) and "style": replaces all the furniture, for requests like "furnish this room as a cozy study"; the room's size, doors and windows stay
Each action needs a short "label" saying what it does, e.g. "Paint all walls Sage Green".
Questions without a concrete change, or not about the room: answer briefly, no actions.
${LAYOUT_RULES}
What the app has: ${catalogText(cat)}
The open room: ${roomJson}`

    const turns = [...readHistory(req.body?.history), { role: 'user', text: message }]
    let answer = await askGeminiJson({ system, turns, schema, temperature: 0.5 })
    // A request for a change that comes back without any action is the model
    // describing a change it cannot make (6 Nov: "I have transformed this room
    // into a cozy study", no action). Ask once more, saying what is missing.
    const wantsChange = /(furnish|add|put|place|paint|colou?r|change|make|replace|remove|move|floor|wall)/i.test(message)
    if (wantsChange && !(Array.isArray(answer.actions) && answer.actions.length)) {
      answer = await askGeminiJson({
        system,
        turns: [...turns, { role: 'model', text: JSON.stringify(answer) }, { role: 'user', text: 'You gave no actions, so nothing can be applied. Answer again with the actions for what I asked.' }],
        schema,
        temperature: 0.3,
      })
    }

    if (process.env.DEBUG_ASSISTANT) console.log('[assistant chat raw]', JSON.stringify(answer))
    const actions = []
    for (const a of (Array.isArray(answer.actions) ? answer.actions : []).slice(0, 4)) {
      const label = text(a?.label, 80)
      if (!ACTION_KINDS.includes(a?.kind) || !label) continue
      if (a.kind === 'set_wall_color') {
        // no colour given: the paint its label names ("Paint all walls Sage Green")
        if (!HEX.test(a.color || '')) {
          const words = `${label} ${answer.reply || ''}`.toLowerCase()
          a.color = cat.paints.find((p) => words.includes(p.name.toLowerCase()))?.color ?? null
        }
        if (!HEX.test(a.color || '')) continue
        actions.push({ kind: a.kind, label, wall: ['all', ...WALLS].includes(a.wall) ? a.wall : 'all', color: a.color })
      } else if (a.kind === 'set_floor') {
        if (!cat.floors.some((f) => f.id === a.floor_type)) continue
        actions.push({ kind: a.kind, label, floor_type: a.floor_type })
      } else if (a.kind === 'add_furniture') {
        const piece = cleanPiece(a.piece, cat)
        if (piece) actions.push({ kind: a.kind, label, piece })
      } else if (a.kind === 'remove_furniture') {
        if (furnitureIds.has(String(a.remove_id))) actions.push({ kind: a.kind, label, remove_id: String(a.remove_id) })
      } else if (a.kind === 'furnish_room') {
        let furniture = (Array.isArray(a.furniture) ? a.furniture : []).slice(0, 30).map((p) => cleanPiece(p, cat)).filter(Boolean)
        let style = cat.styles.some((s) => s.id === a.style) ? a.style : null
        if (!furniture.length) {
          // no list given: the planner chooses one, for this room's type and size
          const spec = await planSpec(`${message} (room: ${room.room_type || 'room'}, ${room.width_ft} x ${room.length_ft} ft; list the furniture)`, [], cat)
          furniture = spec.furniture
          style = style ?? spec.style
        }
        if (furniture.length) actions.push({ kind: a.kind, label, furniture, style })
      }
    }
    return res.status(200).json({ reply: text(answer.reply, 800), actions })
  } catch (err) {
    return fail(res, err, 'chat')
  }
}

function fail(res, err, what) {
  if (err.status === 400) return res.status(400).json({ message: err.message })
  if (err instanceof GeminiError) {
    console.error(`[assistant ${what}]`, err.message)
    return res.status(err.status).json({ message: err.message })
  }
  console.error(`[assistant ${what}]`, err)
  return res.status(500).json({ message: 'Something went wrong. Please try again.' })
}
