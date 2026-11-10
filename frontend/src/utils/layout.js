// src/utils/layout.js
// Shared geometry + collision rules used by the generator (roomPresets.js)
// and the 3D viewer (RoomViewer.jsx). Pure functions, no React / three.

export const WALL_HALF      = 0.125  // half of wall thickness (walls are 0.25 thick)
export const WALL_CLEARANCE = 0.13   // wall centre-line -> furniture edge (flush with inner face)
export const COLLISION_GAP  = 0.05   // minimum gap between two pieces
const EPS = 0.01

export const WALLS = ['front', 'back', 'left', 'right']
export const isHorizontalWall = (wall) => wall === 'front' || wall === 'back'
export const getWallLength    = (wall, room) => (isHorizontalWall(wall) ? room.width : room.length)
export const isWallMounted    = (item) => Boolean(item && item.wallMounted)

/** Pieces that sit inside a window frame (window air-conditioners). They may only be placed in a window. */
export const WINDOW_MOUNTED = new Set(['windowAc'])
export const isWindowMounted = (item) => Boolean(item && WINDOW_MOUNTED.has(item.type))

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ─── Footprints ─────────────────────────────────────────────────────

/** Half-extents of a width x depth box after rotating by `rotation` about Y */
export function getHalfExtents(width, depth, rotation = 0) {
  const cos = Math.abs(Math.cos(rotation))
  const sin = Math.abs(Math.sin(rotation))
  return {
    hw: (width * cos + depth * sin) / 2,
    hd: (width * sin + depth * cos) / 2,
  }
}

/** Keep a wall-mounted item fully on the inner face of its wall */
export function clampAlong(wall, value, itemWidth, room) {
  const limit = Math.max(0, getWallLength(wall, room) / 2 - WALL_HALF - itemWidth / 2)
  return clamp(Number(value) || 0, -limit, limit)
}

/** World pose of any item. Wall-mounted items derive x/z/rotation from wall + position. */
export function getItemPose(item, room) {
  const y = Number(item.elevation) || 0

  if (isWallMounted(item)) {
    const w   = Number(item.width) || 1
    const d   = Number(item.depth) || 0.18
    const pos = clampAlong(item.wall, item.position, w, room)
    const off = WALL_HALF + d / 2 - 0.002 // back of the piece sits flush on the wall

    switch (item.wall) {
      case 'front': return { x: pos,                   z: -room.length / 2 + off, rotation: Math.PI,      y }
      case 'left':  return { x: -room.width / 2 + off, z: pos,                    rotation: -Math.PI / 2, y }
      case 'right': return { x: room.width / 2 - off,  z: pos,                    rotation: Math.PI / 2,  y }
      default:      return { x: pos,                   z: room.length / 2 - off,  rotation: 0,            y }
    }
  }

  return {
    x: Number(item.x) || 0,
    z: Number(item.z) || 0,
    rotation: Number(item.rotation) || 0,
    y,
  }
}

export function getItemBox(item, room) {
  const p = getItemPose(item, room)
  const { hw, hd } = getHalfExtents(Number(item.width) || 1, Number(item.depth) || 1, p.rotation)
  const h = Number(item.height) || 1
  return { minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd, minY: p.y, maxY: p.y + h }
}

/** 3D overlap. `gap` only applies on the floor plane (x/z). */
export function boxesOverlap(a, b, gap = 0) {
  return (
    a.minX < b.maxX + gap && b.minX < a.maxX + gap &&
    a.minZ < b.maxZ + gap && b.minZ < a.maxZ + gap &&
    a.minY < b.maxY - EPS && b.minY < a.maxY - EPS
  )
}

/**
 * Do two pieces collide? Works for floor furniture and wall-mounted pieces.
 * Vertical ranges are compared, so a painting above a sofa or a TV above a
 * low unit is fine, but a painting behind a wardrobe is not.
 */
export function itemsCollide(a, b, room, gap = COLLISION_GAP) {
  if (!a || !b) return false
  if (a.id !== undefined && a.id === b.id) return false
  return boxesOverlap(getItemBox(a, room), getItemBox(b, room), gap)
}

// ─── Openings (doors / windows) ─────────────────────────────────────

export function getOpeningVerticalRange(o) {
  const h = Number(o.height) || (o.type === 'door' ? 6.8 : 4)
  const bottom = o.type === 'door' ? 0 : Number(o.offset) || 3
  return [bottom, bottom + h]
}

/** Door swing: how far the leaf is open (degrees). 0 = closed, 90 = square to the wall. */
export const DOOR_MAX_ANGLE = 120
export function getDoorAngle(o) {
  const raw = o && o.openAngle
  const n = raw === undefined || raw === null || raw === '' ? 90 : Number(raw)
  return clamp(Number.isFinite(n) ? n : 90, 0, DOOR_MAX_ANGLE)
}

export function clampOpeningPosition(o, room) {
  const w = Number(o.width) || 3
  const limit = Math.max(0, getWallLength(o.wall, room) / 2 - w / 2)
  return clamp(Number(o.position) || 0, -limit, limit)
}

const alongRange    = (pos, width) => [pos - width / 2, pos + width / 2]
const rangesOverlap = (a, b, margin = 0) => a[0] < b[1] + margin && b[0] < a[1] + margin

/** Can a wall-mounted piece (painting, TV, mirror) sit here? */
export function isWallItemBlocked(item, ctx) {
  const { openings = [], furniture = [], room } = ctx
  const w = Number(item.width) || 1
  const candidate = { ...item, position: clampAlong(item.wall, item.position, w, room) }
  const range  = alongRange(candidate.position, w)
  const bottom = Number(item.elevation) || 0
  const top    = bottom + (Number(item.height) || 1)

  const windowMounted = isWindowMounted(item)
  let insideWindow = false

  for (const o of openings) {
    if (o.wall !== item.wall) continue
    const [ob, ot] = getOpeningVerticalRange(o)
    const oRange = alongRange(clampOpeningPosition(o, room), Number(o.width) || 3)

    if (windowMounted && o.type === 'window') {
      // a window AC must fit completely inside the frame
      if (range[0] >= oRange[0] - 0.01 && range[1] <= oRange[1] + 0.01 && bottom >= ob - 0.01 && top <= ot + 0.01) insideWindow = true
      continue
    }

    const margin = o.type === 'window' ? 0.2 : 0.1
    if (rangesOverlap(range, oRange, margin) && bottom < ot && ob < top) return true
  }

  if (windowMounted && !insideWindow) return true

  return furniture.some((f) => itemsCollide(candidate, f, room))
}

/** Can a door/window sit here? Never overlaps another opening or a wall-mounted piece. */
export function isOpeningBlocked(opening, ctx) {
  const { openings = [], furniture = [], room } = ctx
  const w = Number(opening.width) || 3
  const pos = clampOpeningPosition(opening, room)
  const range = alongRange(pos, w)
  const [b, t] = getOpeningVerticalRange(opening)

  for (const o of openings) {
    if (o.id === opening.id || o.wall !== opening.wall) continue
    const oRange = alongRange(clampOpeningPosition(o, room), Number(o.width) || 3)
    if (rangesOverlap(range, oRange, 0.3)) return true
  }

  for (const f of furniture) {
    if (!isWallMounted(f) || f.wall !== opening.wall) continue
    if (opening.type === 'window' && isWindowMounted(f)) continue // an AC belongs in the window
    const fb = Number(f.elevation) || 0
    const ft = fb + (Number(f.height) || 1)
    const fw = Number(f.width) || 1
    const fRange = alongRange(clampAlong(f.wall, f.position, fw, room), fw)
    if (rangesOverlap(range, fRange, 0.1) && b < ft && fb < t) return true
  }
  return false
}

// ─── Moving things ──────────────────────────────────────────────────

/**
 * Walk from `from` toward `to` in small steps and stop at the first blocked step.
 * Walking (instead of jumping) means fast mouse moves can never tunnel through a neighbour.
 */
export function sweepMove(from, to, isBlocked, step = 0.1) {
  const dist = to - from
  if (Math.abs(dist) < 1e-6) return from
  const n = Math.ceil(Math.abs(dist) / step)
  const s = dist / n
  let cur = from
  for (let i = 0; i < n; i++) {
    const next = cur + s
    if (isBlocked(next) && !isBlocked(cur)) break
    cur = next
  }
  return cur
}

export function resolveWallMove(item, from, to, ctx) {
  const w = Number(item.width) || 1
  return sweepMove(
    clampAlong(item.wall, from, w, ctx.room),
    clampAlong(item.wall, to, w, ctx.room),
    (p) => isWallItemBlocked({ ...item, position: p }, ctx),
  )
}

export function resolveOpeningMove(opening, from, to, ctx) {
  const limit = Math.max(0, getWallLength(opening.wall, ctx.room) / 2 - (Number(opening.width) || 3) / 2)
  return sweepMove(
    clamp(from, -limit, limit),
    clamp(to, -limit, limit),
    (p) => isOpeningBlocked({ ...opening, position: p }, ctx),
  )
}

/** Nearest free slot along a wall, or null */
function findFreePosition(limit, preferred, isBlocked, step = 0.25) {
  const tried = new Set()
  const max = Math.ceil((limit * 2) / step)
  for (let k = 0; k <= max; k++) {
    for (const sgn of k === 0 ? [0] : [1, -1]) {
      const pos = clamp(preferred + sgn * k * step, -limit, limit)
      const key = pos.toFixed(2)
      if (tried.has(key)) continue
      tried.add(key)
      if (!isBlocked(pos)) return pos
    }
  }
  return null
}

export function findFreeWallPosition(wall, item, ctx, preferred = 0) {
  const w = Number(item.width) || 1
  const limit = Math.max(0, getWallLength(wall, ctx.room) / 2 - WALL_HALF - w / 2)
  return findFreePosition(limit, preferred, (p) => isWallItemBlocked({ ...item, wall, position: p }, ctx))
}

export function findFreeOpeningPosition(wall, opening, ctx, preferred = 0) {
  const limit = Math.max(0, getWallLength(wall, ctx.room) / 2 - (Number(opening.width) || 3) / 2)
  return findFreePosition(limit, preferred, (p) => isOpeningBlocked({ ...opening, wall, position: p }, ctx))
}

// ─── Floor furniture ────────────────────────────────────────────────

export function clampFloorPosition(item, x, z, rotation, room) {
  const { hw, hd } = getHalfExtents(Number(item.width) || 1, Number(item.depth) || 1, rotation)
  const maxX = Math.max(0, room.width  / 2 - WALL_CLEARANCE - hw)
  const maxZ = Math.max(0, room.length / 2 - WALL_CLEARANCE - hd)
  return { x: clamp(x, -maxX, maxX), z: clamp(z, -maxZ, maxZ) }
}

/** Is the whole footprint inside the walls? */
export function isInsideRoom(item, room) {
  const { hw, hd } = getHalfExtents(Number(item.width) || 1, Number(item.depth) || 1, Number(item.rotation) || 0)
  return (
    Math.abs(Number(item.x) || 0) <= room.width  / 2 - WALL_CLEARANCE - hw + 1e-6 &&
    Math.abs(Number(item.z) || 0) <= room.length / 2 - WALL_CLEARANCE - hd + 1e-6
  )
}

/**
 * Move a floor item from `from` to `to`. It walks in small steps, and when a
 * step is blocked it slides along the free axis, so you glide along neighbours
 * and walls rather than getting stuck or jumping over them.
 */
export function resolveFloorMove(item, from, to, others, room, gap = COLLISION_GAP) {
  const rot = Number(item.rotation) || 0
  const blocked = (x, z) => others.some((o) => itemsCollide({ ...item, x, z }, o, room, gap))

  let cur = clampFloorPosition(item, from.x, from.z, rot, room)
  const tgt = clampFloorPosition(item, to.x, to.z, rot, room)

  const dx = tgt.x - cur.x
  const dz = tgt.z - cur.z
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2))
  const sx = dx / steps
  const sz = dz / steps

  for (let i = 0; i < steps; i++) {
    const curBad = blocked(cur.x, cur.z) // if it started inside something, let it escape
    if (curBad || !blocked(cur.x + sx, cur.z + sz)) { cur = { x: cur.x + sx, z: cur.z + sz }; continue }
    if (sx !== 0 && !blocked(cur.x + sx, cur.z)) { cur = { x: cur.x + sx, z: cur.z }; continue }
    if (sz !== 0 && !blocked(cur.x, cur.z + sz)) { cur = { x: cur.x, z: cur.z + sz } }
  }
  return cur
}

// ─── Door swing / window keep-out (generator only) ──────────────────

/** Rectangles that should stay clear of furniture: door swing, and the strip in front of windows for tall pieces */
export function getKeepOutBoxes(openings, room, itemHeight = 0) {
  const boxes = []
  for (const o of openings) {
    const [bottom] = getOpeningVerticalRange(o)
    const w = Number(o.width) || 3
    const pos = clampOpeningPosition(o, room)
    let depth
    const margin = 0.2

    if (o.type === 'door') {
      if (o.swing === 'out') continue // opens away from the room: no clearance needed inside
      depth = w + 0.3
    }
    else {
      if (itemHeight <= bottom - 0.3) continue // low enough to sit under the sill
      depth = 0.8
    }
    const a0 = pos - w / 2 - margin
    const a1 = pos + w / 2 + margin
    const base = { minY: 0, maxY: 100 }

    switch (o.wall) {
      case 'front': boxes.push({ ...base, minX: a0, maxX: a1, minZ: -room.length / 2, maxZ: -room.length / 2 + WALL_HALF + depth }); break
      case 'back':  boxes.push({ ...base, minX: a0, maxX: a1, minZ: room.length / 2 - WALL_HALF - depth, maxZ: room.length / 2 }); break
      case 'left':  boxes.push({ ...base, minZ: a0, maxZ: a1, minX: -room.width / 2, maxX: -room.width / 2 + WALL_HALF + depth }); break
      default:      boxes.push({ ...base, minZ: a0, maxZ: a1, minX: room.width / 2 - WALL_HALF - depth, maxX: room.width / 2 })
    }
  }
  return boxes
}