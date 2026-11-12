// src/utils/promptRoom.js
// From a typed description to a furnished room.
//
// The AI (backend /api/assistant) only turns the user's words into a SPEC:
// room type and size, style, floor, wall colours, and a list of pieces with
// HINTS ("against the left wall", "in a corner", "near the desk"). It never
// gives coordinates: language models are bad at them. This file places every
// piece itself, with the app's own rules (utils/layout.js): inside the walls,
// no overlaps, the door swing kept clear. Anything the spec leaves out gets a
// sensible default, and each default is listed in `notes.assumptions` so the
// user can see what was assumed.

import {
  furnitureDefinitions, createFurniture, createWallFurniture, generateDefaultOpenings,
  generateRoom, rotationToFace, stylePresets, floorPresets, ROOM_TYPES, wallPaints,
} from '../data/roomPresets'
import {
  getHalfExtents, isInsideRoom, itemsCollide, getItemBox, getKeepOutBoxes, boxesOverlap,
  isWallItemBlocked, isOpeningBlocked, getWallLength, clampAlong, WALL_CLEARANCE, isWallMounted,
  clampFloorPosition, clampOpeningPosition,
} from './layout'
import sizePresetsFile from '../roomscan/data/size_presets.json'

export const WALLS = ['front', 'back', 'left', 'right']
export const SPOTS = ['start', 'center', 'end', 'corner', 'any']
const SIZE_PRESETS = sizePresetsFile.presets

/** Typical sizes (ft) when the user gives none */
export const DEFAULT_SIZES = {
  bedroom: [12, 14], 'living-room': [14, 18], study: [10, 12], dining: [12, 14], kitchen: [10, 12],
  bathroom: [6, 8], 'kids-room': [11, 12], entrance: [6, 8], balcony: [5, 10], utility: [6, 8],
  pooja: [5, 6], gym: [12, 14], classroom: [20, 24], 'computer-lab': [20, 24],
}
const MIN_SIDE = 6, MAX_SIDE = 60, MIN_H = 8, MAX_H = 15
const AISLE = 0.25          // ft between pieces placed from a prompt: room to walk
const INWARD = { back: { x: 0, z: -1 }, front: { x: 0, z: 1 }, left: { x: 1, z: 0 }, right: { x: -1, z: 0 } }
const HEX = /^#[0-9a-f]{6}$/i

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const isHoriz = (wall) => wall === 'front' || wall === 'back'
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)
let uid = 0
const freshId = (type) => `${type}-ai-${Date.now().toString(36)}-${(uid++).toString(36)}`

/** Everything the AI is allowed to choose from, sent with every request */
export function assistantCatalog() {
  return {
    room_types: ROOM_TYPES.map((r) => ({ id: r.id, name: r.name })),
    styles: Object.entries(stylePresets).map(([id, s]) => ({ id, name: s.name, description: s.description })),
    floors: floorPresets.map((f) => ({ id: f.id, name: f.name })),
    paints: wallPaints.map((p) => ({ name: p.name, color: p.color })),
    furniture: Object.entries(furnitureDefinitions).map(([id, d]) => ({
      id, name: d.name, category: d.category, wall_mounted: Boolean(d.wallMounted),
      sizes: (SIZE_PRESETS[id] || []).map((p) => p.name),
    })),
  }
}

/** A piece of `type`, in a size preset if one matches `size` ("Queen", "3-door"…) */
function makePiece(type, size, style) {
  const def = furnitureDefinitions[type]
  const item = def.wallMounted ? createWallFurniture(type, 'back', 0, style) : createFurniture(type, 0, 0, 0, style)
  item.id = freshId(type)
  const preset = size && (SIZE_PRESETS[type] || []).find((p) => p.name.toLowerCase() === String(size).toLowerCase())
  if (preset) {
    item.width = preset.width
    item.depth = preset.depth
    if (preset.height) item.height = preset.height
    item.name = `${def.name} (${preset.name})`
    item.modelScale = [item.width / def.width, item.height / def.height, item.depth / def.depth]
  }
  return item
}

/** Where a wall `spot` starts, along that wall (ft from its centre) */
function spotAlong(spot, wall, room, pieceHalf) {
  const half = getWallLength(wall, room) / 2
  if (spot === 'start' || spot === 'corner') return -half + pieceHalf
  if (spot === 'end') return half - pieceHalf
  return 0
}

/** A floor piece pushed flush against `wall` at `along`, facing into the room */
function onWall(item, wall, along, room) {
  const rotation = rotationToFace(item.type, INWARD[wall])
  const { hw, hd } = getHalfExtents(item.width, item.depth, rotation)
  const lim = Math.max(0, getWallLength(wall, room) / 2 - WALL_CLEARANCE - (isHoriz(wall) ? hw : hd))
  const a = clamp(along, -lim, lim)
  const W = room.width / 2, L = room.length / 2
  switch (wall) {
    case 'back':  return { ...item, x: a, z: L - WALL_CLEARANCE - hd, rotation }
    case 'front': return { ...item, x: a, z: -L + WALL_CLEARANCE + hd, rotation }
    case 'left':  return { ...item, x: -W + WALL_CLEARANCE + hw, z: a, rotation }
    default:      return { ...item, x: W - WALL_CLEARANCE - hw, z: a, rotation }
  }
}

/** Positions along a wall: from `start`, then further and further out both ways */
function* alongWall(wall, start, room, step = 0.25) {
  const len = getWallLength(wall, room)
  yield start
  for (let k = 1; k * step <= len; k++) { yield start + k * step; yield start - k * step }
}

/** Open-floor positions around (cx, cz), nearest first */
function aroundPoint(cx, cz, radius, step = 0.5) {
  const out = []
  for (let dx = -radius; dx <= radius + 1e-9; dx += step) {
    for (let dz = -radius; dz <= radius + 1e-9; dz += step) out.push({ x: cx + dx, z: cz + dz, d: Math.hypot(dx, dz) })
  }
  return out.sort((a, b) => a.d - b.d)
}

/**
 * Place ONE requested piece among those already placed.
 * @param want {type, size, wall: front|back|left|right|any, spot: start|center|end|corner|any, near: type|null}
 * @param ctx  {room: {width, length}, openings, placed: [], style, meta: Map(id -> {wall})}
 * @returns the placed item, or null if there is no space
 */
export function placePiece(want, ctx) {
  const def = furnitureDefinitions[want.type]
  if (!def) return null
  const { room, openings, placed, style } = ctx
  const base = makePiece(want.type, want.size, style)
  const walls = WALLS.includes(want.wall) ? [want.wall, ...WALLS.filter((w) => w !== want.wall)] : ['back', 'left', 'right', 'front']
  const spot = SPOTS.includes(want.spot) ? want.spot : 'any'

  if (def.wallMounted) {
    const wctx = { openings, furniture: placed, room }
    for (const wall of walls) {
      const start = spotAlong(spot, wall, room, base.width / 2)
      for (const a of alongWall(wall, start, room)) {
        const item = { ...base, wall, position: clampAlong(wall, a, base.width, room) }
        if (!isWallItemBlocked(item, wctx)) return item
      }
    }
    return null
  }

  const fits = (item, gap = AISLE) => {
    if (!isInsideRoom(item, room)) return false
    if (placed.some((o) => itemsCollide(item, o, room, gap))) return false
    const box = getItemBox(item, room)
    return !getKeepOutBoxes(openings, room, item.height).some((k) => boxesOverlap(box, k, 0))
  }

  // near another piece: beside it on its wall, else in the open floor next to it, facing it
  const target = want.near ? [...placed].reverse().find((p) => p.type === want.near) : null
  if (target) {
    const tWall = ctx.meta?.get(target.id)?.wall
    if (tWall && !isWallMounted(target)) {
      const tAlong = isHoriz(tWall) ? target.x : target.z
      const tHalf = (isHoriz(tWall) ? getHalfExtents(target.width, target.depth, target.rotation).hw : getHalfExtents(target.width, target.depth, target.rotation).hd)
      for (const side of [1, -1]) {
        const probe = onWall(base, tWall, 0, room)
        const half = isHoriz(tWall) ? getHalfExtents(probe.width, probe.depth, probe.rotation).hw : getHalfExtents(probe.width, probe.depth, probe.rotation).hd
        const item = onWall(base, tWall, tAlong + side * (tHalf + half + AISLE + 0.05), room)
        if (fits(item)) return { item, wall: tWall }
      }
    }
    for (const p of aroundPoint(target.x, target.z, 5)) {
      const dx = target.x - p.x, dz = target.z - p.z
      const dir = Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) || 1 }
      const item = { ...base, x: p.x, z: p.z, rotation: rotationToFace(base.type, dir) }
      if (fits(item, 0.15)) return { item, wall: null }
    }
  }

  // the middle of the room (coffee table, dining table, rug-like pieces)
  if (spot === 'center' && !WALLS.includes(want.wall)) {
    for (const p of aroundPoint(0, 0, Math.max(room.width, room.length) / 2)) {
      const item = { ...base, x: p.x, z: p.z, rotation: 0 }
      if (fits(item)) return { item, wall: null }
    }
  }

  // against a wall, from the requested spot outwards; the asked-for wall first.
  // First with room to walk between pieces; in a cramped room, then tighter.
  for (const gap of [AISLE, 0.05]) {
    for (const wall of walls) {
      const probe = onWall(base, wall, 0, room)
      const half = isHoriz(wall) ? getHalfExtents(probe.width, probe.depth, probe.rotation).hw : getHalfExtents(probe.width, probe.depth, probe.rotation).hd
      for (const a of alongWall(wall, spotAlong(spot, wall, room, half), room)) {
        const item = onWall(base, wall, a, room)
        if (fits(item, gap)) return { item, wall }
      }
    }
  }

  // anywhere left on the floor
  for (const p of aroundPoint(0, 0, Math.max(room.width, room.length) / 2)) {
    for (const rotation of [0, Math.PI / 2]) {
      const item = { ...base, x: p.x, z: p.z, rotation }
      if (fits(item, 0.1)) return { item, wall: null }
    }
  }
  return null
}

/**
 * A window on its own wall if free, else another: clear of other openings and
 * wall pieces (the app's isOpeningBlocked) and of tall floor pieces standing
 * in front of it (the app's keep-out strip, the other way round).
 */
function placeWindow(win, { room, openings, furniture }) {
  const tallInFront = (w) => furniture.some((f) => !isWallMounted(f) &&
    getKeepOutBoxes([w], room, f.height).some((k) => boxesOverlap(getItemBox(f, room), k, 0)))
  for (const wall of [win.wall, ...WALLS.filter((x) => x !== win.wall && x !== 'front'), 'front']) {
    const half = Math.max(0, getWallLength(wall, room) / 2 - win.width / 2 - 0.5)
    const starts = [win.wall === wall ? win.position : 0]
    for (let k = 0.5; k <= half; k += 0.5) starts.push(k, -k)
    for (const position of starts) {
      if (Math.abs(position) > half) continue
      const w = { ...win, wall, position }
      if (!isOpeningBlocked(w, { openings, furniture, room }) && !tallInFront(w)) return w
    }
  }
  return null
}

/** Doors and windows from the spec ({type, wall, spot}), or the room type's defaults */
function openingsFrom(spec, roomType, room) {
  const list = Array.isArray(spec.openings) ? spec.openings.filter((o) => ['door', 'window'].includes(o?.type) && WALLS.includes(o?.wall)) : []
  if (list.length === 0) return { openings: generateDefaultOpenings(roomType, room.width, room.length), assumed: true }
  const openings = list.slice(0, 10).map((o, i) => {
    const door = o.type === 'door'
    const width = door ? 3 : 4
    const half = getWallLength(o.wall, room) / 2
    const position = o.spot === 'start' ? -half + width / 2 + 1 : o.spot === 'end' ? half - width / 2 - 1 : 0
    return door
      ? { id: `door-ai-${i}`, type: 'door', wall: o.wall, position, width, height: 6.8, offset: 0 }
      : { id: `window-ai-${i}`, type: 'window', wall: o.wall, position, width, height: 4, offset: 3.5 }
  })
  return { openings, assumed: false }
}

/**
 * A whole room from a spec.
 * @param spec from POST /api/assistant/plan (already checked by the backend)
 * @param base an existing room to furnish instead ({room_width, room_length, wall_height, openings}):
 *   its size and doors/windows are kept (a scanned room keeps its real ones)
 * @returns a design for POST /api/designs, plus `notes` {assumptions, skipped}
 */
export function buildRoomFromSpec(spec, base = null) {
  const assumptions = [...(Array.isArray(spec.assumptions) ? spec.assumptions : [])]
  const roomType = ROOM_TYPES.some((r) => r.id === spec.room_type) ? spec.room_type : 'bedroom'
  if (!spec.room_type && !base) assumptions.push('Room type not given: made it a bedroom.')

  let width, length
  if (base) {
    width = Number(base.room_width) || 12
    length = Number(base.room_length) || 14
  } else {
    const [dw, dl] = DEFAULT_SIZES[roomType] || [12, 14]
    width = num(spec.width_ft) ?? dw
    length = num(spec.length_ft) ?? dl
    if (num(spec.width_ft) === null || num(spec.length_ft) === null) {
      assumptions.push(`Room size not given: used ${width} × ${length} ft, a typical ${roomType.replace('-', ' ')}.`)
    }
    width = clamp(width, MIN_SIDE, MAX_SIDE)
    length = clamp(length, MIN_SIDE, MAX_SIDE)
  }
  const room = { width, length }
  const wallHeight = clamp(num(spec.height_ft) ?? num(base?.wall_height) ?? 8, MIN_H, MAX_H)

  const style = stylePresets[spec.style] ? spec.style : 'modern'
  const floor = floorPresets.some((f) => f.id === spec.floor_type) ? spec.floor_type : stylePresets[style].floor
  const all = HEX.test(spec.wall_color_all || '') ? spec.wall_color_all : stylePresets[style].wall
  const wallColors = Object.fromEntries(WALLS.map((w) => [w, HEX.test(spec.wall_colors?.[w] || '') ? spec.wall_colors[w] : all]))

  let openings
  let laterWindows = []   // default windows, added after the furniture the user asked for
  if (base) openings = Array.isArray(base.openings) ? base.openings : []
  else {
    const o = openingsFrom(spec, roomType, room)
    openings = o.openings
    if (o.assumed) {
      // Windows the user never mentioned must not push their furniture off the
      // wall they asked for (the app keeps tall pieces away from windows): the
      // door goes in now, the windows afterwards wherever a wall is free.
      laterWindows = openings.filter((w) => w.type === 'window')
      openings = openings.filter((w) => w.type !== 'window')
      assumptions.push('No doors or windows given: one door on the front wall, windows where the walls are free.')
    }
  }

  // the pieces asked for, biggest first so they get the best spots
  const wants = []
  for (const f of Array.isArray(spec.furniture) ? spec.furniture : []) {
    if (!furnitureDefinitions[f?.type]) continue
    const count = clamp(Math.round(num(f.count) ?? 1), 1, 8)
    for (let i = 0; i < count && wants.length < 40; i++) wants.push(f)
  }
  const area = (t) => (furnitureDefinitions[t].wallMounted ? -1 : furnitureDefinitions[t].width * furnitureDefinitions[t].depth)
  // pieces placed "near" another come after it
  wants.sort((a, b) => (a.near ? 1 : 0) - (b.near ? 1 : 0) || area(b.type) - area(a.type))

  let furniture = []
  const skipped = []
  if (wants.length === 0) {
    // nothing listed: furnish it the way "Generate room" would
    furniture = generateRoom({ roomType, width, length, style }).furniture.map((f) => ({ ...f, id: freshId(f.type) }))
    // keep generated pieces clear of a base room's own doors and windows
    if (base) {
      furniture = furniture.filter((f) => isWallMounted(f)
        ? !isWallItemBlocked(f, { openings, furniture: [], room })
        : !getKeepOutBoxes(openings, room, f.height).some((k) => boxesOverlap(getItemBox(f, room), k, 0)))
    }
    assumptions.push(`No furniture listed: furnished it as a ${stylePresets[style].name.toLowerCase()} ${roomType.replace('-', ' ')}.`)
  } else {
    const meta = new Map()
    for (const want of wants) {
      const r = placePiece(want, { room, openings, placed: furniture, style, meta })
      if (!r) { skipped.push(furnitureDefinitions[want.type].name); continue }
      const item = r.item ?? r
      furniture.push(item)
      meta.set(item.id, { wall: r.wall ?? item.wall ?? null })
    }
  }

  for (const win of laterWindows) {
    const spot = placeWindow(win, { room, openings, furniture })
    if (spot) openings = [...openings, spot]
  }

  return {
    room_type: roomType,
    room_width: width,
    room_length: length,
    wall_height: wallHeight,
    style,
    floor_type: floor,
    wall_colors: wallColors,
    furniture,
    openings,
    notes: { assumptions, skipped },
  }
}

/** Add one piece to an existing room; null when there is no space */
export function addPieceToRoom(want, { room, openings, furniture, style }) {
  const r = placePiece(want, { room, openings, placed: furniture, style, meta: new Map() })
  return r ? (r.item ?? r) : null
}

// ── doors, windows and room size, for the assistant ───────────

/** Standard sizes, the same as the editor's own "Add door" / "Add window" */
export const OPENING_SIZES = {
  door: { width: 3, height: 6.8, offset: 0 },
  window: { width: 4, height: 4, offset: 3.5 },
}

/**
 * A new door or window on a wall: clear of other openings and wall pieces
 * (isOpeningBlocked), a door's swing clear of floor furniture, a window not
 * behind a tall piece (the app's keep-out strip).
 * @param want {opening_type: door|window, wall: front|back|left|right|any, spot: start|center|end|any}
 * @returns {ok: true, opening} | {ok: false, message}
 */
export function placeOpeningForAi(want, { room, openings = [], furniture = [] }) {
  const type = want?.opening_type === 'window' ? 'window' : want?.opening_type === 'door' ? 'door' : null
  if (!type) return { ok: false, message: 'Only doors and windows can be added.' }
  const size = OPENING_SIZES[type]
  const asked = WALLS.includes(want.wall) ? want.wall : null
  const walls = asked ? [asked] : type === 'door' ? ['front', 'left', 'right', 'back'] : ['back', 'left', 'right', 'front']
  const floor = furniture.filter((f) => !isWallMounted(f))
  const clearInside = (o) => {
    const keep = getKeepOutBoxes([o], room, type === 'door' ? 0 : 100)
    return !floor.some((f) => (type === 'door' || f.height > o.offset - 0.3) &&
      keep.some((k) => boxesOverlap(getItemBox(f, room), k, 0)))
  }
  const id = freshId(type)
  for (const wall of walls) {
    const half = getWallLength(wall, room) / 2 - size.width / 2 - 0.3   // keep the frame off the corner
    if (half < 0) continue
    const spot = want.spot
    const start = spot === 'start' ? -half : spot === 'end' ? half : 0
    for (let k = 0; k <= 4 * half / 0.25 + 2; k++) {   // outwards both ways; from an end that is the whole wall
      const step = Math.ceil(k / 2) * 0.25 * (k % 2 ? 1 : -1)
      const position = start + step
      if (Math.abs(position) > half + 1e-9) continue
      const o = { id, type, wall, position: Math.round(position * 100) / 100, ...size, visible: true }
      if (!isOpeningBlocked(o, { openings, furniture, room }) && clearInside(o)) return { ok: true, opening: o }
    }
  }
  return { ok: false, message: `No free space ${asked ? `on the ${asked} wall` : 'on any wall'} for a ${type}.` }
}

/**
 * Everything in a room after it is resized to width × length (ft): floor
 * pieces stay against the walls they stood against and are pulled back inside,
 * wall pieces and openings stay on their walls. Nothing is dropped: if a
 * piece cannot fit, the resize is refused.
 * @returns {ok: true, furniture, openings, overlaps} | {ok: false, message}
 */
export function resizeRoomContents({ width, length }, { room: old, furniture = [], openings = [] }) {
  const w = Number(width), l = Number(length)
  if (!(w >= MIN_SIDE && w <= MAX_SIDE && l >= MIN_SIDE && l <= MAX_SIDE)) {
    return { ok: false, message: `Width and length must be between ${MIN_SIDE} and ${MAX_SIDE} ft.` }
  }
  const room = { width: w, length: l }
  const nextFurniture = []
  for (const f of furniture) {
    if (isWallMounted(f)) {
      if ((Number(f.width) || 1) > getWallLength(f.wall, room) - 0.5) return { ok: false, message: `“${f.name}” is wider than the new ${f.wall} wall.` }
      nextFurniture.push({ ...f, position: clampAlong(f.wall, f.position, Number(f.width) || 1, room) })
      continue
    }
    const rot = Number(f.rotation) || 0
    const { hw, hd } = getHalfExtents(Number(f.width) || 1, Number(f.depth) || 1, rot)
    let x = Number(f.x) || 0, z = Number(f.z) || 0
    if (old) {
      // against a wall before -> against the same wall after
      if (Math.abs(x) >= old.width / 2 - WALL_CLEARANCE - hw - 0.3) x = Math.sign(x) * (w / 2 - WALL_CLEARANCE - hw)
      if (Math.abs(z) >= old.length / 2 - WALL_CLEARANCE - hd - 0.3) z = Math.sign(z) * (l / 2 - WALL_CLEARANCE - hd)
    }
    const p = clampFloorPosition(f, x, z, rot, room)
    const moved = { ...f, x: p.x, z: p.z }
    if (!isInsideRoom(moved, room)) return { ok: false, message: `“${f.name}” doesn't fit in a ${w} × ${l} ft room.` }
    nextFurniture.push(moved)
  }
  const nextOpenings = []
  for (const o of openings) {
    if ((Number(o.width) || 3) > getWallLength(o.wall, room)) return { ok: false, message: `A ${o.type} is wider than the new ${o.wall} wall.` }
    nextOpenings.push({ ...o, position: clampOpeningPosition(o, room) })
  }
  const floor = nextFurniture.filter((f) => !isWallMounted(f))
  let overlaps = 0
  floor.forEach((a, i) => floor.slice(i + 1).forEach((b) => { if (itemsCollide(a, b, room)) overlaps++ }))
  return { ok: true, furniture: nextFurniture, openings: nextOpenings, overlaps }
}

/** A compact description of the open room, for the assistant */
export function summariseRoom({ roomType, width, length, height, style, floorType, wallColors, furniture, openings, linkedDoorIds = [], connectedRooms = 0 }) {
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const linked = new Set(linkedDoorIds)
  return {
    room_type: roomType || null,
    width_ft: r2(width), length_ft: r2(length), height_ft: r2(height),
    style: style || null, floor_type: floorType || null,
    wall_colors: wallColors || {},
    connected_rooms: connectedRooms,
    openings: (openings || []).map((o) => ({
      id: o.id, type: o.type, wall: o.wall, position: r2(o.position), width: r2(o.width),
      ...(linked.has(o.id) ? { leads_to_connected_room: true } : {}),
    })),
    furniture: (furniture || []).slice(0, 60).map((f) => (f.wallMounted
      ? { id: f.id, type: f.type, name: f.name, wall: f.wall, position: r2(f.position) }
      : { id: f.id, type: f.type, name: f.name, x: r2(f.x), z: r2(f.z), width: r2(f.width), depth: r2(f.depth) })),
  }
}
