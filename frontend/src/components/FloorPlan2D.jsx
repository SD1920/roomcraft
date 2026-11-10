// src/components/FloorPlan2D.jsx
// Architectural 2D floor plan (top-down). Drawn in feet, so it lines up exactly
// with the 3D room and uses the same collision rules (utils/layout.js).
//
//   x → right, z → down the screen. Front (door) wall is at the top, like looking down on the 3D room.
//
// Interaction
//   · drag furniture / paintings / TV / mirror / doors / windows  (no overlaps, wall items stay on their wall)
//   · scroll or pinch to zoom toward the cursor — no limits that stop you seeing the whole room
//   · drag empty space to pan · double-click empty space (or ⌂) to fit the room
//   · click a "+" box outside a door → onAddRoom(door)
//   · connected rooms are full copies drawn at their own position — edit them exactly like the main room,
//     and drag the ✥ handle above one to move it anywhere that doesn't overlap another room

import { useEffect, useRef, useState } from 'react'
import { openingBlockReason, otherRects, resolveRoomMove, sizeOf } from '../utils/roomLayout'
import { ROOM_TYPES } from '../data/roomPresets'
import {
  WALL_HALF,
  isHorizontalWall,
  isWallMounted,
  getItemPose,
  getHalfExtents,
  clampAlong,
  clampOpeningPosition,
  getDoorAngle,
  resolveFloorMove,
  resolveWallMove,
  resolveOpeningMove,
} from '../utils/layout'

// ─── Look ─────────────────────────────────────────────────────────────────────

const WALL_THICKNESS = 0.5          // drawn thickness; the inner face stays where the 3D wall's inner face is
const WALL_FILL      = '#6f6f6f'
const LINE           = '#4b5563'    // furniture outlines
const PAPER          = '#ffffff'
const ACCENT         = '#f4a261'

// Soft room colours, like a standard floor plan
const ROOM_FLOOR = {
  bedroom:       '#fff3a6',
  'living-room': '#ece4d3',
  study:         '#dbe9cc',
  dining:        '#f5ddc8',
  kitchen:       '#eadfc8',
  bathroom:      '#a7d8ee',
  'kids-room':   '#ffd9e6',
  entrance:      '#d9c3a5',
  balcony:       '#b9c4a6',
  utility:       '#d6dce4',
  pooja:         '#ffe0b3',
  gym:           '#cfd8f0',
  classroom:     '#e6efd8',
  'computer-lab': '#d8e6f5',
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 40

const INWARD = { front: { x: 0, z: 1 }, back: { x: 0, z: -1 }, left: { x: 1, z: 0 }, right: { x: -1, z: 0 } }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const feet = (v) => +Number(v).toFixed(4)   // 12.3456 stays, float noise goes

// Room name sized to fit inside the room: one line, else two lines, else smaller
// with "…". Text is not measured (the PDF export draws this off-screen), so the
// width is estimated: about 0.56 × font size per character.
const CHAR_W = 0.56
function fitLabel(text, maxW, base) {
  const widthOf = (s, size) => s.length * CHAR_W * size
  if (widthOf(text, base) <= maxW) return { lines: [text], size: base }
  const words = text.split(/\s+/)
  if (words.length > 1) {
    let best = null
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      const longest = Math.max(pair[0].length, pair[1].length)
      if (!best || longest < best.longest) best = { pair, longest }
    }
    const size = Math.min(base, maxW / (best.longest * CHAR_W))
    if (size >= 0.4) return { lines: best.pair, size }
  }
  const size = Math.max(0.35, Math.min(base, maxW / (text.length * CHAR_W)))
  const fit = Math.max(1, Math.floor(maxW / (CHAR_W * size)))
  return { lines: [text.length > fit ? `${text.slice(0, fit - 1)}…` : text], size }
}

// Every piece's name inside its own box, without two names touching.
//   · along the box's long side (a near-square box keeps it level), never upside down
//   · one or two lines, as large as fits, at most LABEL_MAX ft, so names stay a calm size
//   · wall pieces (TV, cabinet, painting) first, one line along their thin bar; then each
//     floor piece slides along its long side, and shrinks if needed, to keep clear of
//     names already placed and of wall pieces hanging over it (a cabinet above a machine)
// items: [{ id, name, x, z, w, d, rotation (radians, as getItemPose), isWall }]
// Returns { [id]: { lines, size, angle (degrees for SVG rotate), x, z } }.
const LABEL_MAX = 0.3
const LABEL_MIN = 0.13
function placePieceLabels(items) {
  const rad = Math.PI / 180
  const boxOf = (x, z, angle, tw, th) => {
    const c = Math.abs(Math.cos(angle * rad))
    const s = Math.abs(Math.sin(angle * rad))
    const hw = (c * tw + s * th) / 2
    const hh = (s * tw + c * th) / 2
    return { x0: x - hw, x1: x + hw, z0: z - hh, z1: z + hh }
  }
  const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
  const textBox = (lines, size) => ({
    tw: Math.max(...lines.map((s) => s.length)) * CHAR_W * size,
    th: lines.length * size * 1.1,
  })
  const frame = (it) => {
    let angle = (-it.rotation * 180) / Math.PI
    let long = it.w
    let short = it.d
    if (it.d > it.w * 1.15) { angle += 90; long = it.d; short = it.w }
    while (angle > 90) angle -= 180
    while (angle <= -90) angle += 180
    return { angle, long, short, dir: { x: Math.cos(angle * rad), z: Math.sin(angle * rad) } }
  }

  const placed = []
  const out = {}
  // the bars of wall pieces, which floor names keep off
  const bars = items.filter((i) => i.isWall).map((i) => ({ id: i.id, ...boxOf(i.x, i.z, (-i.rotation * 180) / Math.PI, i.w, i.d) }))

  for (const it of items.filter((i) => i.isWall)) {
    const { angle, long } = frame({ ...it, d: 0 })
    const size = clamp((long * 0.9) / (it.name.length * CHAR_W), LABEL_MIN, 0.24)
    const { tw, th } = textBox([it.name], size)
    out[it.id] = { lines: [it.name], size, angle, x: it.x, z: it.z }
    placed.push(boxOf(it.x, it.z, angle, tw, th))
  }

  for (const it of items.filter((i) => !i.isWall)) {
    // the two ways the text can run: along the piece's width or along its depth
    const axis = (angle, long, short) => {
      while (angle > 90) angle -= 180
      while (angle <= -90) angle += 180
      return { angle, long, short, dir: { x: Math.cos(angle * rad), z: Math.sin(angle * rad) } }
    }
    const base = (-it.rotation * 180) / Math.PI
    const along = axis(base, it.w, it.d)        // text along the width
    const across = axis(base + 90, it.d, it.w)  // text along the depth
    const words = it.name.split(/\s+/)
    const layouts = [[it.name]]
    for (let i = 1; i < words.length; i++) layouts.push([words.slice(0, i).join(' '), words.slice(i).join(' ')])
    // every way to write it; level text is easier to read, so it wins unless clearly smaller
    const options = []
    for (const f of [along, across]) {
      for (const lines of layouts) {
        const longest = Math.max(...lines.map((s) => s.length))
        const size = Math.min(LABEL_MAX, (f.long * 0.88) / (longest * CHAR_W), (f.short * 0.85) / (lines.length * 1.1))
        options.push({ lines, size, f, score: size * (Math.abs(f.angle) < 1 ? 1.3 : 1) })
      }
    }
    options.sort((a, b) => b.score - a.score)
    const blockers = [...placed, ...bars.filter((b) => b.id !== it.id)]
    const biggest = Math.max(...options.map((o) => o.size))
    let chosen = null
    for (let size = Math.max(biggest, LABEL_MIN); size >= LABEL_MIN - 1e-9 && !chosen; size *= 0.85) {
      for (const opt of options) {
        if (opt.size < size - 1e-9) continue
        const { angle, long, dir } = opt.f
        const { tw, th } = textBox(opt.lines, size)
        const slack = Math.max(0, (long * 0.92 - tw) / 2)
        for (const t of [0, slack, -slack, slack / 2, -slack / 2]) {
          const x = it.x + dir.x * t
          const z = it.z + dir.z * t
          const box = boxOf(x, z, angle, tw, th)
          if (!blockers.some((b) => hit(box, b))) { chosen = { lines: opt.lines, size, angle, x, z, box }; break }
        }
        if (chosen) break
      }
    }
    if (!chosen) {
      // nowhere clear: smallest, on one line, along the long side, in the middle
      const f = it.d > it.w ? across : along
      const { tw, th } = textBox([it.name], LABEL_MIN)
      chosen = { lines: [it.name], size: LABEL_MIN, angle: f.angle, x: it.x, z: it.z, box: boxOf(it.x, it.z, f.angle, tw, th) }
    }
    out[it.id] = { lines: chosen.lines, size: chosen.size, angle: chosen.angle, x: chosen.x, z: chosen.z }
    placed.push(chosen.box)
  }
  return out
}

// Size lines for every room: width along the bottom (else the top), length along
// the left (else the right), whichever side has no other room against it, so a
// line never runs through a neighbour. Boxed in on both sides: just inside the wall.
// rects: [{ x, z, w, l }] room centres and sizes in feet.
function sizeLines(rects) {
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
  const boxes = rects.map((r) => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.l / 2, z1: r.z + r.l / 2 }))
  const BAND = 1.3
  return boxes.map((b, i) => {
    const free = (strip) => !boxes.some((o, j) => j !== i && overlaps(strip, o))
    const width = free({ x0: b.x0, x1: b.x1, z0: b.z1 + 0.05, z1: b.z1 + BAND }) ? { z: b.z1 + 0.55, textZ: b.z1 + 1.2 }
      : free({ x0: b.x0, x1: b.x1, z0: b.z0 - BAND, z1: b.z0 - 0.05 }) ? { z: b.z0 - 0.55, textZ: b.z0 - 0.7 }
      : { z: b.z1 - 0.9, textZ: b.z1 - 1.05 }
    const length = free({ x0: b.x0 - BAND, x1: b.x0 - 0.05, z0: b.z0, z1: b.z1 }) ? { x: b.x0 - 0.55, textX: b.x0 - 1.0 }
      : free({ x0: b.x1 + 0.05, x1: b.x1 + BAND, z0: b.z0, z1: b.z1 }) ? { x: b.x1 + 0.55, textX: b.x1 + 1.1 }
      : { x: b.x0 + 0.9, textX: b.x0 + 1.45 }
    return { ...b, w: rects[i].w, l: rects[i].l, width, length }
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clientToWorld(svg, ev) {
  const m = svg?.getScreenCTM()
  if (!m) return null
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX
  pt.y = ev.clientY
  const p = pt.matrixTransform(m.inverse())
  return { x: p.x, z: p.y }
}

/** Listen on window so a drag keeps working outside the map. Returns a cancel function. */
function trackPointer(onMove, onEnd) {
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  function up(ev) { stop(); onEnd?.(ev) }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  return stop
}

/** Coordinate of a wall's inner face on its normal axis */
function innerFace(wall, room) {
  switch (wall) {
    case 'front': return -room.length / 2 + WALL_HALF
    case 'back':  return  room.length / 2 - WALL_HALF
    case 'left':  return -room.width  / 2 + WALL_HALF
    default:      return  room.width  / 2 - WALL_HALF
  }
}

/**
 * Where a door's hinge, closed end and swung end are in the plan.
 *  hinge: 'low' (default) = hinge at the smaller x / z end of the opening, 'high' = the other end
 *  swing: 'in' (default) = into the room, 'out' = away from it
 */
function doorGeo(o, room, pos, w) {
  const horiz  = isHorizontalWall(o.wall)
  const inward = INWARD[o.wall]
  const out    = o.swing === 'out'
  const n      = { x: inward.x * (out ? -1 : 1), z: inward.z * (out ? -1 : 1) }
  const inner  = innerFace(o.wall, room)
  const shift  = out ? WALL_THICKNESS : 0              // outward doors hinge on the outer face of the wall
  const high   = o.hinge === 'high'
  const along  = high ? pos + w / 2 : pos - w / 2
  const dir    = high ? -1 : 1
  const u = horiz ? { x: dir, z: 0 } : { x: 0, z: dir }
  const H = horiz
    ? { x: along, z: inner - inward.z * shift }
    : { x: inner - inward.x * shift, z: along }
  const deg = getDoorAngle(o)
  const a = (deg * Math.PI) / 180
  const at = (t) => ({
    x: H.x + u.x * w * Math.cos(t) + n.x * w * Math.sin(t),
    z: H.z + u.z * w * Math.cos(t) + n.z * w * Math.sin(t),
  })
  const C = at(0)
  const P = at(a)
  const cross = (P.x - H.x) * (C.z - H.z) - (P.z - H.z) * (C.x - H.x)
  return { H, u, n, C, P, deg, sweep: cross > 0 ? 1 : 0, out }
}

// ─── Furniture drawn as plan symbols (local space: x = width, y = depth, top = back) ───

function PlanSymbol({ type, w, d, variant = 0 }) {
  const x0 = -w / 2
  const y0 = -d / 2
  const s = { stroke: LINE, strokeWidth: 0.05, fill: PAPER, strokeLinejoin: 'round' }
  const soft = { ...s, fill: '#eef0f2' }
  const line = { stroke: LINE, strokeWidth: 0.04, fill: 'none', strokeLinecap: 'round' }

  switch (type) {
    case 'bed':
    case 'singleBed':
    case 'kidsBed':
    case 'cot': {
      const pw = (w - 0.6) / 2
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.1" {...s} />
          <rect x={x0} y={y0} width={w} height="0.3" {...soft} />
          <rect x={x0 + 0.2} y={y0 + 0.45} width={pw} height="1" rx="0.3" {...s} />
          <rect x={x0 + 0.4 + pw} y={y0 + 0.45} width={pw} height="1" rx="0.3" {...s} />
          <rect x={x0 + 0.08} y={y0 + 1.8} width={w - 0.16} height={d - 1.88} rx="0.08" {...soft} />
          <path d={`M ${x0 + 0.08} ${y0 + 2.5} L ${x0 + 0.9} ${y0 + 1.8}`} {...line} />
        </>
      )
    }
    case 'sofa':
    case 'loveseat':
    case 'recliner':
    case 'armchair': {
      const n = type === 'sofa' ? 3 : type === 'loveseat' ? 2 : 1
      const arm = Math.min(0.55, w * 0.18)
      const cw = (w - arm * 2) / n
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.15" {...s} />
          <rect x={x0} y={y0} width={w} height={d * 0.28} rx="0.15" {...soft} />
          <rect x={x0} y={y0 + d * 0.2} width={arm} height={d * 0.8} rx="0.12" {...soft} />
          <rect x={x0 + w - arm} y={y0 + d * 0.2} width={arm} height={d * 0.8} rx="0.12" {...soft} />
          {Array.from({ length: n }).map((_, i) => (
            <rect key={i} x={x0 + arm + i * cw + 0.04} y={y0 + d * 0.3} width={cw - 0.08} height={d * 0.66} rx="0.1" {...s} />
          ))}
        </>
      )
    }
    case 'accentChair':
    case 'outdoorChair':
    case 'labChair':
    case 'studyChair':
    case 'diningChair':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.2" {...s} />
          <rect x={x0} y={y0} width={w} height={d * 0.25} rx="0.12" {...soft} />
        </>
      )
    case 'coffeeTable':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.1" {...s} />
          <rect x={x0 + 0.2} y={y0 + 0.2} width={w - 0.4} height={d - 0.4} rx="0.06" {...line} />
        </>
      )
    case 'bedside':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <circle cx="0" cy="0" r={Math.min(w, d) * 0.25} {...s} />
        </>
      )
    case 'sideTable':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.1" {...s} />
          <circle cx="0" cy="0" r={Math.min(w, d) * 0.3} {...line} />
        </>
      )
    case 'desk':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          <rect x={x0} y={y0} width="1.1" height={d} {...soft} />
          <path d={`M ${x0} ${y0 + d / 2} H ${x0 + 1.1}`} {...line} />
        </>
      )
    case 'diningTable':
      return <rect x={x0} y={y0} width={w} height={d} rx="0.15" {...s} />
    case 'tvUnit':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          <path d={`M ${x0 + w / 3} ${y0} V ${y0 + d} M ${x0 + (2 * w) / 3} ${y0} V ${y0 + d}`} {...line} />
        </>
      )
    case 'wardrobe':
    case 'almirah':
    case 'cabinet':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.04" {...s} />
          <path d={`M 0 ${y0} V ${y0 + d}`} {...line} />
          <circle cx="-0.18" cy={y0 + d * 0.72} r="0.06" {...s} />
          <circle cx="0.18" cy={y0 + d * 0.72} r="0.06" {...s} />
        </>
      )
    case 'bookshelf':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.03" {...s} />
          <path d={`M ${x0} ${y0 + d / 3} H ${x0 + w} M ${x0} ${y0 + (2 * d) / 3} H ${x0 + w}`} {...line} />
        </>
      )
    case 'kitchenCabinet':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.04" {...s} />
          <rect x={x0 + 0.1} y={y0 + 0.1} width={w - 0.2} height={d - 0.2} rx="0.04" {...line} />
          {variant === 0 && (   // sink
            <>
              <rect x={-w * 0.3} y={-d * 0.28} width={w * 0.6} height={d * 0.56} rx="0.1" {...soft} />
              <circle cx="0" cy={d * 0.4} r="0.07" {...s} />
            </>
          )}
          {variant === 1 && (   // four-burner hob
            <>
              {[[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].map(([bx, bz], i) => (
                <g key={i}>
                  <circle cx={bx * (w / 3)} cy={bz * (d / 1.5)} r="0.2" {...line} />
                  <circle cx={bx * (w / 3)} cy={bz * (d / 1.5)} r="0.09" {...line} />
                </g>
              ))}
            </>
          )}
        </>
      )
    case 'kitchenIsland':
      return (
        <>
          <rect x={x0} y="-0.6" width={w} height="2.1" rx="0.08" {...s} />
          <rect x={x0 + 0.12} y="-0.48" width={w - 0.24} height="1.86" rx="0.06" {...line} />
          <circle cx="-1.1" cy="-1" r="0.4" {...s} />
          <circle cx="1.1" cy="-1" r="0.4" {...s} />
        </>
      )
    case 'fridge':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <path d={`M ${x0} ${y0 + 0.9} H ${x0 + w}`} {...line} />
          <path d={`M ${x0 + 0.25} ${y0 + 0.3} V ${y0 + 0.7} M ${x0 + 0.25} ${y0 + 1.1} V ${y0 + 1.7}`} {...line} strokeWidth="0.08" />
        </>
      )
    case 'basin':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <ellipse cx="0" cy="0.1" rx={w * 0.3} ry={d * 0.26} {...soft} />
          <circle cx="0" cy={y0 + 0.22} r="0.08" {...s} />
        </>
      )
    case 'toilet': {
      const tank = 0.65
      return (
        <>
          <rect x="-0.75" y={y0} width="1.5" height={tank} rx="0.08" {...s} />
          <ellipse cx="0" cy={y0 + tank + (d - tank) / 2} rx="0.7" ry={(d - tank) / 2} {...s} />
          <ellipse cx="0" cy={y0 + tank + (d - tank) / 2} rx="0.45" ry={(d - tank) / 2 - 0.2} {...line} />
        </>
      )
    }
    case 'bathtub':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.3" {...s} />
          <rect x={x0 + 0.25} y={y0 + 0.25} width={w - 0.5} height={d - 0.5} rx="0.5" {...soft} />
          <circle cx={x0 + 0.65} cy="0" r="0.1" {...s} />
        </>
      )
    case 'shower':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} {...s} fill="#e0f2fe" />
          <rect x={x0 + 0.15} y={y0 + 0.15} width={w - 0.3} height={d - 0.3} {...line} strokeDasharray="0.15 0.12" />
          <circle cx="0" cy="0" r="0.13" {...s} />
          <circle cx="0" cy={-y0 - 0.35} r="0.2" {...s} />
        </>
      )
    case 'washingMachine':
    case 'dryer':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <circle cx="0" cy="0.15" r={w * 0.3} {...soft} />
          <circle cx="0" cy="0.15" r={w * 0.18} {...line} />
          <rect x={x0 + 0.15} y={y0 + 0.1} width={w - 0.3} height="0.25" rx="0.05" {...line} />
        </>
      )
    // ── Extra furniture ──
    case 'bunkBed':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.1" {...s} />
          <rect x={x0 + 0.15} y={y0 + 0.2} width={w - 0.3} height={d - 0.4} rx="0.08" {...line} />
          <rect x={x0 + 0.3} y={y0 + 0.3} width={w - 0.6} height="0.8" rx="0.1" {...soft} />
          {[0.35, 0.8, 1.25].map((k) => (
            <line key={k} x1={-0.5} y1={y0 + d - k} x2={0.5} y2={y0 + d - k} {...line} />
          ))}
          <line x1={-0.5} y1={y0 + d - 1.4} x2={-0.5} y2={y0 + d} {...line} />
          <line x1={0.5} y1={y0 + d - 1.4} x2={0.5} y2={y0 + d} {...line} />
        </>
      )
    case 'pcRow':
    case 'pcDesk': {
      const seats = Math.max(1, Math.round(w / 2.6))
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.04" {...s} />
          {Array.from({ length: seats }).map((_, i) => {
            const cx = x0 + ((i + 0.5) * w) / seats
            return (
              <g key={i}>
                <rect x={cx - 0.7} y={y0 + 0.12} width="1.4" height="0.14" fill="#1f2937" />
                <rect x={cx - 0.5} y={y0 + d * 0.55} width="1" height="0.3" rx="0.04" {...soft} />
                {i > 0 && <line x1={x0 + (i * w) / seats} y1={y0} x2={x0 + (i * w) / seats} y2={y0 + d} {...line} />}
              </g>
            )
          })}
        </>
      )
    }
    case 'collegeBench':
    case 'collegeBench2': {
      const seats = Math.round(w / 2)
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} fill="none" />
          <rect x={x0} y={y0 + d - 1.45} width={w} height="1.45" fill="#bcd2f5" stroke={LINE} strokeWidth="0.04" />
          <rect x={x0} y={y0} width={w} height="1.0" fill="#e5edf9" stroke={LINE} strokeWidth="0.04" />
          <line x1={x0} y1={y0 + 0.08} x2={x0 + w} y2={y0 + 0.08} {...line} />
          {Array.from({ length: seats - 1 }).map((_, i) => (
            <line key={i} x1={x0 + ((i + 1) * w) / seats} y1={y0 + 0.2} x2={x0 + ((i + 1) * w) / seats} y2={y0 + 0.95} {...line} strokeDasharray="0.1 0.1" />
          ))}
        </>
      )
    }
    case 'teacherDesk':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          <rect x={x0 + 0.1} y={y0 + 0.1} width="1.4" height={d - 0.3} {...soft} />
          <rect x={x0 + w - 1.5} y={y0 + 0.1} width="1.4" height={d - 0.3} {...soft} />
        </>
      )
    case 'podium':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <path d={`M ${x0 + 0.2} ${y0 + 0.2} H ${x0 + w - 0.2} L ${x0 + w - 0.35} ${y0 + d - 0.2} H ${x0 + 0.35} Z`} {...soft} />
        </>
      )
    case 'sectional': {
      const arm = 2.7
      return (
        <>
          <path d={`M ${x0} ${y0} H ${x0 + w} V ${y0 + d} H ${x0 + w - arm} V ${y0 + arm} H ${x0} Z`} {...s} />
          <rect x={x0} y={y0} width={w} height="0.55" rx="0.15" {...soft} />
          <line x1={x0 + (w - arm) / 2} y1={y0 + 0.55} x2={x0 + (w - arm) / 2} y2={y0 + arm} {...line} />
          <line x1={x0 + w - arm} y1={y0 + arm} x2={x0 + w} y2={y0 + arm} {...line} />
        </>
      )
    }
    case 'dresser':
    case 'sideboard':
    case 'filingCabinet':
    case 'pantry':
    case 'toyBox':
    case 'displayUnit':
    case 'crockeryUnit':
    case 'shelfUnit':
    case 'shoeRack': {
      const cols = type === 'sideboard' ? 3 : type === 'shelfUnit' || type === 'shoeRack' || type === 'filingCabinet' || type === 'toyBox' ? 1 : 2
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          {Array.from({ length: cols - 1 }).map((_, i) => (
            <line key={i} x1={x0 + ((i + 1) * w) / cols} y1={y0 + 0.1} x2={x0 + ((i + 1) * w) / cols} y2={y0 + d - 0.05} {...line} />
          ))}
          {(type === 'displayUnit' || type === 'crockeryUnit' || type === 'shelfUnit' || type === 'shoeRack') && (
            <line x1={x0 + 0.1} y1={y0 + d / 2} x2={x0 + w - 0.1} y2={y0 + d / 2} {...line} strokeDasharray="0.12 0.1" />
          )}
          <line x1={x0} y1={y0 + d - 0.12} x2={x0 + w} y2={y0 + d - 0.12} {...line} />
        </>
      )
    }
    case 'dressingTable':
    case 'consoleTable':
    case 'playTable':
    case 'bench':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.06" {...s} />
          <rect x={x0 + 0.12} y={y0 + 0.12} width={w - 0.24} height={d - 0.24} rx="0.04" {...line} />
          {type === 'dressingTable' && <rect x={x0 + w * 0.2} y={y0} width={w * 0.6} height="0.18" {...soft} />}
        </>
      )
    case 'roundTable':
    case 'roundCoffeeTable':
    case 'roundSideTable':
    case 'pouf':
    case 'beanBag':
    case 'barStool':
    case 'trashBin':
    case 'outdoorTable':
    case 'floorLamp':
      return (
        <>
          <ellipse cx="0" cy="0" rx={w / 2} ry={d / 2} {...s} />
          <ellipse cx="0" cy="0" rx={w * 0.32} ry={d * 0.32} {...line} />
        </>
      )
    case 'plant':
    case 'planter':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx={type === 'plant' ? w / 2 : 0.1} {...s} fill="#e3f1df" />
          <circle cx="0" cy="0" r={w * 0.38} fill="#7fb36b" stroke={LINE} strokeWidth="0.04" />
          <circle cx={-w * 0.12} cy={-d * 0.1} r={w * 0.2} fill="#5f9a52" />
          <circle cx={w * 0.14} cy={d * 0.12} r={w * 0.16} fill="#5f9a52" />
        </>
      )
    case 'stove':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
            <g key={i}>
              <circle cx={sx * w * 0.22} cy={sz * d * 0.2} r={Math.min(w, d) * 0.15} {...soft} />
              <circle cx={sx * w * 0.22} cy={sz * d * 0.2} r={Math.min(w, d) * 0.06} {...line} />
            </g>
          ))}
        </>
      )
    case 'kitchenSink':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          <rect x={x0 + w * 0.12} y={y0 + d * 0.2} width={w * 0.34} height={d * 0.6} rx="0.1" {...soft} />
          <rect x={x0 + w * 0.54} y={y0 + d * 0.2} width={w * 0.34} height={d * 0.6} rx="0.1" {...soft} />
          <circle cx="0" cy={y0 + d * 0.12} r="0.08" {...line} />
        </>
      )
    case 'dishwasher':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} />
          <rect x={x0 + 0.2} y={y0 + 0.2} width={w - 0.4} height={d - 0.4} rx="0.05" {...line} />
          <line x1={x0 + 0.35} y1={y0 + d * 0.5} x2={x0 + w - 0.35} y2={y0 + d * 0.5} {...line} />
        </>
      )
    case 'vanity':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <ellipse cx="0" cy="0.1" rx={w * 0.3} ry={d * 0.3} {...soft} fill="#e0f2fe" />
          <circle cx="0" cy={y0 + 0.25} r="0.08" {...line} />
        </>
      )
    case 'treadmill':
    case 'weightBench':
    case 'exerciseBike':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.1" {...s} />
          {type === 'treadmill' && <rect x={x0 + 0.3} y={y0 + 1.2} width={w - 0.6} height={d - 1.5} rx="0.1" {...soft} />}
          {type === 'weightBench' && <rect x={-0.5} y={y0 + d * 0.3} width="1" height={d * 0.6} rx="0.1" {...soft} />}
          {type === 'exerciseBike' && <circle cx="0" cy={y0 + 0.8} r="0.5" {...soft} />}
          <rect x={x0 + 0.2} y={y0 + 0.15} width={w - 0.4} height="0.35" rx="0.05" {...line} />
        </>
      )
    case 'clothesRack':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.05" {...s} fill="none" />
          {[-0.75, -0.25, 0.25, 0.75].map((k) => (
            <line key={k} x1={k * (w / 2 - 0.2)} y1={y0} x2={k * (w / 2 - 0.2)} y2={y0 + d} {...line} />
          ))}
        </>
      )
    case 'poojaUnit':
      return (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx="0.08" {...s} />
          <path d={`M ${x0 + 0.3} ${y0 + d * 0.65} V ${y0 + 0.4} Q 0 ${y0 - 0.1} ${x0 + w - 0.3} ${y0 + 0.4} V ${y0 + d * 0.65} Z`} {...soft} fill="#fff4d6" />
          <circle cx="0" cy={y0 + d * 0.4} r="0.15" fill="#d4af62" stroke={LINE} strokeWidth="0.03" />
        </>
      )
    default:
      return <rect x={x0} y={y0} width={w} height={d} rx="0.1" {...s} />
  }
}

// ─── One room of the plan (the main room, or a connected copy) ─────────────────
// Everything inside is drawn and edited in the room's own coordinates; `offset` places it in the plan.

function RoomLayer({
  room, roomType, title, furniture, openings, wallColors = {},
  offset = { x: 0, z: 0 }, isMain = false, active = false, uid = null, links = [],
  selectedWall, selectedFurnitureId, selectedOpeningId,
  onSelectFurniture, onSelectOpening, onWallSelect, onFurnitureUpdate, onOpeningUpdate,
  addRoom, linkedDoorIds = [],
  onPanStart, onFit, onSelectRoom, onMoveStart, onBlocked,
  svgRef, px,
}) {
  const W = room.width
  const L = room.length
  const T = WALL_THICKNESS
  const I = WALL_HALF

  const cleanupRef = useRef(null)
  const [drag, setDrag]            = useState(null) // { kind, id, patch } — live preview while dragging
  const [hoverDoor, setHoverDoor]  = useState(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  // pointer position in the plan → this room's own coordinates
  const local = (p) => (p ? { x: p.x - offset.x, z: p.z - offset.z } : null)

  const floorDown = (e) => {
    if (!isMain) onSelectRoom?.(uid)
    onPanStart?.(e)
  }

  // ── Live drag preview ────────────────────────────────
  const furnitureView = furniture.map((f) =>
    drag?.kind === 'furniture' && drag.id === f.id ? { ...f, ...drag.patch } : f)
  const openingsView = openings.map((o) =>
    drag?.kind === 'opening' && drag.id === o.id ? { ...o, ...drag.patch } : o)

  const ctx = { openings, furniture, room }

  const onFurnitureDown = (e, item) => {
    e.stopPropagation()
    onSelectFurniture?.(item.id)
    cleanupRef.current?.()
    const svg = svgRef.current
    const start = local(clientToWorld(svg, e))
    if (!start) return
    const pose = getItemPose(item, room)

    if (isWallMounted(item)) {
      // paintings / TV / mirror: slide along their wall only
      const axis = isHorizontalWall(item.wall) ? 'x' : 'z'
      const grab = pose[axis] - start[axis]
      let cur = clampAlong(item.wall, item.position, item.width, room)
      let moved = false
      cleanupRef.current = trackPointer(
        (ev) => {
          const p = local(clientToWorld(svg, ev))
          if (!p) return
          cur = resolveWallMove(item, cur, p[axis] + grab, ctx)
          moved = true
          setDrag({ kind: 'furniture', id: item.id, patch: { position: cur } })
        },
        () => { if (moved) onFurnitureUpdate?.({ ...item, position: cur }); setDrag(null) },
      )
      return
    }

    const grab = { x: pose.x - start.x, z: pose.z - start.z }
    const others = furniture.filter((o) => o.id !== item.id)
    let cur = { x: pose.x, z: pose.z }
    let moved = false
    cleanupRef.current = trackPointer(
      (ev) => {
        const p = local(clientToWorld(svg, ev))
        if (!p) return
        cur = resolveFloorMove(item, cur, { x: p.x + grab.x, z: p.z + grab.z }, others, room)
        moved = true
        setDrag({ kind: 'furniture', id: item.id, patch: { x: cur.x, z: cur.z } })
      },
      () => { if (moved) onFurnitureUpdate?.({ ...item, x: cur.x, z: cur.z }); setDrag(null) },
    )
  }

  const onOpeningDown = (e, o) => {
    e.stopPropagation()
    onSelectOpening?.(o.id)
    cleanupRef.current?.()
    const svg = svgRef.current
    const start = local(clientToWorld(svg, e))
    if (!start) return
    const axis = isHorizontalWall(o.wall) ? 'x' : 'z'
    let cur = clampOpeningPosition(o, room)
    const grab = cur - start[axis]
    let moved = false
    let lastWhy = null
    cleanupRef.current = trackPointer(
      (ev) => {
        const p = local(clientToWorld(svg, ev))
        if (!p) return
        const target = p[axis] + grab
        const next = resolveOpeningMove(o, cur, target, ctx)
        if (Math.abs(target - next) > 0.15) {
          const why = openingBlockReason({ ...o, position: next + Math.sign(target - next) * 0.12 }, ctx)
          if (why !== lastWhy) { lastWhy = why; if (why) onBlocked?.(`Blocked by ${why}`) }
        } else lastWhy = null
        if (next === cur) return
        cur = next
        moved = true
        setDrag({ kind: 'opening', id: o.id, patch: { position: cur } })
      },
      () => { if (moved) onOpeningUpdate?.({ ...o, position: cur }); setDrag(null) },
    )
  }

  // Drag the handle on a selected door's free end to swing it open / closed
  const onDoorHandleDown = (e, o) => {
    e.stopPropagation()
    cleanupRef.current?.()
    const svg = svgRef.current
    const w = Number(o.width) || 3
    const g = doorGeo(o, room, clampOpeningPosition(o, room), w)
    let cur = g.deg
    let moved = false
    cleanupRef.current = trackPointer(
      (ev) => {
        const p = local(clientToWorld(svg, ev))
        if (!p) return
        const vx = p.x - g.H.x
        const vz = p.z - g.H.z
        let a = (Math.atan2(vx * g.n.x + vz * g.n.z, vx * g.u.x + vz * g.u.z) * 180) / Math.PI
        if (a < 0) a = a < -90 ? 120 : 0
        cur = Math.round(clamp(a, 0, 120) / 5) * 5
        moved = true
        setDrag({ kind: 'opening', id: o.id, patch: { openAngle: cur } })
      },
      () => { if (moved) onOpeningUpdate?.({ ...o, openAngle: cur }); setDrag(null) },
    )
  }

  // ── Walls ────────────────────────────────────────────
  const hSpan = W - 2 * I + 2 * T
  const walls = {
    front: { x: -W / 2 + I - T, y: -L / 2 + I - T, w: hSpan, h: T },
    back:  { x: -W / 2 + I - T, y:  L / 2 - I,     w: hSpan, h: T },
    left:  { x: -W / 2 + I - T, y: -L / 2 + I,     w: T, h: L - 2 * I },
    right: { x:  W / 2 - I,     y: -L / 2 + I,     w: T, h: L - 2 * I },
  }
  // thin strip on each wall's inner face shows (and selects) its paint colour
  const strip = 0.14
  const strips = {
    front: { x: -W / 2 + I, y: -L / 2 + I,         w: W - 2 * I, h: strip },
    back:  { x: -W / 2 + I, y:  L / 2 - I - strip, w: W - 2 * I, h: strip },
    left:  { x: -W / 2 + I,         y: -L / 2 + I, w: strip, h: L - 2 * I },
    right: { x:  W / 2 - I - strip, y: -L / 2 + I, w: strip, h: L - 2 * I },
  }

  const floorColor = ROOM_FLOOR[roomType] || '#ece4d3'

  const roomName = title || ROOM_TYPES.find((r) => r.id === roomType)?.name

  // Emptiest spot in the room (away from furniture, door swings and walls) for the room label
  const labelSpot = (() => {
    const boxes = furniture.map((f) => {
      const p = getItemPose(f, room)
      const { hw, hd } = getHalfExtents(Number(f.width) || 1, Number(f.depth) || 1, p.rotation)
      return { x0: p.x - hw, x1: p.x + hw, z0: p.z - hd, z1: p.z + hd }
    })
    openings.filter((o) => o.type === 'door').forEach((o) => {
      const w = Number(o.width) || 3
      const pos = clampOpeningPosition(o, room)
      const inner = innerFace(o.wall, room)
      const n = INWARD[o.wall]
      boxes.push(isHorizontalWall(o.wall)
        ? { x0: pos - w / 2, x1: pos + w / 2, z0: Math.min(inner, inner + n.z * w), z1: Math.max(inner, inner + n.z * w) }
        : { x0: Math.min(inner, inner + n.x * w), x1: Math.max(inner, inner + n.x * w), z0: pos - w / 2, z1: pos + w / 2 })
    })
    let best = { x: 0, z: 0, score: -1 }
    const spots = []
    for (let x = -W / 2 + 1; x <= W / 2 - 1; x += 0.5) {
      for (let z = -L / 2 + 1; z <= L / 2 - 1; z += 0.5) {
        let score = Math.min(W / 2 - Math.abs(x), L / 2 - Math.abs(z))
        for (const b of boxes) {
          const dx = Math.max(b.x0 - x, 0, x - b.x1)
          const dz = Math.max(b.z0 - z, 0, z - b.z1)
          score = Math.min(score, Math.hypot(dx, dz))
        }
        spots.push({ x, z, score })
        if (score > best.score) best = { x, z, score }
      }
    }
    // emptiest first: where the name is tried when it is too big for the best spot
    spots.sort((a, b) => b.score - a.score)
    return { ...best, boxes, spots }
  })()

  // Room name + size: the biggest that fits somewhere clear of furniture and door
  // swings, trying the emptiest spots first; it shrinks before it would touch anything.
  const roomLabel = (() => {
    if (!roomName) return null
    const inner = W - 2 * T - 0.8
    const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
    const top = clamp(Math.min(W, L) * 0.075, 0.55, 1)
    let first = null
    for (let base = top; base >= 0.3 - 1e-9; base *= 0.85) {
      const { lines, size } = fitLabel(roomName, inner, base)
      const subW = `${feet(W)} × ${feet(L)} ft`.length * CHAR_W * 0.42
      const half = Math.max(Math.max(...lines.map((s) => s.length)) * CHAR_W * size, subW) / 2
      const subGap = Math.max(size * 0.85, 0.5)
      const height = (lines.length - 1) * size * 1.1 + subGap + 0.15
      for (const sp of labelSpot.spots.slice(0, 120)) {
        const x = clamp(sp.x, -W / 2 + T + 0.4 + half, W / 2 - T - 0.4 - half)
        const z = sp.z
        const box = { x0: x - half - 0.15, x1: x + half + 0.15, z0: z - size - 0.1, z1: z + height }
        const label = { lines, size, subGap, x: Number.isFinite(x) ? x : 0, z }
        if (!first) first = label
        if (box.z0 > -L / 2 + T && box.z1 < L / 2 - T && !labelSpot.boxes.some((b) => hit(box, b))) return label
      }
    }
    return first   // nowhere clear at any size: the emptiest spot, as before
  })()

  // alternate sink / hob / plain along the counter run
  const cabinetVariant = {}
  furniture.filter((f) => f.type === 'kitchenCabinet').forEach((f, i) => { cabinetVariant[f.id] = i % 3 })

  // ── Openings ─────────────────────────────────────────
  const renderOpening = (o) => {
    const w = Number(o.width) || 3
    const pos = clampOpeningPosition(o, room)
    const horiz = isHorizontalWall(o.wall)
    const n = INWARD[o.wall]
    const inner = innerFace(o.wall, room)
    const selected = selectedOpeningId === o.id
    const edge = selected ? ACCENT : LINE

    // the opening cuts through the whole drawn wall
    const bandMin = horiz ? Math.min(inner, inner - n.z * T) : Math.min(inner, inner - n.x * T)
    const gap = horiz
      ? { x: pos - w / 2, y: bandMin, w, h: T }
      : { x: bandMin, y: pos - w / 2, w: T, h: w }
    const hit = horiz
      ? { x: pos - w / 2, y: bandMin - 0.5, w, h: T + 1 }
      : { x: bandMin - 0.5, y: pos - w / 2, w: T + 1, h: w }

    let detail
    if (o.type === 'door') {
      const g = doorGeo(o, room, pos, w)
      detail = (
        <g pointerEvents="none">
          <rect {...{ x: gap.x, y: gap.y, width: gap.w, height: gap.h }} fill={floorColor} />
          {g.deg > 0.5 && (
            <path d={`M ${g.P.x} ${g.P.z} A ${w} ${w} 0 0 ${g.sweep} ${g.C.x} ${g.C.z}`}
                  fill="none" stroke={edge} strokeWidth="0.04" />
          )}
          <line x1={g.H.x} y1={g.H.z} x2={g.P.x} y2={g.P.z} stroke={edge} strokeWidth="0.09" strokeLinecap="round" />
        </g>
      )
    } else {
      const a = horiz ? bandMin + T / 3 : bandMin + T / 3
      const b = horiz ? bandMin + (2 * T) / 3 : bandMin + (2 * T) / 3
      detail = (
        <g pointerEvents="none">
          <rect x={gap.x} y={gap.y} width={gap.w} height={gap.h} fill={PAPER} stroke={edge} strokeWidth="0.05" />
          {horiz ? (
            <>
              <line x1={pos - w / 2} y1={a} x2={pos + w / 2} y2={a} stroke={edge} strokeWidth="0.03" />
              <line x1={pos - w / 2} y1={b} x2={pos + w / 2} y2={b} stroke={edge} strokeWidth="0.03" />
            </>
          ) : (
            <>
              <line x1={a} y1={pos - w / 2} x2={a} y2={pos + w / 2} stroke={edge} strokeWidth="0.03" />
              <line x1={b} y1={pos - w / 2} x2={b} y2={pos + w / 2} stroke={edge} strokeWidth="0.03" />
            </>
          )}
        </g>
      )
    }

    return (
      <g key={o.id} onPointerDown={(e) => onOpeningDown(e, o)} style={{ cursor: 'grab' }}>
        {detail}
        <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} fill="transparent" />
      </g>
    )
  }

  // ── Furniture ────────────────────────────────────────
  const renderFloorItem = (f) => {
    const pose = getItemPose(f, room)
    const w = Number(f.width) || 1
    const d = Number(f.depth) || 1
    const selected = selectedFurnitureId === f.id
    return (
      <g key={f.id} transform={`translate(${pose.x} ${pose.z})`}
         onPointerDown={(e) => onFurnitureDown(e, f)} style={{ cursor: 'grab' }}>
        <title>{f.name}</title>
        <g transform={`rotate(${(-pose.rotation * 180) / Math.PI})`}>
          <PlanSymbol type={f.type} w={w} d={d} variant={cabinetVariant[f.id] ?? 0} />
          {selected && (
            <rect x={-w / 2 - 0.08} y={-d / 2 - 0.08} width={w + 0.16} height={d + 0.16} rx="0.14"
                  fill="rgba(244,162,97,0.12)" stroke={ACCENT} strokeWidth="0.12" pointerEvents="none" />
          )}
        </g>
      </g>
    )
  }

  const renderWallItem = (f) => {
    const pose = getItemPose(f, room)
    const w = Number(f.width) || 1
    const th = Math.max(Number(f.depth) || 0.2, 0.22)
    const selected = selectedFurnitureId === f.id
    const WALL_FILL = {
      tv: '#1f2937', mirror: '#bfe3f0', whiteboard: '#ffffff', acUnit: '#e5e7eb', clock: '#f4f4f0',
      windowAc: '#dde3e7', classBoard: '#ffffff', noticeBoard: '#1e3a8a',
      towelRack: '#7fb2c9', bathroomShelf: '#f0f0ee', coatRack: '#7b5238',
    }
    const fill = WALL_FILL[f.type] || '#c28a4a'
    return (
      <g key={f.id} transform={`translate(${pose.x} ${pose.z})`}
         onPointerDown={(e) => onFurnitureDown(e, f)} style={{ cursor: 'grab' }}>
        <title>{f.name}</title>
        <g transform={`rotate(${(-pose.rotation * 180) / Math.PI})`}>
          <rect x={-w / 2} y={-th / 2} width={w} height={th} rx="0.04" fill={fill}
                stroke={selected ? ACCENT : LINE} strokeWidth={selected ? 0.1 : 0.04} />
          <rect x={-w / 2} y="-0.6" width={w} height="1.2" fill="transparent" />
        </g>
      </g>
    )
  }

  // big pieces first so small ones are never hidden under them
  const floorItems = furnitureView
    .filter((f) => !isWallMounted(f))
    .sort((a, b) => b.width * b.depth - a.width * a.depth)
  const wallItems = furnitureView.filter(isWallMounted)
  const selectedItem = furnitureView.find((f) => f.id === selectedFurnitureId)

  // ── + boxes outside the doors ────────────────────────
  const renderAddBox = (door) => {
    const pos = clampOpeningPosition(door, room)
    const inner = innerFace(door.wall, room)
    const n = INWARD[door.wall]
    const out = door.swing === 'out' ? (Number(door.width) || 3) + 2 : 2.9
    const size = 2.2
    const x = isHorizontalWall(door.wall) ? pos : inner - n.x * out
    const z = isHorizontalWall(door.wall) ? inner - n.z * out : pos
    const hot = hoverDoor === door.id
    return (
      <g key={`add-${door.id}`} transform={`translate(${x} ${z})`} style={{ cursor: 'pointer' }}
         onPointerEnter={() => setHoverDoor(door.id)} onPointerLeave={() => setHoverDoor(null)}
         onPointerDown={(e) => e.stopPropagation()} onClick={() => addRoom?.(door)}>
        <title>Add a connected room here</title>
        <rect x={-size / 2} y={-size / 2} width={size} height={size} rx="0.35"
              fill={hot ? ACCENT : PAPER} stroke={ACCENT} strokeWidth="0.1" strokeDasharray="0.3 0.2" />
        <path d="M -0.5 0 H 0.5 M 0 -0.5 V 0.5" stroke={hot ? PAPER : ACCENT} strokeWidth="0.22" strokeLinecap="round" />
      </g>
    )
  }


  return (
    <g transform={`translate(${offset.x} ${offset.z})`}>
        {/* floor */}
        <rect x={-W / 2 + I} y={-L / 2 + I} width={W - 2 * I} height={L - 2 * I} fill={floorColor}
              onPointerDown={floorDown} onDoubleClick={onFit} />

        {/* room label */}
        {roomLabel && (
          <g pointerEvents="none" textAnchor="middle" fill="#6b7280" fillOpacity="0.8"
             transform={`translate(${roomLabel.x} ${roomLabel.z})`}>
            {roomLabel.lines.map((s, i) => (
              <text key={i} x="0" y={i * roomLabel.size * 1.1} fontSize={roomLabel.size} fontFamily="system-ui, sans-serif">{s}</text>
            ))}
            <text x="0" y={(roomLabel.lines.length - 1) * roomLabel.size * 1.1 + roomLabel.subGap} fontSize="0.42"
                  fontFamily="system-ui, sans-serif">{`${feet(W)} × ${feet(L)} ft`}</text>
          </g>
        )}

        {/* walls */}
        {Object.entries(walls).map(([wall, r]) => (
          <rect key={wall} x={r.x} y={r.y} width={r.w} height={r.h} fill={WALL_FILL} pointerEvents="none" />
        ))}
        {Object.entries(strips).map(([wall, r]) => (
          <rect key={`paint-${wall}`} x={r.x} y={r.y} width={r.w} height={r.h}
                fill={selectedWall === wall ? ACCENT : wallColors[wall] || '#f5f5f0'}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => { e.stopPropagation(); onWallSelect?.(wall) }}>
            <title>{`${wall} wall — click to paint`}</title>
          </rect>
        ))}

        {openingsView.map(renderOpening)}

        {/* doorways into this room from doors of the rooms next to it (open both ways) */}
        {links.map((link) => {
          const horiz = isHorizontalWall(link.wall)
          const n = INWARD[link.wall]
          const inner = innerFace(link.wall, room)
          const w = Number(link.width) || 3
          const bandMin = horiz ? Math.min(inner, inner - n.z * T) : Math.min(inner, inner - n.x * T)
          const gap = horiz
            ? { x: link.position - w / 2, y: bandMin, w, h: T }
            : { x: bandMin, y: link.position - w / 2, w: T, h: w }
          return <rect key={link.id} x={gap.x} y={gap.y} width={gap.w} height={gap.h} fill={floorColor} pointerEvents="none" />
        })}
        {floorItems.map(renderFloorItem)}
        {wallItems.map(renderWallItem)}

        {/* rotate handle for the selected door */}
        {openingsView.filter((o) => o.type === 'door' && o.id === selectedOpeningId).map((o) => {
          const w = Number(o.width) || 3
          const g = doorGeo(o, room, clampOpeningPosition(o, room), w)
          return (
            <g key={`rot-${o.id}`} transform={`translate(${g.P.x} ${g.P.z})`} style={{ cursor: 'grab' }}
               onPointerDown={(e) => onDoorHandleDown(e, o)}>
              <title>Drag to swing the door</title>
              <circle r="0.55" fill="transparent" />
              <circle r="0.27" fill={PAPER} stroke={ACCENT} strokeWidth="0.1" />
              <circle r="0.09" fill={ACCENT} />
            </g>
          )
        })}

        {/* every piece's name inside its own box (the selected one gets the big label below),
            so the plan and the PDF say what each shape is */}
        {(() => {
          const labels = placePieceLabels([...wallItems, ...floorItems]
            .filter((it) => it.id !== selectedItem?.id)
            .map((it) => {
              const pose = getItemPose(it, room)
              const isWall = wallItems.includes(it)
              return {
                id: it.id, isWall, x: pose.x, z: pose.z, rotation: pose.rotation,
                w: Number(it.width) || 1,
                d: isWall ? Math.max(Number(it.depth) || 0.2, 0.22) : Number(it.depth) || 1,
                name: String(it.name || it.type || '').replace(/\s*\(.*\)\s*$/, '') || 'Item',
              }
            }))
          return Object.entries(labels).map(([id, lb]) => (
            <g key={`label-${id}`} transform={`translate(${lb.x} ${lb.z}) rotate(${lb.angle})`} pointerEvents="none">
              {lb.lines.map((s, i) => (
                <text key={i} x="0" y={(i - (lb.lines.length - 1) / 2) * lb.size * 1.1 + lb.size * 0.35} textAnchor="middle"
                      fontSize={lb.size} fill="#374151" stroke="#ffffff" strokeWidth={lb.size * 0.22} paintOrder="stroke"
                      fontFamily="system-ui, sans-serif">
                  {s}
                </text>
              ))}
            </g>
          ))
        })()}

        {/* selected item name */}
        {selectedItem && (() => {
          const pose = getItemPose(selectedItem, room)
          const { hd } = getHalfExtents(Number(selectedItem.width) || 1, Number(selectedItem.depth) || 1, pose.rotation)
          return (
            <text x={pose.x} y={pose.z - hd - 0.3} textAnchor="middle" fontSize="0.5" fill="#111827"
                  stroke="#ffffff" strokeWidth="0.14" paintOrder="stroke" pointerEvents="none"
                  fontFamily="system-ui, sans-serif">
              {selectedItem.name}
            </text>
          )
        })()}

        {addRoom && openingsView
          .filter((o) => o.type === 'door' && !linkedDoorIds.includes(o.id))
          .map(renderAddBox)}

        {/* selected room outline + move handle (connected rooms only) */}
        {!isMain && active && (
          <rect x={-W / 2 + I - T} y={-L / 2 + I - T} width={W - 2 * I + 2 * T} height={L - 2 * I + 2 * T}
                fill="none" stroke={ACCENT} strokeWidth="0.18" strokeDasharray="0.6 0.35" pointerEvents="none" />
        )}
        {!isMain && onMoveStart && (() => {
          // Move handle: solid orange disc with four arrows (clearly different from the dashed "+" add-room box),
          // parked at the top-left corner so it never sits next to a door's "+".
          const rr = Math.max(0.7, px * 11)
          const a = rr * 0.6
          const h = rr * 0.22
          return (
            <g transform={`translate(${-W / 2 + rr + 0.3} ${-L / 2 - 0.8 - rr})`} style={{ cursor: 'move' }}
               onPointerDown={(e) => onMoveStart(e)}>
              <title>Drag to move this room</title>
              <circle r={rr} fill={ACCENT} stroke={PAPER} strokeWidth={rr * 0.12} />
              <path d={`M 0 ${-a} V ${a} M ${-a} 0 H ${a}
                        M ${-h} ${-a + h} L 0 ${-a} L ${h} ${-a + h}
                        M ${-h} ${a - h} L 0 ${a} L ${h} ${a - h}
                        M ${-a + h} ${-h} L ${-a} 0 L ${-a + h} ${h}
                        M ${a - h} ${-h} L ${a} 0 L ${a - h} ${h}`}
                    fill="none" stroke={PAPER} strokeWidth={rr * 0.14} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })()}
    </g>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FloorPlan2D({
  width = 12,
  length = 14,
  roomType,
  furniture = [],
  openings = [],
  wallColors = {},
  selectedWall,
  selectedFurnitureId,
  selectedOpeningId,
  onSelectFurniture,
  onSelectOpening,
  onWallSelect,
  onClearSelection,
  onFurnitureUpdate,   // (updatedItem) => void
  onOpeningUpdate,     // (updatedOpening) => void
  onAddRoom,           // (door) => void
  onMoveRoom,          // (uid, offset) => void — a connected room was dragged somewhere new
  onConnectedFurnitureUpdate, // (updatedItem, uid) => void
  onConnectedOpeningUpdate,   // (updatedOpening, uid) => void
  onDoorConnect,       // alias of onAddRoom (used if onAddRoom isn't passed)
  connectedRooms = [], // [{ uid, design, offset: { x, z }, doorId? }] — offsets in feet
  onBlocked,              // (message) => void — what stopped a door/window drag
  mainLinks = [],         // doorways cut into the main room by doors of connected rooms
  selectedRoomUid = null, // connected room currently selected in the Editor
  onSelectRoom,           // (uid) => void
  locked = false,
  bare = false,        // true → just the drawing (no zoom buttons / hint). Used by the PDF export.
}) {
  const room = { width, length }
  const W = width
  const L = length
  const T = WALL_THICKNESS
  const I = WALL_HALF
  const addRoom = onAddRoom || onDoorConnect

  // Bounds of the main room + every connected room, so "fit" and the viewport include them all
  const bounds = connectedRooms.reduce((b, cr) => {
    const cw = Number(cr.design?.room_width)  || 10
    const cl = Number(cr.design?.room_length) || 12
    return {
      minX: Math.min(b.minX, cr.offset.x - cw / 2), maxX: Math.max(b.maxX, cr.offset.x + cw / 2),
      minZ: Math.min(b.minZ, cr.offset.z - cl / 2), maxZ: Math.max(b.maxZ, cr.offset.z + cl / 2),
    }
  }, { minX: -W / 2, maxX: W / 2, minZ: -L / 2, maxZ: L / 2 })
  const center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
  const boundsKey = `${bounds.minX},${bounds.maxX},${bounds.minZ},${bounds.maxZ}`

  const svgRef     = useRef(null)
  const cleanupRef = useRef(null)
  const lockedRef  = useRef(locked)
  lockedRef.current = locked

  const [cam, setCam]             = useState(() => ({ x: center.x, z: center.z, zoom: 1 }))
  const [roomDrag, setRoomDrag]   = useState(null) // { uid, offset } — a connected room being moved

  useEffect(() => () => cleanupRef.current?.(), [])
  useEffect(() => { setCam({ x: center.x, z: center.z, zoom: 1 }) }, [width, length, connectedRooms.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom (toward the cursor, with generous limits) ───
  const zoomBy = (factor, anchor) =>
    setCam((c) => {
      const zoom = clamp(c.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const f = zoom / c.zoom
      const a = anchor || { x: c.x, z: c.z }
      return { zoom, x: a.x + (c.x - a.x) / f, z: a.z + (c.z - a.z) / f }
    })

  // Native listener so the page never scrolls / browser-zooms while you zoom the map
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      if (lockedRef.current) return
      const k = e.ctrlKey ? 0.01 : 0.0018 // trackpad pinch arrives as ctrl+wheel
      setCam((c) => {
        const anchor = clientToWorld(svg, e) || { x: c.x, z: c.z }
        const zoom = clamp(c.zoom * Math.exp(-e.deltaY * k), MIN_ZOOM, MAX_ZOOM)
        const f = zoom / c.zoom
        return { zoom, x: anchor.x + (c.x - anchor.x) / f, z: anchor.z + (c.z - anchor.z) / f }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const fit = () => setCam({ x: center.x, z: center.z, zoom: 1 })

  // Visible area: the room plus space around it for the + boxes (further out when a
  // door opens outwards) and the size lines, so the room is as big as it can be
  const margin = [...openings, ...connectedRooms.flatMap((cr) => cr.design?.openings || [])]
    .some((o) => o?.type === 'door' && o.swing === 'out') ? 14 : 10
  const baseW = (bounds.maxX - bounds.minX) + margin
  const baseH = (bounds.maxZ - bounds.minZ) + margin
  const vb = {
    x: cam.x - baseW / cam.zoom / 2,
    y: cam.z - baseH / cam.zoom / 2,
    w: baseW / cam.zoom,
    h: baseH / cam.zoom,
  }

  // Stroke widths stay readable at any zoom
  const px = vb.w / 900

  const onBackgroundDown = (e) => {
    onClearSelection?.()
    if (lockedRef.current) return
    cleanupRef.current?.()
    const startClient = { x: e.clientX, y: e.clientY }
    const startCam = cam
    const scale = svgRef.current.getScreenCTM().a // screen px per foot
    cleanupRef.current = trackPointer((ev) => {
      setCam({
        ...startCam,
        x: startCam.x - (ev.clientX - startClient.x) / scale,
        z: startCam.z - (ev.clientY - startClient.y) / scale,
      })
    })
  }

  // ── Move a whole connected room ───────────────────────
  const onRoomMoveStart = (e, cr) => {
    e.stopPropagation()
    onSelectRoom?.(cr.uid)
    if (lockedRef.current) return
    cleanupRef.current?.()
    const svg = svgRef.current
    const start = clientToWorld(svg, e)
    if (!start) return
    const from = cr.offset
    const size = sizeOf(cr.design)
    const others = otherRects(room, connectedRooms, cr.uid)
    let cur = from
    let moved = false
    cleanupRef.current = trackPointer(
      (ev) => {
        const p = clientToWorld(svg, ev)
        if (!p) return
        cur = resolveRoomMove({ size, from: cur, to: { x: from.x + (p.x - start.x), z: from.z + (p.z - start.z) }, others })
        moved = true
        setRoomDrag({ uid: cr.uid, offset: cur })
      },
      () => { if (moved) onMoveRoom?.(cr.uid, cur); setRoomDrag(null) },
    )
  }

  // ── Measurements ─────────────────────────────────────
  const dim = '#9ca3af'

  const mainActive = !selectedRoomUid
  // doors (of the main room, or of one connected room) that already have a room attached
  const doorsWithRoom = (parentUid) =>
    connectedRooms.filter((cr) => (cr.parentUid || null) === parentUid).map((cr) => cr.doorId).filter(Boolean)

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#f7f5f0] dark:bg-zinc-900">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full select-none touch-none"
      >
        {/* empty space: click to deselect · drag to pan · double-click to fit */}
        <rect x={-5000} y={-5000} width={10000} height={10000} fill="transparent"
              style={{ cursor: locked ? 'default' : 'grab' }}
              onPointerDown={onBackgroundDown} onDoubleClick={fit} />

        {/* connected rooms (drawn first so the main room sits on top) */}
        {connectedRooms.map((cr) => {
          const isActive = selectedRoomUid === cr.uid
          const size = sizeOf(cr.design)
          const off = roomDrag?.uid === cr.uid ? roomDrag.offset : cr.offset
          return (
            <RoomLayer
              key={cr.uid}
              uid={cr.uid}
              room={{ width: size.w, length: size.l }}
              roomType={cr.design.room_type}
              title={cr.design.name}
              furniture={cr.design.furniture || []}
              openings={cr.design.openings || []}
              wallColors={cr.design.wall_colors || {}}
              offset={off}
              active={isActive}
              links={roomDrag?.uid === cr.uid ? [] : cr.links}
              addRoom={addRoom ? (door) => addRoom({ ...door, roomUid: cr.uid }) : undefined}
              linkedDoorIds={doorsWithRoom(cr.uid)}
              selectedWall={isActive ? selectedWall : null}
              selectedFurnitureId={isActive ? selectedFurnitureId : null}
              selectedOpeningId={isActive ? selectedOpeningId : null}
              onSelectFurniture={(id) => onSelectFurniture?.(id, cr.uid)}
              onSelectOpening={(id) => onSelectOpening?.(id, cr.uid)}
              onWallSelect={(w) => onWallSelect?.(w, cr.uid)}
              onFurnitureUpdate={(u) => onConnectedFurnitureUpdate?.(u, cr.uid)}
              onOpeningUpdate={(u) => onConnectedOpeningUpdate?.(u, cr.uid)}
              onPanStart={onBackgroundDown}
              onFit={fit}
              onSelectRoom={onSelectRoom}
              onMoveStart={(e) => onRoomMoveStart(e, cr)}
              onBlocked={onBlocked}
              svgRef={svgRef}
              px={px}
            />
          )
        })}

        <RoomLayer
          isMain
          room={room}
          roomType={roomType}
          furniture={furniture}
          openings={openings}
          wallColors={wallColors}
          selectedWall={mainActive ? selectedWall : null}
          selectedFurnitureId={mainActive ? selectedFurnitureId : null}
          selectedOpeningId={mainActive ? selectedOpeningId : null}
          onSelectFurniture={(id) => onSelectFurniture?.(id, null)}
          onSelectOpening={(id) => onSelectOpening?.(id, null)}
          onWallSelect={(w) => onWallSelect?.(w, null)}
          onFurnitureUpdate={onFurnitureUpdate}
          onOpeningUpdate={onOpeningUpdate}
          addRoom={addRoom ? (door) => addRoom({ ...door, roomUid: null }) : undefined}
          linkedDoorIds={doorsWithRoom(null)}
          links={mainLinks}
          onBlocked={onBlocked}
          onPanStart={onBackgroundDown}
          onFit={fit}
          svgRef={svgRef}
          px={px}
        />

        {/* measurements: width and length of every room (also in the PDF export) */}
        <g pointerEvents="none" fill={dim} stroke={dim} strokeWidth={Math.max(0.04, px * 1.2)}>
          {sizeLines([
            { x: 0, z: 0, w: W, l: L },
            ...connectedRooms.map((cr) => {
              const s = sizeOf(cr.design)
              const o = roomDrag?.uid === cr.uid ? roomDrag.offset : cr.offset
              return { x: o.x, z: o.z, w: s.w, l: s.l }
            }),
          ]).map((r, i) => {
            const cx = (r.x0 + r.x1) / 2
            const cz = (r.z0 + r.z1) / 2
            const { z } = r.width
            const { x } = r.length
            return (
              <g key={i}>
                <path d={`M ${r.x0} ${z} H ${r.x1} M ${r.x0} ${z - 0.2} V ${z + 0.2} M ${r.x1} ${z - 0.2} V ${z + 0.2}`} fill="none" />
                <text x={cx} y={r.width.textZ} textAnchor="middle" fontSize="0.5" stroke="none" fontFamily="system-ui, sans-serif">{feet(r.w)} ft</text>
                <path d={`M ${x} ${r.z0} V ${r.z1} M ${x - 0.2} ${r.z0} H ${x + 0.2} M ${x - 0.2} ${r.z1} H ${x + 0.2}`} fill="none" />
                <text transform={`translate(${r.length.textX} ${cz}) rotate(-90)`} textAnchor="middle" fontSize="0.5" stroke="none" fontFamily="system-ui, sans-serif">{feet(r.l)} ft</text>
              </g>
            )
          })}
        </g>
      </svg>

      {!bare && (<>
      {/* zoom controls: top-right corner of the plan. The editor keeps this corner
          free: its toolbar, size dialog and piece cards are all on the left. */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-center gap-1.5
                      bg-surface/95 dark:bg-zinc-800/90 backdrop-blur border border-border dark:border-zinc-700
                      rounded-xl p-1.5 shadow-lg text-zinc-800 dark:text-zinc-100">
        <button onClick={() => zoomBy(1.4)} disabled={locked} title="Zoom in"
                className="w-8 h-8 rounded-lg text-lg leading-none hover:bg-zinc-200/70 dark:hover:bg-zinc-700 disabled:opacity-40">+</button>
        <span className="text-[10px] tabular-nums opacity-60">{Math.round(cam.zoom * 100)}%</span>
        <button onClick={() => zoomBy(1 / 1.4)} disabled={locked} title="Zoom out"
                className="w-8 h-8 rounded-lg text-lg leading-none hover:bg-zinc-200/70 dark:hover:bg-zinc-700 disabled:opacity-40">−</button>
        <div className="w-5 border-t border-border dark:border-zinc-600" />
        <button onClick={fit} title="Fit the whole room"
                className="w-8 h-8 rounded-lg text-sm hover:bg-zinc-200/70 dark:hover:bg-zinc-700">⌂</button>
      </div>
      {/* the how-to line ("drag empty space to pan") is in the editor's Tools
          menu: down here it ran into the colour palette and the Floor box */}
      </>)}
    </div>
  )
}
