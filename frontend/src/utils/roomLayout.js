// src/utils/roomLayout.js
// Where connected rooms sit relative to the main room, and how they may be moved.
// Everything is in feet, x → right, z → down the 2D plan (front wall of the main room is at the top).
//
// A connected room has a FREE position (its `offset` = where its centre is). It is added next to the
// door you clicked "+" on, but afterwards it can be slid anywhere that doesn't overlap another room —
// like real houses where rooms are linked through other spaces rather than sharing a door.

import {
  WALL_HALF, clampAlong, clampOpeningPosition, getOpeningVerticalRange, isWallMounted, isWindowMounted,
} from './layout'

/** Min distance between two rooms' wall centre-lines (just enough that their walls never overlap) */
export const ROOM_GAP = WALL_HALF * 2 + 0.1

const EPS = 1e-6
const OPPOSITE = { front: 'back', back: 'front', left: 'right', right: 'left' }

export const sizeOf = (design) => ({
  w: Number(design?.room_width)  || 10,
  l: Number(design?.room_length) || 12,
})

export const roomRect = (w, l, o = { x: 0, z: 0 }) => ({
  x0: o.x - w / 2, x1: o.x + w / 2, z0: o.z - l / 2, z1: o.z + l / 2,
})

/** Rectangles of the main room + every connected room (optionally skipping one) */
export function otherRects(main, connected, exceptUid = null) {
  return [
    roomRect(main.width, main.length),
    ...connected
      .filter((c) => c.uid !== exceptUid)
      .map((c) => { const s = sizeOf(c.design); return roomRect(s.w, s.l, c.offset) }),
  ]
}

const collide = (a, b, gap) =>
  a.x0 < b.x1 + gap - EPS && a.x1 > b.x0 - gap + EPS &&
  a.z0 < b.z1 + gap - EPS && a.z1 > b.z0 - gap + EPS

export const isFree = (size, pos, others, gap = ROOM_GAP) => {
  const r = roomRect(size.w, size.l, pos)
  return !others.some((o) => collide(r, o, gap))
}

/**
 * Move a room towards `to` without overlapping others. If the straight move is blocked it tries
 * sliding along one axis, otherwise it stays at `from`.
 */
export function resolveRoomMove({ size, from, to, others, gap = ROOM_GAP }) {
  if (isFree(size, to, others, gap)) return to
  const slideX = { x: to.x, z: from.z }
  if (isFree(size, slideX, others, gap)) return slideX
  const slideZ = { x: from.x, z: to.z }
  if (isFree(size, slideZ, others, gap)) return slideZ
  return from
}

/** Nearest free spot to `desired` (used when a new room is attached and its first spot is taken) */
export function findFreeSpot({ size, desired, others, gap = ROOM_GAP }) {
  if (isFree(size, desired, others, gap)) return desired
  for (let r = 0.5; r <= 80; r += 0.5) {
    let best = null
    let bestD = Infinity
    const consider = (x, z) => {
      const p = { x, z }
      if (!isFree(size, p, others, gap)) return
      const d = Math.hypot(x - desired.x, z - desired.z)
      if (d < bestD) { best = p; bestD = d }
    }
    for (let t = -r; t <= r; t += 0.5) {
      consider(desired.x + t, desired.z - r)
      consider(desired.x + t, desired.z + r)
      consider(desired.x - r, desired.z + t)
      consider(desired.x + r, desired.z + t)
    }
    if (best) return best
  }
  return desired
}

/** Where a new room goes: flush against the main room, on the side of the door you clicked */
export function defaultOffset(door, main, size) {
  const mw = main.width / 2
  const ml = main.length / 2
  const cw = size.w / 2
  const cl = size.l / 2
  const pos = Number(door?.position) || 0
  switch (door?.wall) {
    case 'front': return { x: pos, z: -(ml + cl + ROOM_GAP) }
    case 'back':  return { x: pos, z:  (ml + cl + ROOM_GAP) }
    case 'left':  return { x: -(mw + cw + ROOM_GAP), z: pos }
    case 'right': return { x:  (mw + cw + ROOM_GAP), z: pos }
    default:      return { x: 0, z: ml + cl + ROOM_GAP }
  }
}

/** Is a whole group of rectangles (positions relative to an anchor) free when its anchor is at `pos`? */
export const isFreeRects = (rels, pos, others, gap = ROOM_GAP) =>
  rels.every((r) => {
    const moved = { x0: r.x0 + pos.x, x1: r.x1 + pos.x, z0: r.z0 + pos.z, z1: r.z1 + pos.z }
    return !others.some((o) => collide(moved, o, gap))
  })

/** Nearest free anchor position for a group of rooms (a saved design plus the rooms attached to it) */
export function findFreeSpotRects({ rels, desired, others, gap = ROOM_GAP }) {
  if (isFreeRects(rels, desired, others, gap)) return desired
  for (let r = 0.5; r <= 120; r += 0.5) {
    let best = null
    let bestD = Infinity
    const consider = (x, z) => {
      const p = { x, z }
      if (!isFreeRects(rels, p, others, gap)) return
      const d = Math.hypot(x - desired.x, z - desired.z)
      if (d < bestD) { best = p; bestD = d }
    }
    for (let t = -r; t <= r; t += 0.5) {
      consider(desired.x + t, desired.z - r)
      consider(desired.x + t, desired.z + r)
      consider(desired.x - r, desired.z + t)
      consider(desired.x + r, desired.z + t)
    }
    if (best) return best
  }
  return desired
}

/**
 * The opening that a door OR window (in room A) needs in room B's wall so you can walk / see through both ways.
 * A and B are { size: { w, l }, offset: { x, z } } in plan coordinates. Only exists while the two rooms
 * are right next to each other on that side and the door falls inside B's wall.
 */
export function doorwayBetween(door, A, B) {
  const dw = Number(door.width) || 3
  const pos = Number(door.position) || 0
  const reach = ROOM_GAP + 0.5
  let dist, along, span
  switch (door.wall) {
    case 'front': dist = (A.offset.z - A.size.l / 2) - (B.offset.z + B.size.l / 2); along = A.offset.x + pos - B.offset.x; span = B.size.w; break
    case 'back':  dist = (B.offset.z - B.size.l / 2) - (A.offset.z + A.size.l / 2); along = A.offset.x + pos - B.offset.x; span = B.size.w; break
    case 'left':  dist = (A.offset.x - A.size.w / 2) - (B.offset.x + B.size.w / 2); along = A.offset.z + pos - B.offset.z; span = B.size.l; break
    case 'right': dist = (B.offset.x - B.size.w / 2) - (A.offset.x + A.size.w / 2); along = A.offset.z + pos - B.offset.z; span = B.size.l; break
    default: return null
  }
  if (dist < -0.05 || dist > reach) return null                  // the rooms don't touch on this side
  if (Math.abs(along) + dw / 2 > span / 2 - 0.3) return null     // door isn't inside B's wall
  const isWindow = door.type === 'window'
  return {
    type: isWindow ? 'window' : 'door', virtual: true, visible: true,
    wall: OPPOSITE[door.wall], position: along, width: dw,
    height: Number(door.height) || (isWindow ? 4 : 6.8),
    offset: isWindow ? (Number(door.offset) || 3) : 0,
  }
}

/**
 * Doorways for every room, from every door of every other room.
 * rooms: [{ uid ('main' for the main room), size, offset, openings }] → { [uid]: [opening, …] }
 */
export function computeLinks(rooms) {
  const out = {}
  rooms.forEach((A) => {
    ;(A.openings || []).forEach((door) => {
      rooms.forEach((B) => {
        if (B === A) return
        const link = doorwayBetween(door, A, B)
        if (link) (out[B.uid] = out[B.uid] || []).push({ ...link, id: `__link-${A.uid}-${door.id}` })
      })
    })
  })
  return out
}

/**
 * Same rules as layout.js `isOpeningBlocked`, but says WHAT is in the way (or null if nothing is).
 * Used to tell the user why a door/window stopped while being dragged along a wall.
 */
export function openingBlockReason(opening, ctx) {
  const { openings = [], furniture = [], room } = ctx
  const w = Number(opening.width) || 3
  const range = [clampOpeningPosition(opening, room) - w / 2, clampOpeningPosition(opening, room) + w / 2]
  const [b, t] = getOpeningVerticalRange(opening)
  const hit = (a, z, margin) => a[0] < z[1] + margin && z[0] < a[1] + margin

  for (const o of openings) {
    if (o.id === opening.id || o.wall !== opening.wall) continue
    const ow = Number(o.width) || 3
    const op = clampOpeningPosition(o, room)
    if (hit(range, [op - ow / 2, op + ow / 2], 0.3)) return `a ${o.type === 'window' ? 'window' : 'door'} on this wall`
  }
  for (const f of furniture) {
    if (!isWallMounted(f) || f.wall !== opening.wall) continue
    if (opening.type === 'window' && isWindowMounted(f)) continue
    const fb = Number(f.elevation) || 0
    const ft = fb + (Number(f.height) || 1)
    const fw = Number(f.width) || 1
    const fr = clampAlong(f.wall, f.position, fw, room)
    if (hit(range, [fr - fw / 2, fr + fw / 2], 0.1) && b < ft && fb < t) return f.name ? `“${f.name}” on this wall` : 'a wall-mounted item'
  }
  return null
}

// ─── Turning a room a quarter turn ──────────────────────────────────
//
// Rooms stay axis-aligned rectangles (placing, docking and overlap checks all
// rely on it), so a room turns in quarter turns: clockwise on the 2D plan.
// Everything in it turns with it. With x → right and z → down the plan, a
// point (x, z) goes to (−z, x); walls go front → right → back → left → front.
// Positions along a wall run along x on front/back and z on left/right, so
// they keep their sign from front and back and flip from right and left.

const TURN_WALL = { front: 'right', right: 'back', back: 'left', left: 'front' }
const FLIPS = { front: false, right: true, back: false, left: true }

const normAngle = (a) => {
  let r = a % (Math.PI * 2)
  if (r > Math.PI) r -= Math.PI * 2
  if (r <= -Math.PI) r += Math.PI * 2
  return Math.round(r * 10000) / 10000
}

const turnOnWall = (wall, position) => ({
  wall: TURN_WALL[wall] ?? wall,
  position: (FLIPS[wall] ? -1 : 1) * (Number(position) || 0),
})

/** The same room turned 90° clockwise on the plan, contents included. */
export function rotateDesignQuarter(design) {
  const w = Number(design.room_width) || 10
  const l = Number(design.room_length) || 12
  const walls = design.wall_colors || {}
  const wall_colors = {}
  for (const [k, v] of Object.entries(walls)) wall_colors[TURN_WALL[k] ?? k] = v
  return {
    ...design,
    room_width: l,
    room_length: w,
    wall_colors,
    furniture: (design.furniture || []).map((f) => (isWallMounted(f)
      ? { ...f, ...turnOnWall(f.wall, f.position) }
      : { ...f, x: -(Number(f.z) || 0), z: Number(f.x) || 0, rotation: normAngle((Number(f.rotation) || 0) - Math.PI / 2) })),
    openings: (design.openings || []).map((o) => ({ ...o, ...turnOnWall(o.wall, o.position) })),
  }
}
