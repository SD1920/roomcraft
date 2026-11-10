// src/data/roomPresets.js

import {
  WALL_CLEARANCE,
  COLLISION_GAP,
  getWallLength,
  getHalfExtents,
  getItemBox,
  boxesOverlap,
  itemsCollide,
  isInsideRoom,
  isWallItemBlocked,
  findFreeWallPosition,
  getKeepOutBoxes,
  clampAlong,
} from '../utils/layout.js'
import { EXTRA_FURNITURE, EXTRA_CATEGORIES } from './extraFurniture.js'

let idCounter = 1

const makeId = (prefix) => `${prefix}-${idCounter++}`

// -----------------------------------------------------
// ROOM TYPES (for the UI dropdown)
// -----------------------------------------------------

export const ROOM_TYPES = [
  { id: 'bedroom',     name: 'Bedroom' },
  { id: 'living-room', name: 'Living Room' },
  { id: 'study',       name: 'Study Room' },
  { id: 'dining',      name: 'Dining Room' },
  { id: 'kitchen',     name: 'Kitchen' },
  { id: 'bathroom',    name: 'Bathroom' },
  { id: 'kids-room',   name: 'Kids Room' },
  { id: 'entrance',    name: 'Entrance / Foyer' },
  { id: 'balcony',     name: 'Balcony' },
  { id: 'utility',     name: 'Utility / Laundry' },
  { id: 'pooja',       name: 'Pooja Room' },
  { id: 'gym',         name: 'Home Gym' },
  { id: 'classroom',   name: 'Classroom' },
  { id: 'computer-lab', name: 'Computer Lab' },
]

// -----------------------------------------------------
// FURNITURE DEFINITIONS
//   width / depth / height are in feet and match the 3D models.
//   wallMounted items hang on a wall (like windows) at `elevation`.
// -----------------------------------------------------

export const furnitureDefinitions = {

  // ── BEDROOM ────────────────────────────────────────
  bed: {
    name: 'Bed',
    category: 'Bedroom',
    width: 5.5,
    depth: 6.5,
    height: 3.7, // includes headboard
  },
  wardrobe: {
    name: 'Wardrobe',
    category: 'Bedroom',
    width: 4,
    depth: 1.8,
    height: 6.5,
  },
  almirah: {
    name: 'Almirah',
    category: 'Bedroom',
    width: 4,
    depth: 1.8,
    height: 6.5,
  },
  bedside: {
    name: 'Bedside Table',
    category: 'Bedroom',
    width: 1.8,
    depth: 1.6,
    height: 2,
  },

  // ── LIVING ROOM ────────────────────────────────────
  sofa: {
    name: 'Sofa (3-Seater)',
    category: 'Living',
    width: 6,
    depth: 2.8,
    height: 3.9,
  },
  loveseat: {
    name: 'Loveseat (2-Seater)',
    category: 'Living',
    width: 4,
    depth: 2.8,
    height: 3.9,
  },
  armchair: {
    name: 'Armchair',
    category: 'Living',
    width: 2.5,
    depth: 2.5,
    height: 3.5,
  },
  accentChair: {
    name: 'Accent Chair',
    category: 'Living',
    width: 2.2,
    depth: 2.2,
    height: 4.3,
  },
  coffeeTable: {
    name: 'Coffee Table',
    category: 'Living',
    width: 3.5,
    depth: 2,
    height: 1.4,
  },
  tvUnit: {
    name: 'TV Unit',
    category: 'Living',
    width: 5,
    depth: 1.5,
    height: 2,
  },
  tv: {
    name: 'Television (wall-mounted)',
    category: 'Living',
    width: 4,
    depth: 0.18,
    height: 2.5,
    wallMounted: true,
    elevation: 3,
  },
  sideTable: {
    name: 'Side Table',
    category: 'Living',
    width: 1.5,
    depth: 1.5,
    height: 2,
  },

  // ── STUDY ──────────────────────────────────────────
  desk: {
    name: 'Study Desk',
    category: 'Study',
    width: 4,
    depth: 2,
    height: 2.7,
  },
  studyChair: {
    name: 'Study Chair',
    category: 'Study',
    width: 1.8,
    depth: 1.8,
    height: 4.3,
  },
  bookshelf: {
    name: 'Bookshelf',
    category: 'Study',
    width: 3,
    depth: 1.2,
    height: 6,
  },

  // ── DINING ─────────────────────────────────────────
  diningTable: {
    name: 'Dining Table',
    category: 'Dining',
    width: 5,
    depth: 3,
    height: 2.75,
  },
  diningChair: {
    name: 'Dining Chair',
    category: 'Dining',
    width: 1.5,
    depth: 1.5,
    height: 4.3,
  },
  cabinet: {
    name: 'Dining Cabinet',
    category: 'Dining',
    width: 4,
    depth: 1.5,
    height: 4,
  },

  // ── KITCHEN ────────────────────────────────────────
  kitchenCabinet: {
    name: 'Kitchen Cabinet',
    category: 'Kitchen',
    width: 3,
    depth: 1.5,
    height: 5.6,
  },
  kitchenIsland: {
    name: 'Kitchen Island',
    category: 'Kitchen',
    width: 4.1,
    depth: 3,
    height: 3.2,
  },
  fridge: {
    name: 'Refrigerator',
    category: 'Kitchen',
    width: 2.5,
    depth: 2.5,
    height: 6,
  },

  // ── BATHROOM ───────────────────────────────────────
  basin: {
    name: 'Wash Basin',
    category: 'Bathroom',
    width: 2,
    depth: 1.5,
    height: 3.4,
  },
  bathtub: {
    name: 'Bathtub',
    category: 'Bathroom',
    width: 5.1,
    depth: 2.6,
    height: 2.2,
  },
  toilet: {
    name: 'Toilet',
    category: 'Bathroom',
    width: 1.8,
    depth: 2.4,
    height: 3.2,
  },
  shower: {
    name: 'Shower Cubicle',
    category: 'Bathroom',
    width: 3,
    depth: 3,
    height: 7,
  },
  washingMachine: {
    name: 'Washing Machine',
    category: 'Bathroom',
    width: 2.2,
    depth: 2.2,
    height: 3.2,
  },

  // ── DECOR ──────────────────────────────────────────
  painting: {
    name: 'Wall Painting',
    category: 'Decor',
    width: 3,
    depth: 0.18,
    height: 2.5,
    wallMounted: true,
    elevation: 4.2, // hangs above sofas, beds and cabinets
  },
  mirror: {
    name: 'Wall Mirror',
    category: 'Decor',
    width: 2,
    depth: 0.12,
    height: 2.5,
    wallMounted: true,
    elevation: 4,
  },
}

// -----------------------------------------------------
// FURNITURE CATEGORIES (for UI dropdown)
// -----------------------------------------------------

export const FURNITURE_CATEGORIES = {
  Bedroom:  ['bed', 'wardrobe', 'almirah', 'bedside'],
  Living:   ['sofa', 'loveseat', 'armchair', 'accentChair', 'coffeeTable', 'tvUnit', 'tv', 'sideTable'],
  Study:    ['desk', 'studyChair', 'bookshelf'],
  Dining:   ['diningTable', 'diningChair', 'cabinet'],
  Kitchen:  ['kitchenCabinet', 'kitchenIsland', 'fridge'],
  Bathroom: ['basin', 'bathtub', 'toilet', 'shower', 'washingMachine'],
  Decor:    ['painting', 'mirror'],
}

// Extra furniture (data/extraFurniture.js): add every new type and its categories
for (const [type, d] of Object.entries(EXTRA_FURNITURE)) {
  if (!furnitureDefinitions[type]) furnitureDefinitions[type] = d
}
for (const [cat, types] of Object.entries(EXTRA_CATEGORIES)) {
  const list = FURNITURE_CATEGORIES[cat] || (FURNITURE_CATEGORIES[cat] = [])
  for (const t of types) if (!list.includes(t)) list.push(t)
}

// -----------------------------------------------------
// STYLE PRESETS
//   wall / furniture / floor  -> what the room looks like
//   maxTier                   -> how much the generator puts in:
//                                1 = essentials, 2 = + comfort, 3 = + decor & extras
// -----------------------------------------------------

export const stylePresets = {
  minimal: {
    name: 'Minimal', wall: '#f5f5f0', furniture: '#d6d0c4', floor: 'lightWood',
    maxTier: 1,
    description: 'Essentials only · clean and uncluttered',
  },
  modern: {
    name: 'Modern', wall: '#e8e8e8', furniture: '#555555', floor: 'darkWood',
    maxTier: 2,
    description: 'Essentials + comfort · dark tones, wall-mounted TV',
  },
  cozy: {
    name: 'Cozy', wall: '#ead8c0', furniture: '#8b5e3c', floor: 'warmWood',
    maxTier: 3,
    description: 'Fully furnished · extra seating, shelves and wall art',
  },
  industrial: {
    name: 'Industrial', wall: '#777777', furniture: '#3d3d3d', floor: 'concrete',
    maxTier: 2,
    description: 'Practical · open shelving, raw materials, no decor',
  },
}

// -----------------------------------------------------
// WALL PAINT OPTIONS
// -----------------------------------------------------

export const wallPaints = [
  { id: 'warm-white',  name: 'Warm White',  color: '#f5f5f0' },
  { id: 'pure-white',  name: 'Pure White',  color: '#ffffff' },
  { id: 'beige',       name: 'Beige',       color: '#ead8c0' },
  { id: 'sage',        name: 'Sage Green',  color: '#a8b5a2' },
  { id: 'dusty-blue',  name: 'Dusty Blue',  color: '#8fa6b8' },
  { id: 'terracotta',  name: 'Terracotta',  color: '#b96f5a' },
  { id: 'charcoal',    name: 'Charcoal',    color: '#4b4b4b' },
]

// AI-suggested wall palettes (used when AI button is clicked)
export const aiWallPalettes = [
  { name: 'Nordic Calm',    back: '#e8e3db', front: '#e8e3db', left: '#ddd8d0', right: '#ddd8d0' },
  { name: 'Sage Studio',    back: '#c5d5c5', front: '#c5d5c5', left: '#b8c8b8', right: '#b8c8b8' },
  { name: 'Coastal Blue',   back: '#d0dce8', front: '#d0dce8', left: '#c5d0e0', right: '#c5d0e0' },
  { name: 'Warm Blush',     back: '#edd5cf', front: '#edd5cf', left: '#e0c8c2', right: '#e0c8c2' },
  { name: 'Charcoal Loft',  back: '#4b4b4b', front: '#4b4b4b', left: '#3e3e3e', right: '#3e3e3e' },
  { name: 'Terracotta Glow',back: '#c47a5a', front: '#c47a5a', left: '#b57050', right: '#b57050' },
]

// -----------------------------------------------------
// FLOOR OPTIONS
// -----------------------------------------------------

export const floorPresets = [
  { id: 'lightWood', name: 'Light Wood'  },
  { id: 'warmWood',  name: 'Warm Wood'   },
  { id: 'darkWood',  name: 'Dark Wood'   },
  { id: 'tile',      name: 'Tile'        },
  { id: 'marble',    name: 'Marble'      },
  { id: 'concrete',  name: 'Concrete'    },
  { id: 'carpet',    name: 'Carpet'      },
]

// -----------------------------------------------------
// CREATE FURNITURE OBJECTS
// -----------------------------------------------------

const baseItem = (type, style) => {
  const def = furnitureDefinitions[type]
  return {
    id:       makeId(type),
    type,
    name:     def.name,
    category: def.category,
    width:    def.width,
    depth:    def.depth,
    height:   def.height,
  }
}

/** Free-standing piece on the floor */
export const createFurniture = (type, x = 0, z = 0, rotation = 0, style) => {
  const def = furnitureDefinitions[type]
  if (!def) return null
  if (def.wallMounted) return createWallFurniture(type, 'back', 0, style)
  return { ...baseItem(type, style), x, z, rotation, elevation: 0 }
}

/** Piece that hangs on a wall (paintings, TV, mirror). Moves along the wall only. */
export const createWallFurniture = (type, wall = 'back', position = 0, style) => {
  const def = furnitureDefinitions[type]
  if (!def) return null
  return {
    ...baseItem(type, style),
    wallMounted: true,
    wall,
    position,
    elevation: def.elevation || 0,
    rotation: 0, // derived from the wall
    x: 0,
    z: 0,
  }
}

// -----------------------------------------------------
// DEFAULT DOORS + WINDOWS
// -----------------------------------------------------

export const generateDefaultOpenings = (roomType, width, length) => {
  const openings = []
  const doorWidth = ['bathroom', 'utility', 'pooja'].includes(roomType) ? 2.5 : ['entrance', 'classroom', 'computer-lab'].includes(roomType) ? 3.5 : 3

  openings.push({ id: makeId('door'), type: 'door', wall: 'front', position: 0, width: doorWidth, height: 6.8, offset: 0 })

  if ((roomType === 'living-room' || roomType === 'gym') && width >= 10) {
    openings.push({ id: makeId('window'), type: 'window', wall: 'back', position: -width / 4, width: 4, height: 4, offset: 3.5 })
    openings.push({ id: makeId('window'), type: 'window', wall: 'back', position:  width / 4, width: 4, height: 4, offset: 3.5 })
  }
  else if (roomType === 'bathroom' || roomType === 'utility') {
    // small, high window
    openings.push({ id: makeId('window'), type: 'window', wall: 'back', position: 0, width: 2, height: 2, offset: 4.5 })
  }
  else if (roomType === 'pooja') {
    // small high window on a side wall so the mandir wall stays clear
    openings.push({ id: makeId('window'), type: 'window', wall: 'left', position: 0, width: 2, height: 2, offset: 4.5 })
  }
  else if (roomType === 'classroom') {
    // windows on both side walls; the board wall (back) stays clear
    const n = length >= 14 ? 2 : 1
    for (const wall of ['left', 'right']) {
      for (let i = 0; i < n; i++) {
        const position = n === 1 ? 0 : (i === 0 ? -length / 4 : length / 4)
        openings.push({ id: makeId('window'), type: 'window', wall, position, width: 4, height: 4, offset: 3.5 })
      }
    }
  }
  else if (roomType === 'computer-lab') {
    // high windows so the PC rows can run along the walls underneath
    const n = length >= 14 ? 2 : 1
    for (const wall of ['left', 'right']) {
      for (let i = 0; i < n; i++) {
        const position = n === 1 ? 0 : (i === 0 ? -length / 4 : length / 4)
        openings.push({ id: makeId('window'), type: 'window', wall, position, width: 4, height: 3, offset: 4.6 })
      }
    }
  }
  else if (roomType === 'entrance') {
    // door only
  }
  else if (roomType === 'balcony') {
    // door only, opening outward so the small floor stays usable
    openings[0].swing = 'out'
  }
  else {
    openings.push({ id: makeId('window'), type: 'window', wall: 'back', position: 0, width: 4, height: 4, offset: 3.5 })
  }

  return openings
}

// -----------------------------------------------------
// LAYOUT ENGINE
//
// Orientation reference (matches the 3D models):
//   walls   : front = -z (door wall), back = +z (window wall), left = -x, right = +x
//   models  : most pieces face -z at rotation 0; the ones in FACES_PLUS_Z face +z
// -----------------------------------------------------

const FACES_PLUS_Z = new Set([
  'bed', 'sofa', 'loveseat', 'armchair', 'accentChair', 'studyChair',
  'diningChair', 'basin', 'toilet', 'desk',
  // extra furniture whose front faces +z
  'singleBed', 'kidsBed', 'cot', 'dresser', 'dressingTable', 'bench', 'recliner', 'sectional',
  'consoleTable', 'sideboard', 'shoeRack', 'shelfUnit', 'displayUnit', 'crockeryUnit', 'barStool',
  'stove', 'kitchenSink', 'dishwasher', 'pantry', 'vanity', 'filingCabinet', 'toyBox',
  'outdoorChair', 'dryer', 'poojaUnit', 'treadmill', 'weightBench', 'exerciseBike',
  'bunkBed', 'pcRow', 'pcDesk', 'labChair', 'collegeBench', 'collegeBench2', 'teacherDesk', 'podium',
])

const INWARD   = { back: { x: 0, z: -1 }, front: { x: 0, z: 1 }, left: { x: 1, z: 0 }, right: { x: -1, z: 0 } }
const OPPOSITE = { back: 'front', front: 'back', left: 'right', right: 'left' }

/** Rotation (about Y) that makes `type` face the cardinal direction `dir` */
export function rotationToFace(type, dir) {
  const f = FACES_PLUS_Z.has(type) ? { x: 0, z: 1 } : { x: 0, z: -1 }
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const fx =  f.x * Math.cos(r) + f.z * Math.sin(r)
    const fz = -f.x * Math.sin(r) + f.z * Math.cos(r)
    if (Math.abs(fx - dir.x) < 1e-6 && Math.abs(fz - dir.z) < 1e-6) return r
  }
  return 0
}

const cardinal = (dx, dz) =>
  Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) || 1 }

/**
 * Build a furnished room.
 *
 * Items are added in priority order. Each one is only kept if:
 *   - its tier is allowed by the style (minimal < modern/industrial < cozy)
 *   - it fits the room: inside the walls, no overlap, clear of the door swing
 *     and of tall pieces in front of windows
 */
export function generateRoom({ roomType, width, length, style = 'modern' }) {
  const room   = { width, length }
  const rules  = stylePresets[style] || stylePresets.modern
  const openings = generateDefaultOpenings(roomType, width, length)

  const placed  = []
  const skipped = []
  const meta    = new WeakMap() // item -> { wall, along }
  let aborted = false // a core piece (bed, sofa, desk...) didn't fit: the room is unusable, stop adding

  const ctx = { openings, furniture: placed, room }

  const buildItem = (type, pose) => {
    const def = furnitureDefinitions[type]
    if (!def.wallMounted) return createFurniture(type, pose.x, pose.z, pose.rotation, style)
    const item = createWallFurniture(type, pose.wall, pose.position, style)
    if (pose.elevation !== undefined) item.elevation = pose.elevation
    return item
  }

  const fitsFloor = (item, gap) => {
    if (!isInsideRoom(item, room)) return false
    if (placed.some((o) => itemsCollide(item, o, room, gap))) return false
    const box = getItemBox(item, room)
    return !getKeepOutBoxes(openings, room, item.height).some((k) => boxesOverlap(box, k, 0))
  }

  const fits = (item, gap) =>
    item.wallMounted ? !isWallItemBlocked(item, ctx) : fitsFloor(item, gap)

  /**
   * Try to add a piece.
   *  tier    1 essential · 2 comfort · 3 extras
   *  styles  only for these styles
   *  silent  don't report failure (used for "try A, else B")
   *  gap     minimum clearance to neighbours (aisles)
   *  accept  extra check on the placed item (e.g. "chairs must fit too")
   *  core    the room's main piece: if it can't be placed, stop furnishing
   */
  const put = (type, candidates, { tier = 1, styles, silent = false, gap = COLLISION_GAP, accept, core = false } = {}) => {
    if (aborted) return null
    if (tier > rules.maxTier) return null
    if (styles && !styles.includes(style)) return null

    const def = furnitureDefinitions[type]

    for (const pose of candidates) {
      const item = buildItem(type, pose)
      if (!fits(item, gap)) continue
      if (accept && !accept(item)) continue
      placed.push(item)
      meta.set(item, { wall: pose.wall, along: pose.along ?? pose.position })
      return item
    }

    if (!silent && tier === 1) skipped.push({ type, name: def.name, reason: 'space' })
    if (core && !silent) aborted = true
    return null
  }

  // ── Candidate pose builders ──────────────────────────

  const wallLen = (wall) => getWallLength(wall, room)
  const isHoriz = (wall) => wall === 'front' || wall === 'back'

  /** Pose of `type` pushed flush against `wall`, centred at `along` */
  const poseOnWall = (type, wall, along) => {
    const def = furnitureDefinitions[type]

    if (def.wallMounted) {
      const position = clampAlong(wall, along, def.width, room)
      return { wall, position, along: position }
    }

    const rotation = rotationToFace(type, INWARD[wall])
    const { hw, hd } = getHalfExtents(def.width, def.depth, rotation)
    const lim = Math.max(0, wallLen(wall) / 2 - WALL_CLEARANCE - (isHoriz(wall) ? hw : hd))
    const a = Math.max(-lim, Math.min(lim, along))

    switch (wall) {
      case 'back':  return { x: a, z:  length / 2 - WALL_CLEARANCE - hd, rotation, wall, along: a }
      case 'front': return { x: a, z: -length / 2 + WALL_CLEARANCE + hd, rotation, wall, along: a }
      case 'left':  return { x: -width / 2 + WALL_CLEARANCE + hw, z: a,  rotation, wall, along: a }
      default:      return { x:  width / 2 - WALL_CLEARANCE - hw, z: a,  rotation, wall, along: a }
    }
  }

  const resolveAlong = (wall, a) =>
    a === 'min' ? -wallLen(wall) / 2 : a === 'max' ? wallLen(wall) / 2 : a === 'center' ? 0 : a

  /**
   * Candidates along walls, e.g. wc('bed', [['left','center'], ['right','center']]).
   * For each wall the start position is tried first, then positions further and
   * further away, so pieces naturally slot in next to the ones already placed.
   */
  const wc = (type, specs, step = 0.2) => {
    const out = []
    const seen = new Set()
    for (const [wall, along] of specs) {
      const start = resolveAlong(wall, along)
      for (let k = 0; k * step <= wallLen(wall) + step; k++) {
        for (const sgn of k === 0 ? [0] : [1, -1]) {
          const pose = poseOnWall(type, wall, start + sgn * k * step)
          const key = `${wall}:${pose.along.toFixed(2)}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push(pose)
        }
      }
    }
    return out
  }

  /** Candidates in the open floor, closest to (cx, cz) first */
  const nearby = (cx, cz, rotation = 0, radius = 3, step = 0.5) => {
    const out = []
    for (let dx = -radius; dx <= radius + 1e-9; dx += step) {
      for (let dz = -radius; dz <= radius + 1e-9; dz += step) {
        out.push({ x: cx + dx, z: cz + dz, rotation, d: Math.hypot(dx, dz) })
      }
    }
    return out.sort((a, b) => a.d - b.d)
  }

  /** Half-length of a placed item measured along its wall */
  const alongHalf = (item, wall) => {
    const { hw, hd } = getHalfExtents(item.width, item.depth, item.rotation || 0)
    return isHoriz(wall) ? hw : hd
  }

  /** Where a chair goes if it sits in front of a desk that is against `wall` */
  const chairBehind = (type, desk, wall) => {
    const out  = INWARD[wall]
    const cdef = furnitureDefinitions[type]
    const { hw, hd } = getHalfExtents(desk.width, desk.depth, desk.rotation)
    const across = isHoriz(wall) ? hd : hw
    const dist = across + 0.06 + cdef.depth / 2
    const rotation = rotationToFace(type, { x: -out.x, z: -out.z })
    return [0, 0.5, -0.5, 1, -1].map((off) => ({
      x: desk.x + out.x * dist + (isHoriz(wall) ? off : 0),
      z: desk.z + out.z * dist + (isHoriz(wall) ? 0 : off),
      rotation,
    }))
  }

  const decorTier   = style === 'cozy' ? 3 : 2
  const decorStyles = ['modern', 'cozy']

  /** Window-air-conditioner slots: one per window, sitting on its sill */
  const windowSlots = () => openings.filter((o) => o.type === 'window').map((o) => ({
    wall: o.wall, position: o.position, along: o.position, elevation: (Number(o.offset) || 3) + 0.05,
  }))

  /** Point on `wall` at distance `inset` from its inner face, `a` along it */
  const wallPoint = (wall, a, inset) => {
    switch (wall) {
      case 'back':  return { x: a, z:  length / 2 - WALL_CLEARANCE - inset }
      case 'front': return { x: a, z: -length / 2 + WALL_CLEARANCE + inset }
      case 'left':  return { x: -width / 2 + WALL_CLEARANCE + inset, z: a }
      default:      return { x:  width / 2 - WALL_CLEARANCE - inset, z: a }
    }
  }

  /** Professor's desk a little off `wall` (facing the room) with the chair between desk and wall */
  const teacherSetup = (wall, alongs, tier = 1) => {
    const tdef = furnitureDefinitions.teacherDesk
    const inw = INWARD[wall]
    const rot = rotationToFace('teacherDesk', inw)
    const poses = alongs.map((a) => ({ ...wallPoint(wall, a, 2.4 + tdef.depth / 2), rotation: rot }))
    const desk = put('teacherDesk', poses, { tier })
    if (desk) {
      const c = wallPoint(wall, isHoriz(wall) ? desk.x : desk.z, 1.25)
      put('studyChair', [{ x: c.x, z: c.z, rotation: rotationToFace('studyChair', inw) }], { tier })
    }
    return desk
  }

  // ═══════════════════════════════════════════════════
  // BEDROOM — bed with headboard on a side wall, wardrobe on the far wall,
  //           bedside tables flanking the headboard
  // ═══════════════════════════════════════════════════
  if (roomType === 'bedroom') {
    const bed = put('bed', wc('bed', [['left', 'center'], ['right', 'center'], ['front', 'center']]), { tier: 1, core: true })
    const bm  = bed && meta.get(bed)

    put('wardrobe', wc('wardrobe', [
      ['right', 'max'], ['right', 'min'], ['left', 'max'], ['left', 'min'],
      ['front', 'max'], ['front', 'min'],
    ]), { tier: 1 })

    if (bed) {
      const half = alongHalf(bed, bm.wall)
      put('bedside', wc('bedside', [[bm.wall, bm.along - half - 1.0]]), { tier: 1 })
      put('bedside', wc('bedside', [[bm.wall, bm.along + half + 1.0]]), { tier: 2 })
    }

    // Work corner
    const desk = put('desk', wc('desk', [['back', 'min'], ['back', 'max'], ['right', 'max'], ['left', 'max']]), { tier: 2 })
    if (desk) put('studyChair', chairBehind('studyChair', desk, meta.get(desk).wall), { tier: 2 })

    // TV on the wall facing the bed
    if (bed) {
      put('tv', wc('tv', [[OPPOSITE[bm.wall], 0], ['front', 'max'], ['front', 'min']]), { tier: 2, styles: ['modern', 'cozy'] })
    }

    put('bookshelf', wc('bookshelf', [['front', 'min'], ['front', 'max'], ['left', 'min'], ['right', 'min']]),
      { tier: style === 'industrial' ? 2 : 3, styles: ['industrial', 'cozy'] })

    put('armchair', wc('armchair', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })

    put('dresser', wc('dresser', [['left', 'min'], ['right', 'min'], ['front', 'min'], ['front', 'max']]), { tier: 2 })
    put('dressingTable', wc('dressingTable', [['back', 'max'], ['back', 'min'], ['right', 'min'], ['left', 'min']]), { tier: 3, styles: ['cozy'] })
    if (bed) {
      // bench at the foot of the bed
      const out = INWARD[bm.wall]
      const { hw, hd } = getHalfExtents(bed.width, bed.depth, bed.rotation)
      const across = isHoriz(bm.wall) ? hd : hw
      put('bench', [{ x: bed.x + out.x * (across + 1.0), z: bed.z + out.z * (across + 1.0), rotation: bed.rotation }], { tier: 3, styles: ['cozy'] })
    }
    put('windowAc', windowSlots(), { tier: 2, styles: ['modern', 'cozy'], silent: true })
      || put('acUnit', wc('acUnit', [['right', 'center'], ['left', 'center'], ['front', 'min']]), { tier: 2, styles: ['modern', 'cozy'] })
    put('plant', wc('plant', [['back', 'max'], ['front', 'max'], ['right', 'max']]), { tier: 3, styles: ['cozy'] })

    if (bed) put('painting', wc('painting', [[bm.wall, bm.along]]), { tier: decorTier, styles: decorStyles })
    put('painting', wc('painting', [['front', 'center'], ['back', 'max'], ['right', 'center']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // LIVING ROOM — sofa facing a TV wall, coffee table between
  // ═══════════════════════════════════════════════════
  else if (roomType === 'living-room') {
    const seatWalls = [['right', 'center'], ['left', 'center'], ['back', 'center']]
    const first  = style === 'minimal' ? 'loveseat' : 'sofa'
    const second = style === 'minimal' ? 'sofa' : 'loveseat'
    const seat = put(first, wc(first, seatWalls), { tier: 1, silent: true })
              || put(second, wc(second, seatWalls), { tier: 1, core: true })

    if (seat) {
      const sm  = meta.get(seat)
      const opp = OPPOSITE[sm.wall]

      const unit = put('tvUnit', wc('tvUnit', [[opp, sm.along], [opp, 'center']]), { tier: 1 })
      const um   = unit && meta.get(unit)

      if (unit) {
        put('tv', wc('tv', [[opp, um.along]]), { tier: 2 })

        const rot = isHoriz(sm.wall) ? 0 : Math.PI / 2
        put('coffeeTable', nearby((seat.x + unit.x) / 2, (seat.z + unit.z) / 2, rot), { tier: 1 })
      }

      const half = alongHalf(seat, sm.wall)
      put('sideTable', wc('sideTable', [[sm.wall, sm.along + half + 1.0], [sm.wall, sm.along - half - 1.0]]), { tier: 2 })

      put('armchair', wc('armchair', [['back', 'min'], ['back', 'max'], ['front', 'min'], ['front', 'max']]), { tier: 2 })

      put('accentChair', wc('accentChair', [['back', 'max'], ['front', 'max'], ['back', 'min'], ['front', 'min']]), { tier: 3, styles: ['cozy'] })
      put('consoleTable', wc('consoleTable', [['front', 'max'], ['back', 'max'], ['front', 'min']]), { tier: 3, styles: ['cozy'] })
      put('recliner', wc('recliner', [['back', 'min'], ['front', 'min'], ['back', 'max']]), { tier: 3, styles: ['cozy'] })
      put('acUnit', wc('acUnit', [['front', 'max'], ['left', 'center'], ['right', 'center']]), { tier: 2, styles: ['modern', 'cozy'] })
      put('plant', wc('plant', [['back', 'max'], ['front', 'max'], ['back', 'min']]), { tier: 3, styles: ['cozy'] })
      put('roundSideTable', wc('roundSideTable', [[sm.wall, sm.along - alongHalf(seat, sm.wall) - 1.0], [sm.wall, sm.along + alongHalf(seat, sm.wall) + 1.0]]), { tier: 3, styles: ['cozy'] })
      put('floorLamp', wc('floorLamp', [[sm.wall, sm.along + alongHalf(seat, sm.wall) + 0.8], [sm.wall, sm.along - alongHalf(seat, sm.wall) - 0.8]]), { tier: 3, styles: ['cozy'] })

      put('bookshelf', wc('bookshelf', [['front', 'min'], ['front', 'max'], ['back', 'min'], ['back', 'max']]),
        { tier: style === 'industrial' ? 2 : 3, styles: ['industrial', 'cozy'] })

      put('painting', wc('painting', [[sm.wall, sm.along]]), { tier: decorTier, styles: decorStyles })
      put('painting', wc('painting', [['front', 'center'], ['back', 'center'], [opp, 'max']]), { tier: 3, styles: ['cozy'] })
    }
  }

  // ═══════════════════════════════════════════════════
  // STUDY — desk facing the window wall, shelves on the side
  // ═══════════════════════════════════════════════════
  else if (roomType === 'study') {
    const desk = put('desk', wc('desk', [['back', 'center'], ['left', 'center'], ['right', 'center'], ['front', 'min']]), { tier: 1, core: true })
    if (desk) put('studyChair', chairBehind('studyChair', desk, meta.get(desk).wall), { tier: 1 })

    put('bookshelf', wc('bookshelf', [['left', 'center'], ['right', 'center'], ['front', 'min'], ['front', 'max']]), { tier: 1 })
    put('bookshelf', wc('bookshelf', [['right', 'center'], ['left', 'min'], ['right', 'min'], ['front', 'max']]), { tier: 2 })

    put('accentChair', wc('accentChair', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 2, styles: ['modern'] })

    put('armchair', wc('armchair', [['right', 'min'], ['left', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })
    put('sideTable', wc('sideTable', [['right', 'min'], ['left', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })

    put('painting', wc('painting', [['front', 'center'], ['left', 'center'], ['right', 'center']]), { tier: decorTier, styles: decorStyles })
    put('filingCabinet', wc('filingCabinet', [['front', 'max'], ['left', 'max'], ['right', 'max']]), { tier: 3, styles: ['industrial', 'cozy'] })
    put('whiteboard', wc('whiteboard', [['front', 'center'], ['left', 'center'], ['right', 'center']]), { tier: 2, styles: ['modern', 'industrial'] })
    put('windowAc', windowSlots(), { tier: 2, styles: ['modern', 'cozy'], silent: true })
    put('plant', wc('plant', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // DINING — table (kept away from the door) with chairs on every side that fits
  // ═══════════════════════════════════════════════════
  else if (roomType === 'dining') {
    const tableRot = width >= length ? 0 : Math.PI / 2
    const tdef = furnitureDefinitions.diningTable
    const cdef = furnitureDefinitions.diningChair

    const chairSlots = (table) => {
      const sideOff = tdef.depth / 2 + 0.06 + cdef.depth / 2
      const endOff  = tdef.width / 2 + 0.06 + cdef.depth / 2
      const locals = [
        [-1, -sideOff, 1], [-1, sideOff, 1],
        [ 1, -sideOff, 2], [ 1, sideOff, 2],
        [-endOff, 0, 3],   [endOff, 0, 3],
      ]
      const cs = Math.cos(table.rotation)
      const sn = Math.sin(table.rotation)
      return locals.map(([lx, lz, tier]) => {
        const wx =  lx * cs + lz * sn
        const wz = -lx * sn + lz * cs
        const dir = cardinal(-wx, -wz) // facing the table
        return { x: table.x + wx, z: table.z + wz, rotation: rotationToFace('diningChair', dir), tier }
      })
    }

    // Cozy near-square rooms get a round table with a chair on each side
    const useRound = style === 'cozy' && Math.abs(width - length) <= 2.5
    const rdef = furnitureDefinitions.roundTable
    const roundChairSlots = (t) => {
      const off = (rdef.width + cdef.depth) / 2 + 0.1
      return [[-off, 0, 1], [off, 0, 1], [0, -off, 2], [0, off, 2]].map(([dx, dz, tier]) => ({
        x: t.x + dx, z: t.z + dz, rotation: rotationToFace('diningChair', cardinal(-dx, -dz)), tier,
      }))
    }
    const slotsFor = (t) => (useRound ? roundChairSlots(t) : chairSlots(t))
    const chairsFit = (t) => slotsFor(t).filter((s) => s.tier === 1)
      .every((s) => fitsFloor(createFurniture('diningChair', s.x, s.z, s.rotation, style), COLLISION_GAP))

    const table = useRound
      ? put('roundTable', nearby(0, length >= 10 ? 1 : 0, 0, 3), { tier: 1, core: true, accept: chairsFit })
      : put('diningTable', nearby(0, length >= 10 ? 1 : 0, tableRot, 3), { tier: 1, core: true, accept: chairsFit })

    if (table) {
      for (const s of slotsFor(table)) {
        put('diningChair', [{ x: s.x, z: s.z, rotation: s.rotation }], { tier: s.tier })
      }
    }

    const cab = put('cabinet', wc('cabinet', [['right', 'center'], ['left', 'center'], ['front', 'max'], ['front', 'min']]), { tier: 2 })
    if (cab) {
      const cm = meta.get(cab)
      put('painting', wc('painting', [[cm.wall, cm.along]]), { tier: decorTier, styles: decorStyles })
    }
    put('sideTable', wc('sideTable', [['left', 'min'], ['right', 'min'], ['back', 'max']]), { tier: 3, styles: ['cozy'] })
    put('crockeryUnit', wc('crockeryUnit', [['left', 'center'], ['right', 'center'], ['front', 'max'], ['front', 'min']]), { tier: 3, styles: ['cozy'] })
    put('plant', wc('plant', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })
    put('painting', wc('painting', [['front', 'center'], ['left', 'center'], ['right', 'center']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // KITCHEN — counter run along the side wall, fridge at the end,
  //           island in the middle when the room is wide enough
  // ═══════════════════════════════════════════════════
  else if (roomType === 'kitchen') {
    const run = [['left', 'max'], ['right', 'max'], ['left', 'min'], ['right', 'min']]
    const fridgeWalls = [['right', 'max'], ['left', 'max'], ['right', 'min'], ['left', 'min']]

    put('kitchenCabinet', wc('kitchenCabinet', run), { tier: 1, core: true })
    put('kitchenSink',    wc('kitchenSink', run), { tier: 1 })
    put('stove',          wc('stove', run), { tier: 1 })
    put('kitchenCabinet', wc('kitchenCabinet', run), { tier: 1 })
    put('fridge',         wc('fridge', fridgeWalls), { tier: 1 })
    put('dishwasher',     wc('dishwasher', run), { tier: 2 })
    put('trashBin',       wc('trashBin', [['front', 'min'], ['front', 'max'], ['right', 'min'], ['left', 'min']]), { tier: 2 })
    put('kitchenCabinet', wc('kitchenCabinet', run), { tier: 2 })
    put('kitchenCabinet', wc('kitchenCabinet', run), { tier: 2 })
    put('kitchenIsland',  nearby(0, 1, 0, 4), { tier: 2, gap: 2.2 })
    put('pantry', wc('pantry', run), { tier: 3 })
    put('kitchenCabinet', wc('kitchenCabinet', run), { tier: 3 })
    put('kitchenCabinet', wc('kitchenCabinet', run), { tier: 3 })

    put('painting', wc('painting', [['front', 'max'], ['front', 'min'], ['right', 'center']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // BATHROOM — shower in a corner, basin + mirror beside it,
  //            toilet on the window wall
  // ═══════════════════════════════════════════════════
  else if (roomType === 'bathroom') {
    put('shower', wc('shower', [['left', 'max'], ['right', 'max'], ['left', 'min'], ['right', 'min']]), { tier: 1 })
    put('toilet', wc('toilet', [['back', 'max'], ['back', 'min'], ['right', 'max'], ['right', 'min']]), { tier: 1 })

    const basin = put('basin', wc('basin', [['left', 'max'], ['right', 'max'], ['left', 'min'], ['right', 'min']]), { tier: 1 })
    if (basin) {
      const bm = meta.get(basin)
      put('mirror', wc('mirror', [[bm.wall, bm.along]]), { tier: 2 })
    }

    put('washingMachine', wc('washingMachine', [['right', 'min'], ['left', 'min'], ['front', 'max'], ['front', 'min']]), { tier: 2 })

    put('bathtub', wc('bathtub', [['right', 'center'], ['left', 'center'], ['back', 'center']]),
      { tier: style === 'cozy' ? 3 : 2, styles: ['modern', 'cozy'] })

    put('towelRack', wc('towelRack', [['right', 'center'], ['left', 'center'], ['front', 'center'], ['back', 'center']]), { tier: 2 })
    put('bathroomShelf', wc('bathroomShelf', [['front', 'max'], ['right', 'center'], ['left', 'center']]), { tier: 3, styles: ['cozy'] })
    put('trashBin', wc('trashBin', [['front', 'min'], ['back', 'min'], ['right', 'min']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // KIDS ROOM — bed on a side wall, wardrobe, study corner, toys and play space
  // ═══════════════════════════════════════════════════
  else if (roomType === 'kids-room') {
    // bunk bed against a side wall (a plain kids bed if the room is too small for it)
    const bedWalls = [['left', 'center'], ['right', 'center'], ['front', 'center']]
    const bed = put('bunkBed', wc('bunkBed', bedWalls), { tier: 1, silent: true })
           || put('kidsBed', wc('kidsBed', bedWalls), { tier: 1, core: true })
    const bm  = bed && meta.get(bed)

    put('wardrobe', wc('wardrobe', [
      ['right', 'max'], ['right', 'min'], ['left', 'max'], ['left', 'min'], ['front', 'max'], ['front', 'min'],
    ]), { tier: 1 })

    put('windowAc', windowSlots(), { tier: 2, silent: true })
    if (bed && bed.type === 'kidsBed') put('bedside', wc('bedside', [[bm.wall, bm.along + alongHalf(bed, bm.wall) + 1.0], [bm.wall, bm.along - alongHalf(bed, bm.wall) - 1.0]]), { tier: 2 })

    const desk = put('desk', wc('desk', [['back', 'min'], ['back', 'max'], ['right', 'max'], ['left', 'max']]), { tier: 2 })
    if (desk) put('studyChair', chairBehind('studyChair', desk, meta.get(desk).wall), { tier: 2 })

    put('toyBox', wc('toyBox', [['front', 'min'], ['front', 'max'], ['left', 'min'], ['right', 'min']]), { tier: 2 })
    put('bookshelf', wc('bookshelf', [['front', 'max'], ['front', 'min'], ['left', 'min'], ['right', 'min']]), { tier: 2 })
    put('playTable', nearby(0, 0, 0, 3), { tier: 3, gap: 1.5 })
    put('beanBag', wc('beanBag', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })
    put('painting', wc('painting', [['front', 'center'], ['back', 'max'], ['right', 'center']]), { tier: decorTier, styles: decorStyles })
  }

  // ═══════════════════════════════════════════════════
  // ENTRANCE / FOYER — shoe rack and coat rack by the door, console + mirror
  // ═══════════════════════════════════════════════════
  else if (roomType === 'entrance') {
    put('shoeRack', wc('shoeRack', [['left', 'min'], ['right', 'min'], ['left', 'max'], ['right', 'max']]), { tier: 1, core: true })
    put('coatRack', wc('coatRack', [['left', 'center'], ['right', 'center'], ['back', 'center']]), { tier: 1 })

    const con = put('consoleTable', wc('consoleTable', [['back', 'center'], ['right', 'max'], ['left', 'max']]), { tier: 2 })
    if (con) {
      const cm = meta.get(con)
      put('mirror', wc('mirror', [[cm.wall, cm.along]]), { tier: 2 })
    }
    put('bench', wc('bench', [['left', 'max'], ['right', 'max'], ['back', 'min']]), { tier: 2 })
    put('plant', wc('plant', [['back', 'max'], ['back', 'min'], ['right', 'max']]), { tier: 3, styles: ['cozy'] })
    put('painting', wc('painting', [['left', 'center'], ['right', 'center'], ['back', 'max']]), { tier: decorTier, styles: decorStyles })
  }

  // ═══════════════════════════════════════════════════
  // BALCONY — small table with two chairs, planters, drying rack
  // ═══════════════════════════════════════════════════
  else if (roomType === 'balcony') {
    const table = put('outdoorTable', nearby(0, 0, 0, Math.max(width, length) / 2, 0.5), { tier: 1, core: true })
    if (table) {
      const off = (furnitureDefinitions.outdoorTable.width + furnitureDefinitions.outdoorChair.depth) / 2 + 0.15
      const slots = [[-off, 0], [off, 0], [0, -off], [0, off]].map(([dx, dz]) => ({
        x: table.x + dx, z: table.z + dz, rotation: rotationToFace('outdoorChair', cardinal(-dx, -dz)),
      }))
      put('outdoorChair', slots, { tier: 1 })
      put('outdoorChair', slots, { tier: 1 })
    }
    const edge = [['left', 'max'], ['right', 'max'], ['left', 'min'], ['right', 'min'], ['back', 'max'], ['back', 'min']]
    put('planter', wc('planter', edge), { tier: 2 })
    put('planter', wc('planter', edge), { tier: 2 })
    put('clothesRack', wc('clothesRack', [['left', 'center'], ['right', 'center'], ['back', 'center']]), { tier: 2 })
    put('plant', wc('plant', edge), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // UTILITY / LAUNDRY — washer and dryer side by side, shelves, drying rack
  // ═══════════════════════════════════════════════════
  else if (roomType === 'utility') {
    const wm = put('washingMachine', wc('washingMachine', [['left', 'min'], ['right', 'min'], ['left', 'max'], ['right', 'max'], ['back', 'min']]), { tier: 1, core: true })
    if (wm) {
      const m = meta.get(wm)
      put('dryer', wc('dryer', [[m.wall, m.along + alongHalf(wm, m.wall) + 1.2]]), { tier: 1 })
    }
    put('shelfUnit', wc('shelfUnit', [['back', 'center'], ['left', 'center'], ['right', 'center']]), { tier: 1 })
    put('clothesRack', wc('clothesRack', [['back', 'max'], ['right', 'max'], ['left', 'max']]), { tier: 2 })
    put('trashBin', wc('trashBin', [['left', 'max'], ['right', 'max'], ['back', 'min']]), { tier: 2 })
    put('bench', wc('bench', [['front', 'max'], ['front', 'min'], ['back', 'max']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // POOJA ROOM — mandir on the wall facing the door, seating and storage
  // ═══════════════════════════════════════════════════
  else if (roomType === 'pooja') {
    put('poojaUnit', wc('poojaUnit', [['back', 'center'], ['left', 'center'], ['right', 'center'], ['front', 'max']]), { tier: 1, core: true })
    put('bench', nearby(0, -0.5, 0, 2), { tier: 2 })
    put('shelfUnit', wc('shelfUnit', [['right', 'center'], ['left', 'max'], ['right', 'max'], ['front', 'max']]), { tier: 2 })
    put('plant', wc('plant', [['back', 'max'], ['back', 'min'], ['right', 'max']]), { tier: 3, styles: ['cozy'] })
    put('painting', wc('painting', [['right', 'center'], ['front', 'max'], ['front', 'min']]), { tier: decorTier, styles: decorStyles })
  }

  // ═══════════════════════════════════════════════════
  // HOME GYM — cardio against a wall, free-weight bench in the open, mirror wall
  // ═══════════════════════════════════════════════════
  else if (roomType === 'gym') {
    put('treadmill', wc('treadmill', [['back', 'min'], ['back', 'max'], ['left', 'center'], ['right', 'center']]), { tier: 1, core: true })
    put('weightBench', nearby(0, 0, 0, 3), { tier: 1, gap: 1.5 })
    put('mirror', wc('mirror', [['left', 'center'], ['right', 'center'], ['front', 'max']]), { tier: 1 })
    put('exerciseBike', wc('exerciseBike', [['front', 'min'], ['front', 'max'], ['left', 'center'], ['right', 'center']]), { tier: 2 })
    put('mirror', wc('mirror', [['right', 'center'], ['left', 'center'], ['front', 'min']]), { tier: 2 })
    put('shelfUnit', wc('shelfUnit', [['front', 'max'], ['left', 'min'], ['right', 'min']]), { tier: 2 })
    put('acUnit', wc('acUnit', [['front', 'center'], ['left', 'center'], ['right', 'center']]), { tier: 2 })
    put('tv', wc('tv', [['front', 'max'], ['right', 'center'], ['left', 'center']]), { tier: 3, styles: ['cozy'] })
    put('plant', wc('plant', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // CLASSROOM — board + professor's desk on the back wall, rows of college benches facing it
  // ═══════════════════════════════════════════════════
  else if (roomType === 'classroom') {
    put('classBoard', wc('classBoard', [['back', 'center']]), { tier: 1, core: true })
    const desk = teacherSetup('back', [0, -width / 4, width / 4])
    put('podium', wc('podium', [['back', 'min'], ['back', 'max']]), { tier: 2 })

    const bdef = furnitureDefinitions.collegeBench
    const rowStep = bdef.depth + 1.6
    const usable = width - 2 * WALL_CLEARANCE - 0.1
    const perRow = Math.max(1, Math.floor((usable + 1.8) / (bdef.width + 1.8)))        // aisles of at least 1.8 ft
    const aisle = perRow > 1 ? Math.min(3.5, (usable - perRow * bdef.width) / (perRow - 1)) : 0 // spread the spare room
    const totalW = perRow * bdef.width + (perRow - 1) * aisle
    const firstZ = length / 2 - WALL_CLEARANCE - 2.4 - furnitureDefinitions.teacherDesk.depth - 2.5 - bdef.depth / 2
    for (let r = 0; r < 8; r++) {
      const z = firstZ - r * rowStep
      if (z - bdef.depth / 2 < -length / 2 + 3.5) break // keep the door end free
      for (let i = 0; i < perRow; i++) {
        const x = -totalW / 2 + bdef.width / 2 + i * (bdef.width + aisle)
        put('collegeBench', [{ x, z, rotation: 0 }], { tier: r < 1 ? 1 : r < 3 ? 2 : 3, silent: true })
      }
    }

    put('noticeBoard', wc('noticeBoard', [['front', 'max'], ['front', 'min'], ['left', 'min']]), { tier: 2 })
    put('windowAc', windowSlots(), { tier: 2, silent: true })
    put('windowAc', windowSlots(), { tier: 3, silent: true })
    put('plant', wc('plant', [['back', 'max'], ['back', 'min'], ['front', 'max']]), { tier: 3, styles: ['cozy'] })
  }

  // ═══════════════════════════════════════════════════
  // COMPUTER LAB — long PC desks along the walls with a chair at every seat
  // ═══════════════════════════════════════════════════
  else if (roomType === 'computer-lab') {
    const addChairs = (row, tier) => {
      const seats = Math.max(1, Math.round(row.width / 2.6))
      const sw = row.width / seats
      const cs = Math.cos(row.rotation)
      const sn = Math.sin(row.rotation)
      for (let i = 0; i < seats; i++) {
        const lx = -row.width / 2 + (i + 0.5) * sw
        const lz = row.depth / 2 + 0.95            // the user's side of the desk
        put('labChair', [{
          x: row.x + lx * cs + lz * sn,
          z: row.z - lx * sn + lz * cs,
          rotation: row.rotation + Math.PI,          // facing the monitor
        }], { tier, silent: true })
      }
    }
    const row = (specs, tier, core = false) => {
      const r = put('pcRow', wc('pcRow', specs, 0.5), { tier, core })
      if (r) addChairs(r, tier)
      return r
    }

    row([['left', 'max'], ['left', 'min']], 1, true)
    row([['right', 'max'], ['right', 'min']], 1)
    put('whiteboard', wc('whiteboard', [['back', 'center']]), { tier: 1 })
    row([['back', 'min'], ['back', 'max']], 2)
    row([['left', 'center'], ['left', 'min']], 2)
    row([['right', 'center'], ['right', 'min']], 2)
    teacherSetup('front', [width / 3, -width / 3], 2)
    put('noticeBoard', wc('noticeBoard', [['front', 'min'], ['front', 'max']]), { tier: 2 })
    put('windowAc', windowSlots(), { tier: 2, silent: true })
    put('acUnit', wc('acUnit', [['back', 'min'], ['back', 'max'], ['front', 'center']]), { tier: 3 })
    put('shelfUnit', wc('shelfUnit', [['back', 'max'], ['back', 'min']]), { tier: 3 })
  }

  return {
    furniture: placed,
    openings,
    skipped,
    style,
  }
}

/** Kept for backwards compatibility: just the furniture list */
export const generateDefaultFurniture = (roomType, width, length, style) =>
  generateRoom({ roomType, width, length, style }).furniture

// -----------------------------------------------------
// ADD A PIECE BY HAND — always lands in free space
// -----------------------------------------------------

/**
 * Create a piece in the nearest free spot, or return null if there is no room.
 * Wall-mounted pieces take the first wall with a free stretch.
 */
export function createFurnitureInFreeSpot(type, furniture, openings, room, style) {
  const def = furnitureDefinitions[type]
  if (!def) return null

  if (def.wallMounted) {
    const ctx = { openings, furniture, room }
    for (const wall of ['left', 'right', 'front', 'back']) {
      const item = createWallFurniture(type, wall, 0, style)
      const pos = findFreeWallPosition(wall, item, ctx, 0)
      if (pos !== null) return { ...item, position: pos }
    }
    return null
  }

  const spots = []
  for (let x = -room.width / 2; x <= room.width / 2; x += 0.5) {
    for (let z = -room.length / 2; z <= room.length / 2; z += 0.5) {
      spots.push({ x, z, d: Math.hypot(x, z) })
    }
  }
  spots.sort((a, b) => a.d - b.d)

  // First pass keeps the door swing clear; second pass accepts anything that doesn't collide.
  for (const respectDoor of [true, false]) {
    for (const rotation of [0, Math.PI / 2]) {
      for (const s of spots) {
        const item = createFurniture(type, s.x, s.z, rotation, style)
        if (!isInsideRoom(item, room)) continue
        if (furniture.some((o) => itemsCollide(item, o, room))) continue
        if (respectDoor) {
          const box = getItemBox(item, room)
          const doors = openings.filter((o) => o.type === 'door')
          if (getKeepOutBoxes(doors, room, item.height).some((k) => boxesOverlap(box, k, 0))) continue
        }
        return item
      }
    }
  }
  return null
}