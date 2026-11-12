// utils/quickIntent.js
// "Quick mode": simple rules that understand the common requests when no AI
// model can answer (every one busy, or no key set). It returns actions in the
// same shape as the assistant's, and they go through the same checks.
//
// It understands: paint walls, change the floor, add / remove furniture,
// furnish the room as a type, add / remove a door or window, resize the room.
// Several requests in one message ("add a desk and paint the walls blue") are
// split on "and", commas and full stops.

const WALLS = ['front', 'back', 'left', 'right']

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, pair: 2 }

// plain colour words -> a hex, matched to the nearest app paint
const COLOUR_WORDS = {
  white: '#ffffff', 'off white': '#f5f5f0', cream: '#f3ead7', ivory: '#f5f0e1', beige: '#ead8c0', tan: '#d2b48c',
  grey: '#9a9a9a', gray: '#9a9a9a', charcoal: '#4b4b4b', black: '#2a2a2a', dark: '#4b4b4b',
  green: '#8fae8b', sage: '#a8b5a2', olive: '#8a8f5a', mint: '#bfe3cf',
  blue: '#7f9cc0', navy: '#34495e', teal: '#5f9ea0', sky: '#a7c7e7',
  red: '#b5524a', terracotta: '#b96f5a', orange: '#d98c5f', peach: '#f2c2a0', brown: '#8b6b4f',
  yellow: '#e8d27a', pink: '#e8b4b8', purple: '#9b88b5', lavender: '#c8b8db',
}

// words people use -> catalog ids (only used when the id exists in the catalog)
const SYNONYMS = {
  couch: 'sofa', settee: 'sofa', 'l shaped sofa': 'sectional', 'tv stand': 'tvUnit', 'tv unit': 'tvUnit',
  television: 'tv', tv: 'tv', cupboard: 'wardrobe', closet: 'wardrobe', 'study table': 'desk', 'work desk': 'desk',
  table: 'desk', 'office chair': 'studyChair', chair: 'studyChair', 'book shelf': 'bookshelf', bookcase: 'bookshelf',
  'night stand': 'bedside', nightstand: 'bedside', 'bedside table': 'bedside', fridge: 'fridge', ac: 'acUnit',
  'air conditioner': 'acUnit', lamp: 'floorLamp', plant: 'plant', plants: 'plant', mirror: 'mirror', painting: 'painting',
  clock: 'clock', stool: 'barStool', 'bean bag': 'beanBag', beanbag: 'beanBag', 'bunk bed': 'bunkBed', crib: 'cot',
  'single bed': 'singleBed', 'double bed': 'bed', 'queen bed': 'bed', 'king bed': 'bed', ottoman: 'bench', rack: 'shelfUnit',
  'shoe rack': 'shoeRack', sink: 'kitchenSink', basin: 'basin', shower: 'shower', tub: 'bathtub', washer: 'washingMachine',
  'washing machine': 'washingMachine', desk: 'desk', 'computer desk': 'pcDesk', 'pc desk': 'pcDesk', whiteboard: 'whiteboard',
}

// room words -> room type ids; a hostel / dorm is a bedroom with one set per person
const ROOM_WORDS = {
  bedroom: 'bedroom', 'bed room': 'bedroom', hostel: 'bedroom', dorm: 'bedroom', 'living room': 'living-room', lounge: 'living-room',
  hall: 'living-room', study: 'study', office: 'study', 'home office': 'study', dining: 'dining', kitchen: 'kitchen',
  bathroom: 'bathroom', washroom: 'bathroom', 'kids room': 'kids-room', nursery: 'kids-room', 'kid s room': 'kids-room',
  entrance: 'entrance', foyer: 'entrance', balcony: 'balcony', utility: 'utility', laundry: 'utility', pooja: 'pooja',
  gym: 'gym', classroom: 'classroom', 'computer lab': 'computer-lab', lab: 'computer-lab',
}

const FLOOR = /\bfloor(?:ing)?\b(?!\s*lamps?\b)/

const words = (id) => id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
const singularWord = (w) => {
  if (w.length < 4 || /(ss|us|is)$/.test(w)) return w
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2)
  return w.endsWith('s') ? w.slice(0, -1) : w
}
const singular = (s) => s.replace(/[a-z]+/g, singularWord)
const hexDist = (a, b) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
const titled = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** Phrases -> catalog id, longest phrase first */
function furnitureIndex(cat) {
  const ids = new Set(cat.furniture.map((f) => f.id))
  const list = []
  for (const f of cat.furniture) {
    list.push([norm(f.name.replace(/\(.*?\)/g, '')).trim(), f.id])
    list.push([words(f.id), f.id])
  }
  for (const [w, id] of Object.entries(SYNONYMS)) if (ids.has(id)) list.push([w, id])
  // matched against a singular clause, so the phrases are made singular too
  return list.map(([w, id]) => [singular(w), id]).filter(([w]) => w).sort((a, b) => b[0].length - a[0].length)
}

function findWall(c) {
  const m = c.match(/\b(front|back|left|right|rear|entrance)\b(?: side)?(?: wall)?/)
  if (!m) return null
  return m[1] === 'rear' ? 'back' : m[1] === 'entrance' ? 'front' : m[1]
}

function findCount(c, before) {
  const m = c.slice(0, before).match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|couple|pair)\b(?: of)?\s*(?:\w+\s+){0,2}$/)
  if (!m) return 1
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]]
  return Math.min(8, Math.max(1, n || 1))
}

/** @param s a singular clause */
function findPiece(s, index) {
  for (const [w, id] of index) {
    const i = s.indexOf(` ${w} `)
    if (i !== -1) return { id, at: i }
  }
  return null
}

function findPaint(c, cat) {
  for (const p of cat.paints) if (c.includes(` ${p.name.toLowerCase()} `)) return p
  for (const p of cat.paints) {   // "sage", "terracotta": one word of a paint's name
    const first = p.name.toLowerCase().split(' ').find((w) => w.length > 4 && !['white', 'green', 'blue'].includes(w))
    if (first && c.includes(` ${first} `)) return p
  }
  const hex = c.match(/#[0-9a-f]{6}\b/)
  if (hex) return { name: hex[0], color: hex[0] }
  const word = Object.keys(COLOUR_WORDS).sort((a, b) => b.length - a.length).find((w) => c.includes(` ${w} `))
  if (!word) return null
  if (!cat.paints.length) return { name: titled(word), color: COLOUR_WORDS[word] }
  return [...cat.paints].sort((a, b) => hexDist(a.color, COLOUR_WORDS[word]) - hexDist(b.color, COLOUR_WORDS[word]))[0]
}

function findFloor(c, cat) {
  const byName = cat.floors.find((f) => c.includes(norm(f.name)) || c.includes(` ${words(f.id)} `))
  if (byName) return byName
  if (/\b(wood|wooden|timber|parquet|laminate)\b/.test(c)) return cat.floors.find((f) => /wood/i.test(f.id)) || null
  if (/\btiles?\b/.test(c)) return cat.floors.find((f) => f.id === 'tile') || null
  if (/\b(rug|carpet)\b/.test(c)) return cat.floors.find((f) => f.id === 'carpet') || null
  if (/\b(stone|granite)\b/.test(c)) return cat.floors.find((f) => f.id === 'marble') || null
  if (/\bcement\b/.test(c)) return cat.floors.find((f) => f.id === 'concrete') || null
  return null
}

function findRoomType(c, cat) {
  const ids = new Set(cat.room_types.map((r) => r.id))
  for (const r of cat.room_types) if (c.includes(norm(r.name.split('/')[0]))) return r.id
  const hit = Object.keys(ROOM_WORDS).sort((a, b) => b.length - a.length).find((w) => c.includes(` ${w} `))
  return hit && ids.has(ROOM_WORDS[hit]) ? ROOM_WORDS[hit] : null
}

const label = {
  piece: (cat, id) => cat.furniture.find((f) => f.id === id)?.name.replace(/\s*\(.*?\)/, '') || id,
}

/**
 * @param message  the user's message
 * @param cat      the checked catalog (assistantController readCatalog)
 * @param room     the open room summary (frontend summariseRoom)
 * @returns {reply, actions} — actions in the chat answer's shape, not yet checked
 */
export function quickIntent(message, cat, room = {}) {
  const index = furnitureIndex(cat)
  const roomFurniture = Array.isArray(room.furniture) ? room.furniture : []
  const roomOpenings = Array.isArray(room.openings) ? room.openings : []
  const width = Number(room.width_ft) || null
  const length = Number(room.length_ft) || null
  const actions = []
  const claimed = new Set()   // a piece / opening removed once only
  let verb = null

  const clauses = String(message || '').toLowerCase().replace(/×/g, ' x ').replace(/(\d)\s*(?:'|ft\.?|feet)/g, '$1 ft').split(/\band\b|\bthen\b|\balso\b|[,;!?]|\.(?!\d)/).map(norm).filter((c) => c.trim())
  for (const c of clauses) {
    const said =
      /\b(remove|delete|take out|take away|get rid of|throw out|without)\b/.test(c) ? 'remove'
      : /\b(paint|repaint)\b/.test(c) ? 'paint'
      : /\b(resize|bigger|larger|smaller|wider|narrower|longer|shorter|enlarge|shrink|extend)\b/.test(c) || /\d+(?:\.\d+)?\s*(?:ft|feet|foot)?\s*(?:x|by)\s*\d/.test(c) ? 'resize'
      : /\b(furnish|turn (?:it |this )?into|convert|redesign)\b/.test(c) ||
        (/\bmake (?:it |this )?(?:room )?(?:a|an|into)\b/.test(c) && findRoomType(c, cat)) ? 'furnish'
      : FLOOR.test(c) ? 'floor'
      : /\b(add|put|place|need|want|include|give me|get me|install|insert|keep)\b/.test(c) ? 'add'
      : /\b(make|change|turn|set|switch|use|colou?r)\b/.test(c) ? 'change'
      : /\bwalls?\b/.test(c) && findPaint(c, cat) ? 'paint'   // "white walls please"
      : null
    const v = said || verb
    if (!v) continue
    verb = v
    const wall = findWall(c)

    if (v === 'paint' || (v !== 'remove' && /\b(walls?|colou?r)\b/.test(c) && findPaint(c, cat) && !/\b(door|window)\b/.test(c))) {
      const p = findPaint(c, cat)
      if (!p) continue
      const w = /\b(all|every)\b/.test(c) || !wall ? 'all' : wall
      actions.push({ kind: 'set_wall_color', label: `Paint ${w === 'all' ? 'all walls' : `the ${w} wall`} ${p.name}`, wall: w, color: p.color })
      continue
    }

    if (v === 'floor' || ((v === 'add' || v === 'furnish' || v === 'change') && FLOOR.test(c))) {
      const f = findFloor(c, cat)
      if (f) actions.push({ kind: 'set_floor', label: `Change the floor to ${f.name}`, floor_type: f.id })
      continue
    }

    if (v === 'resize') {
      if (/\b(feel|look|seem)s?\b/.test(c)) continue   // "make it feel bigger" is about colours, not walls
      let w = width, l = length
      const dims = c.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)/)
      const by = c.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(wider|narrower|longer|shorter|bigger|larger|smaller)/)
      if (dims) { w = Number(dims[1]); l = Number(dims[2]) } else if (w && l) {
        const d = by ? Number(by[1]) : 2
        if (/\bwider\b/.test(c)) w += d
        else if (/\bnarrower\b/.test(c)) w -= d
        else if (/\blonger\b/.test(c)) l += d
        else if (/\bshorter\b/.test(c)) l -= d
        else if (/\b(smaller|shrink)\b/.test(c)) { w -= d; l -= d } else { w += d; l += d }
      }
      if (w && l) actions.push({ kind: 'resize_room', label: `Resize the room to ${+w.toFixed(2)} × ${+l.toFixed(2)} ft`, width_ft: w, length_ft: l })
      continue
    }

    const opening = c.match(/\b(door|window)s?\b/)?.[1]
    if (opening && (v === 'add' || v === 'remove')) {
      if (v === 'add') {
        const spot = /\b(corner|start|left end)\b/.test(c) ? 'start' : /\b(end|right end)\b/.test(c) ? 'end' : 'center'
        actions.push({ kind: 'add_opening', label: `Add a ${opening}${wall ? ` on the ${wall} wall` : ''}`, opening_type: opening, wall: wall || 'any', spot })
      } else {
        const o = roomOpenings.find((x) => x.type === opening && (!wall || x.wall === wall) && !x.leads_to_connected_room && !claimed.has(x.id))
        if (o) { claimed.add(o.id); actions.push({ kind: 'remove_opening', label: `Remove the ${opening} on the ${o.wall} wall`, opening_id: o.id }) }
      }
      continue
    }

    if (v === 'furnish') {
      const type = findRoomType(c, cat)
      if (!type && !/\bfurnish\b/.test(c)) continue
      // the style may be in another part of the message ("…into a study, modern style")
      const all = norm(message)
      const style = cat.styles.find((s) => all.includes(` ${s.id} `) || all.includes(norm(s.name)))?.id || null
      const pm = c.match(/\bfor (\d+|two|three|four|five|six)\b/) || c.match(/\b(\d+|two|three|four|five|six) (?:people|persons|students|beds|sharing)\b/)
      const people = pm ? Number(pm[1]) || NUMBER_WORDS[pm[1]] || 0 : 0
      let furniture = []
      if (/\b(hostel|dorm|sharing|shared)\b/.test(c) && people > 1) {
        const n = Math.min(4, people)
        furniture = [['singleBed', n], ['desk', n], ['studyChair', n], ['wardrobe', Math.min(n, 2)]]
          .filter(([id]) => cat.furniture.some((f) => f.id === id))
          .map(([id, count]) => ({ type: id, size: null, count, wall: 'any', spot: 'any', near: id === 'studyChair' ? 'desk' : null }))
      }
      const name = cat.room_types.find((r) => r.id === type)?.name.toLowerCase() || 'room'
      actions.push({
        kind: 'furnish_room',
        label: `Furnish it as a ${/\bhostel\b/.test(c) ? `hostel room${people > 1 ? ` for ${people}` : ''}` : name}`,
        furniture, style, room_type: type,
      })
      continue
    }

    if (v === 'change') continue   // "make…" / "change…" without a colour or floor: not understood
    // "a lamp near the bookshelf": the piece is before "near", the neighbour after it
    const [head, tail] = singular(c).split(/\b(?:near|next to|beside)\b/)
    const piece = findPiece(head, index)
    if (!piece) continue
    if (v === 'remove') {
      const inRoom = roomFurniture.find((f) => f.type === piece.id && !claimed.has(f.id)) ||
        roomFurniture.find((f) => !claimed.has(f.id) && norm(f.name || '').includes(` ${words(piece.id).split(' ').pop()} `))
      if (inRoom) { claimed.add(inRoom.id); actions.push({ kind: 'remove_furniture', label: `Remove the ${inRoom.name || label.piece(cat, inRoom.type)}`, remove_id: String(inRoom.id) }) }
      continue
    }
    const count = findCount(head, piece.at + 1)
    const near = tail ? findPiece(` ${tail.trim()} `, index)?.id || null : null
    const name = label.piece(cat, piece.id)
    actions.push({
      kind: 'add_furniture',
      label: `Add ${count > 1 ? `${count} × ${name}` : `a ${name}`}${wall ? ` on the ${wall} wall` : ''}`,
      piece: { type: piece.id, size: null, count, wall: wall || 'any', spot: /\bcorner\b/.test(c) ? 'corner' : /\b(middle|centre|center)\b/.test(c) ? 'center' : 'any', near: near !== piece.id ? near : null },
    })
  }

  const list = actions.slice(0, 4)
  const reply = list.length
    ? 'The AI is busy right now, so I used quick mode. Tap below to apply:'
    : 'The AI is busy right now and quick mode did not understand that. Quick mode can: paint walls ("paint the walls sage green"), change the floor ("marble floor"), add or remove furniture ("add two chairs", "remove the bookshelf"), furnish the room ("furnish it as a study"), add or remove a door or window ("add a window on the left wall"), and resize the room ("make it 14 by 16"). Or try again in a minute.'
  return { reply, actions: list }
}
