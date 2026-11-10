// Detected boxes -> doors, windows, wall items and floor furniture, placed in
// the room, then merged and given stable ids for the review list.
//
// Pure: no browser, no three.js scene. Runs whenever the scan is recomputed,
// so placement improves with the room fit and with late Gemini answers.
//
// Each detection frame records which wall the user was facing (its wall
// "station"). That wall's plane is known once the room is fitted, and it is
// what makes placement work:
//   - doors, windows and wall-mounted pieces sit ON that wall: two opposite
//     corners of the box, cast onto the wall plane, give position along the
//     wall, width, height and how high up it starts (the same geometry as
//     tapping two corners by hand)
//   - floor pieces near that wall are taken to stand against it: back to the
//     wall, facing into the room. That is how rooms are furnished, and it
//     removes most of the scatter that free placement from one box gives
//   - other floor pieces stand where the box's bottom edge meets the floor,
//     facing the camera
// Sizes along the wall come from the box; depth and height from the catalog.

import { pixelRay, placeBoxOnFloor } from './camera_ray.js';
import { catalogTypesFor } from './coco_catalog.js';
import { intersectWall, openingFromCorners, rayToWall } from '../scan/room_scan.js';
import { toRoom, alongWall, wallLengthM } from '../scan/room_frame.js';
import { wallItemFromCorners, rotationToFace, facingOf } from '../scan/furniture.js';

const FT = 0.3048;

// A floor piece whose front edge is this close to the wall being faced is
// taken to stand against it. Starting value, not tuned.
export const AGAINST_WALL_M = 0.6;
// A box-measured width further than this factor from the catalog's is not
// trusted (a box cut by the frame, or two pieces in one box).
const WIDTH_TRUST_RATIO = 2;
// Sightings of one piece closer than this are merged (wall items and doors:
// along the wall; floor pieces: in plan).
export const MERGE_ALONG_M = 0.6;
export const MERGE_PLAN_M = 1.0;

const LOOSE = { extentTolM: 1.0, minGrazeDeg: 5 };
const INWARD = { front: [0, 1], back: [0, -1], left: [1, 0], right: [-1, 0] };

function typeOf(item) {
  if (item.source === 'gemini') return item.label;
  return item.types?.[0] ?? catalogTypesFor(item.label)[0] ?? null;
}

/** The wall a pixel looks at, or null. */
function wallAt(fit, d, u, v) {
  const ray = pixelRay(d.projection, d.view, u, v, d.width, d.height);
  return rayToWall(fit, ray.origin, ray.dir)?.wall ?? null;
}

/**
 * The wall a frame was looking at: where the centre of view meets a wall,
 * or, if it meets none (the fit moved), the wall being scanned when it was
 * taken. Geometry first: the user may have turned away from the station.
 */
function frameWall(fit, d) {
  const seen = wallAt(fit, d, d.width / 2, d.height / 2);
  if (seen) return seen;
  return Number.isInteger(d.wallIndex) && fit.labels[d.wallIndex] ? fit.labels[d.wallIndex] : null;
}

/** The wall a box on a wall is on: where its own centre points, else the frame's wall. */
function boxWall(fit, d, box, fallback) {
  return wallAt(fit, d, box.x + box.w / 2, box.y + box.h / 2) ?? fallback;
}

/** How far a room point (its front edge) is from a wall, inside the room. */
function gapTo(fit, wall, r) {
  const halfW = fit.widthM / 2, halfL = fit.lengthM / 2;
  return wall === 'front' ? r.z + halfL
    : wall === 'back' ? halfL - r.z
      : wall === 'left' ? r.x + halfW : halfW - r.x;
}

/** A box's two opposite corners cast onto a wall, or null if either misses it. */
function boxOnWall(fit, wall, d, box) {
  const corner = (u, v) => {
    const ray = pixelRay(d.projection, d.view, u, v, d.width, d.height);
    return intersectWall(fit, wall, ray.origin, ray.dir, LOOSE)?.point ?? null;
  };
  const a = corner(box.x, box.y + box.h);
  const b = corner(box.x + box.w, box.y);
  return a && b ? [a, b] : null;
}

function floorPiece(fit, entry, faced, d, item) {
  let wall = faced;
  const placed = placeBoxOnFloor(item.box, d, fit.floorY);
  if (!placed?.point) return null;
  const r = toRoom(fit, placed.point);
  const catalogWidth = entry.width * FT;
  const ratio = placed.widthM ? placed.widthM / catalogWidth : 0;
  const width = ratio > 1 / WIDTH_TRUST_RATIO && ratio < WIDTH_TRUST_RATIO ? placed.widthM : catalogWidth;
  const depth = entry.depth * FT;
  const halfW = fit.widthM / 2, halfL = fit.lengthM / 2;

  // against a wall if its front edge is close enough to one: the wall the
  // camera faced first (in a corner both are close), else the nearest
  const close = (w) => {
    const gap = gapTo(fit, w, r);
    return gap >= -0.3 && gap <= AGAINST_WALL_M + depth;
  };
  const others = ['front', 'back', 'left', 'right'].filter((w) => w !== wall && close(w))
    .sort((a, b) => gapTo(fit, a, r) - gapTo(fit, b, r));
  const against = wall && close(wall) ? wall : others[0] ?? null;
  if (against) {
    wall = against;
    const [fx, fz] = INWARD[wall];
    const along = alongWall(wall, r);
    const limit = Math.max(0, wallLengthM(fit, wall) / 2 - width / 2);
    const a = Math.max(-limit, Math.min(limit, along));
    const off = depth / 2;
    const x = wall === 'left' ? -halfW + off : wall === 'right' ? halfW - off : a;
    const z = wall === 'front' ? -halfL + off : wall === 'back' ? halfL - off : a;
    return {
      against: wall,
      item: { type: entry.id, x, z, rotation: rotationToFace(entry, fx, fz), width, depth, height: entry.height * FT, elevation: 0 },
    };
  }
  // free-standing: the box bottom is its front edge; face the camera
  const cam = toRoom(fit, [d.view[12], d.view[13], d.view[14]]);
  let fx = cam.x - r.x, fz = cam.z - r.z;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len; fz /= len;
  return {
    against: null,
    item: {
      type: entry.id, x: r.x - fx * depth / 2, z: r.z - fz * depth / 2,
      rotation: rotationToFace(entry, fx, fz), width, depth, height: entry.height * FT, elevation: 0,
    },
  };
}

/**
 * Every usable sighting in the detection records, placed in the room.
 * @returns {{kind: 'opening'|'wallItem'|'floorItem', type, wall, source, score,
 *   opening?, item?, frame: number}[]} metres, room frame
 */
export function placeDetections(detections, fit, catalog) {
  if (!fit?.ok) return [];
  const out = [];
  (detections ?? []).forEach((d, frame) => {
    if (!d.projection || !d.view) return;
    const wall = frameWall(fit, d);
    for (const it of d.items ?? []) {
      const type = typeOf(it);
      if (!type) continue;
      const base = { type, source: it.source === 'gemini' ? 'gemini' : 'phone', score: Number.isFinite(it.score) ? it.score : 0.5, frame };
      if (type === 'door' || type === 'window') {
        const on = boxWall(fit, d, it.box, wall);
        if (!on) continue;
        const corners = boxOnWall(fit, on, d, it.box);
        if (!corners) continue;
        const { opening } = openingFromCorners(fit, type, on, corners[0], corners[1]);
        if (opening.width < 0.3 || opening.height < 0.3) continue;
        out.push({ ...base, kind: 'opening', wall: on, opening });
        continue;
      }
      const entry = catalog[type];
      if (!entry) continue;
      if (entry.wallMounted) {
        const on = boxWall(fit, d, it.box, wall);
        if (!on) continue;
        const corners = boxOnWall(fit, on, d, it.box);
        if (!corners) continue;
        const { item } = wallItemFromCorners(fit, entry, on, corners[0], corners[1]);
        if (item.width < 0.1 || item.height < 0.1) continue;
        out.push({ ...base, kind: 'wallItem', wall: on, item });
        continue;
      }
      const placed = floorPiece(fit, entry, wall, d, it);
      if (!placed) continue;
      out.push({ ...base, kind: 'floorItem', wall: placed.against, item: placed.item });
    }
  });
  return out;
}

const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function position(c) {
  if (c.kind === 'opening') return [c.opening.position, c.opening.offset];
  if (c.kind === 'wallItem') return [c.item.position, c.item.elevation];
  return [c.item.x, c.item.z];
}

function near(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'floorItem') {
    return Math.hypot(a.item.x - b.item.x, a.item.z - b.item.z) < MERGE_PLAN_M;
  }
  return a.wall === b.wall && Math.abs(position(a)[0] - position(b)[0]) < MERGE_ALONG_M;
}

/** Average a group of sightings of one piece into one. */
function combine(group) {
  const best = group.reduce((p, q) => (q.score > p.score ? q : p));
  const avg = (get) => meanOf(group.map(get));
  const c = { ...best, seen: group.length, score: Math.max(...group.map((g) => g.score)) };
  if (best.kind === 'opening') {
    c.opening = { ...best.opening, position: avg((g) => g.opening.position), width: avg((g) => g.opening.width), height: avg((g) => g.opening.height), offset: avg((g) => g.opening.offset) };
    if (c.opening.type === 'door') c.opening.offset = 0;
  } else if (best.kind === 'wallItem') {
    c.item = { ...best.item, position: avg((g) => g.item.position), width: avg((g) => g.item.width), height: avg((g) => g.item.height), elevation: avg((g) => g.item.elevation) };
  } else {
    c.item = { ...best.item, x: avg((g) => g.item.x), z: avg((g) => g.item.z), width: avg((g) => g.item.width) };
  }
  return c;
}

/**
 * Merge sightings into pieces, Gemini first. A phone sighting of a floor
 * piece within the merge distance of any Gemini piece is dropped: Gemini
 * knows the whole catalog, the phone calls an almirah a refrigerator.
 * Each piece gets an id from its kind, type, wall and rounded position, so a
 * review decision still finds it after the scan is recomputed.
 */
export function mergeCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => (a.source === b.source ? b.score - a.score : a.source === 'gemini' ? -1 : 1));
  const groups = [];
  for (const c of sorted) {
    const same = groups.find((g) => g[0].type === c.type && near(g[0], c));
    if (same) { same.push(c); continue; }
    if (c.source === 'phone' && groups.some((g) => g[0].source === 'gemini' && near(g[0], c))) continue;
    groups.push([c]);
  }
  return groups.map(combine).map((c) => {
    const [p, q] = position(c);
    return { ...c, id: `${c.kind}|${c.type}|${c.wall ?? '-'}|${Math.round(p * 2)}|${Math.round(q * 2)}` };
  });
}

// ---- review: the user's Keep / Change type / Remove ------------------------
//
// A decision per merged piece, keyed by its id: 'keep', 'remove', 'maybe'
// (leave as a suggestion) or {type} (keep, as another catalog type).
// Undecided pieces: Gemini's are kept (it names catalog types and its boxes
// were right on the last scan), the phone's stay suggestions (it calls an
// almirah a refrigerator).

export function decisionFor(c, review) {
  return review?.[c.id] ?? (c.source === 'gemini' ? 'keep' : 'maybe');
}

/** Where a piece is on the plan, room frame (m): floor pieces at their centre, the rest on their wall. */
export function planPoint(fit, c) {
  if (c.kind === 'floorItem') return { x: c.item.x, z: c.item.z };
  const pos = c.kind === 'opening' ? c.opening.position : c.item.position;
  const hw = fit.widthM / 2, hl = fit.lengthM / 2;
  if (c.wall === 'front') return { x: pos, z: -hl };
  if (c.wall === 'back') return { x: pos, z: hl };
  if (c.wall === 'left') return { x: -hw, z: pos };
  return { x: hw, z: pos };
}

/** Types a piece may be changed to: the same kind only, so its geometry still makes sense. */
export function typesLike(c, catalog) {
  if (c.kind === 'opening') return ['door', 'window'];
  const wall = c.kind === 'wallItem';
  return Object.values(catalog).filter((e) => Boolean(e.wallMounted) === wall).map((e) => e.id);
}

/** The same piece as another type: measured sizes kept, catalog sizes swapped, facing kept. */
export function retype(c, type, catalog) {
  if (type === c.type) return c;
  if (c.kind === 'opening') {
    if (type !== 'door' && type !== 'window') return c;
    return { ...c, type, opening: { ...c.opening, type, offset: type === 'door' ? 0 : c.opening.offset } };
  }
  const entry = catalog[type], old = catalog[c.type];
  if (!entry || !old || Boolean(entry.wallMounted) !== (c.kind === 'wallItem')) return c;
  if (c.kind === 'wallItem') return { ...c, type, item: { ...c.item, type, depth: entry.depth * FT } };
  const [fx, fz] = facingOf(old, c.item.rotation);
  const depth = entry.depth * FT;
  // a piece against a wall keeps its back on the wall: move its centre by half the change
  const shift = c.wall ? (c.item.depth - depth) / 2 : 0;
  return {
    ...c,
    type,
    item: {
      ...c.item, type, depth, height: entry.height * FT,
      x: c.item.x - fx * shift, z: c.item.z - fz * shift,
      rotation: rotationToFace(entry, fx, fz),
    },
  };
}

/**
 * Kept pieces join the scan result as openings and furniture (so the design,
 * sketch and CSV treat them like tapped ones); 'maybe' pieces become
 * suggestions; removed ones are dropped.
 * @returns {{result, suggestions: object[], pieces: object[]}} pieces: every
 *   candidate with its decision and its (possibly changed) type, for the list
 */
export function applyReview(result, candidates, review, catalog) {
  const fit = result.fit;
  const openings = [...(result.openings ?? [])];
  const furniture = [...(result.furniture ?? [])];
  const suggestions = [];
  const pieces = [];
  for (const c0 of candidates) {
    const d = decisionFor(c0, review);
    const c = d && typeof d === 'object' ? retype(c0, d.type, catalog) : c0;
    const decision = d && typeof d === 'object' ? 'keep' : d;
    pieces.push({ ...c, decision, changed: c.type !== c0.type, originalType: c0.type });
    if (decision === 'remove') continue;
    if (decision === 'keep') {
      if (c.kind === 'opening') openings.push({ opening: c.opening, problems: [], type: c.type, wall: c.wall, detected: true });
      else {
        furniture.push({
          item: c.item, type: c.type, detected: true, problems: [],
          measured: c.kind === 'wallItem' ? ['width', 'height', 'elevation'] : ['position', ...(c.item.width !== (catalog[c.type]?.width ?? 0) * FT ? ['width'] : [])],
        });
      }
      continue;
    }
    suggestions.push({
      type: c.type, name: catalog[c.type]?.name ?? c.type, source: c.source, kind: c.kind, wall: c.wall,
      ...planPoint(fit, c), score: c.score, seen: c.seen ?? 1,
    });
  }
  return { result: { ...result, openings, furniture }, suggestions, pieces };
}
