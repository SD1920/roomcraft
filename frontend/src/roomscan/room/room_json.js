// room.json v1 -- the one file that describes a room to everything downstream.
//
// The manual form and the AR scan both produce it, so the editor, the layout
// solver and the suggestion call never know which one made the room.
//
// Frame: metres, y up. `floor` is a list of [x, z] corners with the first
// corner at the origin and the first wall along +x. Wall i runs from floor[i]
// to floor[(i + 1) % n]. The pairs map straight onto three.js as (x, 0, z).

import { distance, polygonArea } from '../geometry/floor.js';

export const ROOM_VERSION = 1;
export const FT_TO_M = 0.3048;
const SOURCES = ['manual', 'ar_scan'];
const OPENING_TYPES = ['door', 'window'];
const EPS = 1e-6;

export function feetToMetres(ft) {
  return ft * FT_TO_M;
}

/** A plain rectangular room, as the manual form would make it. */
export function rectRoom(widthM, lengthM, heightM) {
  return buildRoom({
    source: 'manual',
    floor: [[0, 0], [widthM, 0], [widthM, lengthM], [0, lengthM]],
    height: heightM,
  });
}

export function buildRoom({ source, floor, height, openings = [], quality = {} }) {
  return {
    version: ROOM_VERSION,
    units: 'm',
    source,
    floor,
    height,
    openings,
    quality: {
      loopGapM: quality.loopGapM ?? null,
      minDepressionDeg: quality.minDepressionDeg ?? null,
      taps: quality.taps ?? 0,
    },
  };
}

export function wallLength(room, i) {
  const n = room.floor.length;
  return distance(room.floor[i], room.floor[(i + 1) % n]);
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// proper crossing of segments ab and cd (shared endpoints do not count)
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
         ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/**
 * @returns {{ok:boolean, errors:string[]}} every problem found, not just the
 *   first, so a bad file can be fixed in one pass.
 */
export function validateRoom(room) {
  const errors = [];
  if (!room || typeof room !== 'object') return { ok: false, errors: ['room is not an object'] };
  if (room.version !== ROOM_VERSION) errors.push(`version must be ${ROOM_VERSION}`);
  if (room.units !== 'm') errors.push('units must be "m"');
  if (!SOURCES.includes(room.source)) errors.push(`source must be one of ${SOURCES.join(', ')}`);

  const floor = room.floor;
  let floorOk = Array.isArray(floor) && floor.length >= 3 &&
    floor.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
  if (!floorOk) {
    errors.push('floor must be 3 or more [x, z] corners of finite numbers');
  } else {
    const n = floor.length;
    for (let i = 0; i < n; i++) {
      if (distance(floor[i], floor[(i + 1) % n]) < 1e-3) {
        errors.push(`wall ${i} has zero length`);
        floorOk = false;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // adjacent across the wrap
        if (segmentsCross(floor[i], floor[(i + 1) % n], floor[j], floor[(j + 1) % n])) {
          errors.push(`walls ${i} and ${j} cross`);
          floorOk = false;
        }
      }
    }
    if (floorOk && polygonArea(floor) < 1e-4) {
      errors.push('floor has no area');
      floorOk = false;
    }
  }

  const heightOk = isNum(room.height) && room.height > 0;
  if (!heightOk) errors.push('height must be a positive number');

  if (!Array.isArray(room.openings)) {
    errors.push('openings must be an array');
  } else {
    room.openings.forEach((o, k) => {
      const tag = `opening ${k}`;
      if (!o || typeof o !== 'object') { errors.push(`${tag} is not an object`); return; }
      if (!OPENING_TYPES.includes(o.type)) errors.push(`${tag}: type must be door or window`);
      for (const f of ['offset', 'width', 'sill', 'height']) {
        if (!isNum(o[f])) errors.push(`${tag}: ${f} must be a number`);
      }
      if (isNum(o.offset) && o.offset < 0) errors.push(`${tag}: offset is negative`);
      if (isNum(o.width) && o.width <= 0) errors.push(`${tag}: width must be positive`);
      if (isNum(o.sill) && o.sill < 0) errors.push(`${tag}: sill is negative`);
      if (isNum(o.height) && o.height <= 0) errors.push(`${tag}: height must be positive`);
      const wallOk = floorOk && Number.isInteger(o.wall) && o.wall >= 0 && o.wall < floor.length;
      if (floorOk && !wallOk) errors.push(`${tag}: wall index out of range`);
      if (wallOk && isNum(o.offset) && isNum(o.width) &&
          o.offset + o.width > wallLength(room, o.wall) + EPS) {
        errors.push(`${tag}: runs past the end of wall ${o.wall}`);
      }
      if (heightOk && isNum(o.sill) && isNum(o.height) && o.sill + o.height > room.height + EPS) {
        errors.push(`${tag}: taller than the room`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}
