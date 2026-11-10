// Furniture placed from taps, in the room frame (metres).
//
// FLOOR PIECES (bed, sofa, wardrobe, table ...)
// The user stands in front of the piece and taps the floor at its two FRONT
// corners, then optionally a point on its back edge.
//   - the two front corners give the width, the position of the front edge,
//     and the direction the piece faces: towards where the user stood
//   - the back point, if given, gives the depth; otherwise the catalog's
//     standard depth is used, because a back edge against a wall or hidden
//     behind the piece often cannot be reached
// Height is always the catalog's: nothing here measures it.
//
// WALL PIECES (TV, painting, mirror, AC ...)
// Two opposite corners aimed at on the wall, like a window.
//
// Output follows the team app's furniture conventions (roomPresets.js there):
// width runs along the piece's local x, depth along its local z, and at
// rotation 0 a piece faces -z, except the catalog's `facesPlusZ` types, which
// face +z. Rotation is about the vertical axis, in radians, as three.js uses.

import { toRoom, fromRoom, wallLengthM, alongWall } from './room_frame.js';
import { rayPlaneIntersect } from '../geometry/ray.js';

const FT = 0.3048;

// A measured size this far from the catalog's standard suggests the wrong
// type was picked, or a tap landed in the wrong place.
const SIZE_RATIO_LIMIT = 2;

function sizeCheck(problems, label, measuredM, standardFt) {
  const standardM = standardFt * FT;
  const ratio = measuredM / standardM;
  if (ratio > SIZE_RATIO_LIMIT || ratio < 1 / SIZE_RATIO_LIMIT) {
    problems.push(`${label} measured ${(measuredM / FT).toFixed(1)} ft, a standard one is ${standardFt} ft - right type?`);
  }
}

/**
 * Rotation that makes a piece of this type face the direction (fx, fz).
 * Inverse of the app's rotationToFace, for any direction, not only the four
 * walls' directions.
 */
export function rotationToFace(entry, fx, fz) {
  return entry.facesPlusZ ? Math.atan2(fx, fz) : Math.atan2(-fx, -fz);
}

/** Direction a piece faces at a given rotation: the inverse of rotationToFace. */
export function facingOf(entry, rotation) {
  return entry.facesPlusZ
    ? [Math.sin(rotation), Math.cos(rotation)]
    : [-Math.sin(rotation), -Math.cos(rotation)];
}

/**
 * @param entry catalog entry (furniture_catalog.json), sizes in feet
 * @param taps 2 or 3 of { p: [x, y, z], cam: [x, y, z] } in the AR frame:
 *   front corner, other front corner, optional point on the back edge
 * @returns {{item: object | null, measured: string[], problems: string[]}}
 */
export function floorItemFromTaps(fit, entry, taps) {
  const problems = [];
  if (taps.length < 2) return { item: null, measured: [], problems: ['needs both front corners'] };
  const [a, b, back] = taps.map((t) => toRoom(fit, t.p));
  const ex = b.x - a.x, ez = b.z - a.z;
  const width = Math.hypot(ex, ez);
  if (width < 0.15) {
    return { item: null, measured: [], problems: ['the two front corners are less than 15 cm apart'] };
  }
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  let nx = -ez / width, nz = ex / width;
  // the front faces the person who tapped it
  const cam = toRoom(fit, taps[0].cam);
  if ((cam.x - mid.x) * nx + (cam.z - mid.z) * nz < 0) { nx = -nx; nz = -nz; }

  const measured = ['width'];
  let depth = entry.depth * FT;
  if (back) {
    const s = (back.x - mid.x) * nx + (back.z - mid.z) * nz;
    const got = Math.abs(s);
    // A back tap that gives a depth far from the standard one landed
    // somewhere else (1 Nov: a bed came out 16 ft deep, another 0.9 ft):
    // keep the standard depth rather than a wrong measurement.
    const ratio = got / depth;
    if (s > 0) {
      problems.push(`the back tap was in front of the front edge, so the standard ${entry.depth} ft depth was used`);
    } else if (ratio > SIZE_RATIO_LIMIT || ratio < 1 / SIZE_RATIO_LIMIT) {
      problems.push(`the back tap gave ${(got / FT).toFixed(1)} ft deep, so the standard ${entry.depth} ft was used`);
    } else {
      depth = got;
      measured.push('depth');
    }
  }
  sizeCheck(problems, 'width', width, entry.width);

  const item = {
    type: entry.id,
    x: mid.x - nx * depth / 2,
    z: mid.z - nz * depth / 2,
    rotation: rotationToFace(entry, nx, nz),
    width,
    depth,
    height: entry.height * FT,
    elevation: 0,
  };
  if (Math.abs(item.x) > fit.widthM / 2 || Math.abs(item.z) > fit.lengthM / 2) {
    problems.push('its centre is outside the room');
  }
  return { item, measured, problems };
}

/**
 * @param a, b opposite corners on `wall`, [x, y, z] in the AR frame
 * @returns {{item: object | null, measured: string[], problems: string[]}}
 */
export function wallItemFromCorners(fit, entry, wall, a, b) {
  const ra = toRoom(fit, a), rb = toRoom(fit, b);
  const width = Math.abs(alongWall(wall, ra) - alongWall(wall, rb));
  const bottom = Math.min(ra.y, rb.y);
  const height = Math.abs(ra.y - rb.y);
  const position = (alongWall(wall, ra) + alongWall(wall, rb)) / 2;
  const problems = [];
  if (width < 0.1 || height < 0.1) problems.push('less than 10 cm across');
  if (Math.abs(position) + width / 2 > wallLengthM(fit, wall) / 2 + 0.1) problems.push('runs past the end of its wall');
  sizeCheck(problems, 'width', width, entry.width);
  sizeCheck(problems, 'height', height, entry.height);
  return {
    item: {
      type: entry.id,
      wallMounted: true,
      wall,
      position,
      elevation: bottom,
      width,
      depth: entry.depth * FT,
      height,
    },
    measured: ['width', 'height', 'elevation'],
    problems,
  };
}

// ---- quicker marking (1 Nov): one tap, or two corners like a door ----------
//
// Tapping 2-3 corners of every piece was too slow (ten pieces, thirty taps).
// Most pieces now take ONE tap anywhere on them; tall pieces that stand
// against a wall (almirah, wardrobe, shelves...) take two, like a door.
// Sizes not measured come from the catalog or the chosen size preset.

/** Pieces marked by two corners of their front, like a door: tall, against a wall. */
export const STANDING_TYPES = new Set([
  'almirah', 'wardrobe', 'bookshelf', 'shelfUnit', 'displayUnit', 'crockeryUnit',
  'pantry', 'cabinet', 'kitchenCabinet', 'fridge', 'filingCabinet', 'poojaUnit',
]);

// A piece whose tap is this close to a wall, beyond half its depth, is taken
// to stand against that wall. Starting value.
export const AGAINST_WALL_M = 0.5;

const INWARD = { front: [0, 1], back: [0, -1], left: [1, 0], right: [-1, 0] };

function gapsTo(fit, r) {
  const hw = fit.widthM / 2, hl = fit.lengthM / 2;
  return { front: r.z + hl, back: hl - r.z, left: r.x + hw, right: hw - r.x };
}

/** Centre of a piece standing with its back on `wall`, `along` the wall, clamped inside it. */
function againstWall(fit, wall, along, width, depth) {
  const limit = Math.max(0, wallLengthM(fit, wall) / 2 - width / 2);
  const a = Math.max(-limit, Math.min(limit, along));
  const hw = fit.widthM / 2, hl = fit.lengthM / 2;
  const off = depth / 2;
  return {
    x: wall === 'left' ? -hw + off : wall === 'right' ? hw - off : a,
    z: wall === 'front' ? -hl + off : wall === 'back' ? hl - off : a,
  };
}

/**
 * A floor piece from ONE tap anywhere on it (its top, or the floor at it).
 * Near a wall: back to that wall, facing into the room, centred along the
 * wall at the tap. Otherwise: centred at the tap, facing where the user
 * stood. Width, depth and height: the catalog's (or the size preset's).
 * @param p [x, y, z] of the tap; cam where the phone was
 */
export function floorItemFromOneTap(fit, entry, p, cam) {
  const r = toRoom(fit, p);
  const width = entry.width * FT, depth = entry.depth * FT, height = entry.height * FT;
  const problems = [];
  const [wall, gap] = Object.entries(gapsTo(fit, r)).sort((a, b) => a[1] - b[1])[0];
  const reach = Math.max(width, depth) / 2 + AGAINST_WALL_M;
  // A tap on the middle of a piece is about half its depth from the wall it
  // backs onto, or about half its width from a wall along its side. A bed
  // tapped 45 cm from a wall lies along it (hostel rooms, 1 Nov); tapped
  // 95 cm away, its head is against it.
  if (gap < reach && width < depth && Math.abs(gap - width / 2) < Math.abs(gap - depth / 2)) {
    const alongX = wall === 'front' || wall === 'back';
    const c = toRoom(fit, cam);
    const toward = Math.sign((alongX ? c.x - r.x : c.z - r.z)) || 1;
    const fx = alongX ? toward : 0, fz = alongX ? 0 : toward;
    // its long side on the wall: the wall-facing offset is half its width
    const limit = Math.max(0, wallLengthM(fit, wall) / 2 - depth / 2);
    const a = Math.max(-limit, Math.min(limit, alongWall(wall, r)));
    const hw = fit.widthM / 2, hl = fit.lengthM / 2;
    const x = wall === 'left' ? -hw + width / 2 : wall === 'right' ? hw - width / 2 : a;
    const z = wall === 'front' ? -hl + width / 2 : wall === 'back' ? hl - width / 2 : a;
    return {
      item: { type: entry.id, x, z, rotation: rotationToFace(entry, fx, fz), width, depth, height, elevation: 0 },
      measured: ['position'],
      problems,
      against: wall,
    };
  }
  if (gap < depth / 2 + AGAINST_WALL_M) {
    const [fx, fz] = INWARD[wall];
    const { x, z } = againstWall(fit, wall, alongWall(wall, r), width, depth);
    return {
      item: { type: entry.id, x, z, rotation: rotationToFace(entry, fx, fz), width, depth, height, elevation: 0 },
      measured: ['position'],
      problems,
      against: wall,
    };
  }
  const c = toRoom(fit, cam);
  let fx = c.x - r.x, fz = c.z - r.z;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len; fz /= len;
  return {
    item: { type: entry.id, x: r.x, z: r.z, rotation: rotationToFace(entry, fx, fz), width, depth, height, elevation: 0 },
    measured: ['position'],
    problems,
    against: null,
  };
}

/**
 * A tall piece from two corners of its front, like a door: the bottom-left
 * corner tapped on the floor, then the top-right corner aimed at. The front
 * is taken parallel to the nearest wall; the top corner's aiming line meets
 * it, giving width and height. Depth is the catalog's; its back is towards
 * that wall.
 * @param bl [x, y, z] of the floor tap; top {origin, dir} of the aimed corner
 */
export function standingItemFromCorners(fit, entry, bl, top) {
  const b = toRoom(fit, bl);
  const origin = fromRoom(fit, 0, 0);
  // The front is parallel to the nearest wall; if the aim does not meet that
  // (it runs nearly along it), the next nearest. 1 Nov: once the walls were
  // corrected, an almirah's nearest wall changed and its corner was lost.
  let wall, gap, hit = null;
  for ([wall, gap] of Object.entries(gapsTo(fit, b)).sort((p, q) => p[1] - q[1])) {
    const [ix, iz] = INWARD[wall];
    const n = fromRoom(fit, ix, iz);
    const h = rayPlaneIntersect(top.origin, top.dir, bl, [n[0] - origin[0], 0, n[2] - origin[2]], 5);
    const up = h ? toRoom(fit, h.point).y - b.y : 0;
    if (h && up > 0.3 && up < 3.5) { hit = h; break; }
  }
  if (!hit) {
    // keep the piece: standing where its corner was tapped, standard size
    const r = floorItemFromOneTap(fit, entry, bl, top.origin);
    return { ...r, problems: ['the top corner did not meet the front of the piece, so the standard size was used'] };
  }
  const [fx, fz] = INWARD[wall];
  const t = toRoom(fit, hit.point);
  const problems = [];
  const width = Math.abs(alongWall(wall, t) - alongWall(wall, b));
  let height = t.y - b.y;
  const measured = ['width', 'height'];
  if (width < 0.15) problems.push('the two corners are less than 15 cm apart');
  if (height < 0.3 || height > 3.5) {
    problems.push(`the corners gave ${(height / FT).toFixed(1)} ft tall, so the standard ${entry.height} ft was used`);
    height = entry.height * FT;
    measured.pop();
  }
  sizeCheck(problems, 'width', width, entry.width);
  const depth = entry.depth * FT;
  const along = (alongWall(wall, t) + alongWall(wall, b)) / 2;
  // back to the wall when the front is about one depth out, else where the front is
  const frontOut = Math.max(gap, depth);
  const centre = againstWall(fit, wall, along, width, depth);
  const shift = frontOut - depth; // how far it stands off the wall
  return {
    item: {
      type: entry.id,
      x: centre.x + fx * shift,
      z: centre.z + fz * shift,
      rotation: rotationToFace(entry, fx, fz),
      width,
      depth,
      height,
      elevation: 0,
    },
    measured,
    problems,
  };
}
