// Room scan: four walls tapped at their base, plus doors and windows marked by
// two corners each, turned into a measured rectangle.
//
// Pure: no three.js, no DOM. The same functions run on the phone and in tests.
//
// HOW A WALL IS MEASURED
// The user taps two or more floor points along the line where a wall meets the
// floor. A line is fitted through them. The room is the rectangle that best
// fits all four lines: its orientation comes from all four wall directions,
// and its width and length from how far apart opposite walls are. Corners are
// never tapped, so a wardrobe in a corner does not matter, and taps can be
// anywhere along a wall.
//
// THE OUTPUT FRAME is the team app's (src/utils/layout.js there): room centred
// on the origin, width along x, length along z, walls named
//   front  z = -length/2      back   z = +length/2
//   left   x = -width/2       right  x = +width/2
// The first wall tapped is FRONT. Left and right are as seen standing inside
// the room facing the front wall; the other three walls are recognised from
// geometry, so they can be tapped in any order. Distances here are metres;
// conversion to the app's feet happens in room/app_design.js.

import { fitLine2D } from '../geometry/floor.js';
import { rayPlaneIntersect } from '../geometry/ray.js';
import { makeTap, finalPosition } from '../ar/tap_log.js';
import { toRoom, fromRoom, wallLengthM, alongWall, xz, dot2 } from './room_frame.js';
import {
  floorItemFromTaps, wallItemFromCorners, floorItemFromOneTap, standingItemFromCorners, STANDING_TYPES,
} from './furniture.js';

export { toRoom, fromRoom, wallLengthM };

const DEG = Math.PI / 180;

export const WALL_COUNT = 4;

// Two taps closer than this give a wall direction too noisy to use: a 2 cm
// tap error over 30 cm is already a 4 degree tilt.
export const MIN_WALL_SPREAD_M = 0.3;

// The four corner steps of a wall, in the order they are tapped:
// bottom-left, top-left, top-right, bottom-right.
export const CORNERS = ['bl', 'tl', 'tr', 'br'];
// The room counts as closed when the last corner (wall 4 bottom-right) comes
// back this close to the first (wall 1 bottom-left). Starting value.
export const CLOSE_GAP_M = 0.5;

// Thresholds that turn the quality numbers into "consistent" or "check".
// STARTING VALUES, NOT MEASURED. They are here so a bad scan is flagged
// rather than shown as if it were fine; tighten them once real rooms have
// been scanned against a tape.
export const CHECK_LIMITS = {
  wallAngleDeg: 5,    // a wall this far off square
  residualCm: 5,      // taps this far off their side of the rectangle (rms)
  floorSpreadCm: 15,  // reported floor heights this far apart
};

// A ray that meets a wall at a shallower angle than this gives a corner
// position that moves a lot for a small aiming error.
const MIN_WALL_GRAZE_DEG = 10;
// How far past a wall's ends, and below the floor, a hit still counts.
const WALL_EXTENT_TOL_M = 0.3;
const BELOW_FLOOR_TOL_M = 0.2;

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

function spread(points) {
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      best = Math.max(best, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
    }
  }
  return best;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// A wall line taken from one tap on the wall's surface counts as much as a
// line through floor taps this far apart. Starting value, not measured.
const SURFACE_LINE_WEIGHT_M = 1;

/** Floor points as [x, y, z] and surface points as {p, n}, both to {p, n}. */
function asEntries(wall) {
  return wall.map((e) => (Array.isArray(e) ? { p: e, n: null } : { p: e.p, n: e.n ?? null }));
}

/**
 * One wall's line in plan, from its taps.
 *   - 2+ points (floor or surface) far enough apart: the line through them
 *   - otherwise one tap on the wall's surface: the line through it, along
 *     the surface (perpendicular to its normal). This is what makes a wall
 *     usable when furniture hides where it meets the floor.
 * @param wall entries as fitRoomRectangle takes them
 * @returns {{line: {point, dir, rms}, weight: number} | null}
 */
export function wallLine(wall) {
  const entries = asEntries(wall);
  const pts = entries.map((e) => xz(e.p));
  if (pts.length >= 2 && spread(pts) >= MIN_WALL_SPREAD_M) {
    return { line: fitLine2D(pts), weight: spread(pts) };
  }
  const surface = entries.find((e) => e.n);
  if (!surface) return null;
  const len = Math.hypot(surface.n[0], surface.n[1]);
  if (!(len > 1e-6)) return null;
  const point = [mean(pts.map((p) => p[0])), mean(pts.map((p) => p[1]))];
  return { line: { point, dir: [-surface.n[1] / len, surface.n[0] / len], rms: 0 }, weight: SURFACE_LINE_WEIGHT_M };
}

/**
 * Fit the room rectangle.
 *
 * @param walls array of WALL_COUNT arrays, in the order tapped; walls[0] is
 *   the front wall. Each entry is either a floor point [x, y, z] where the
 *   wall meets the floor, or a point on the wall's own surface
 *   {p: [x, y, z], n: [nx, nz]} with the surface's horizontal normal.
 * @param inside [x, y, z] of any point inside the room (the phone's position
 *   while tapping), used to tell the inner side of the front wall
 * @returns {{ok: false, error: string} | {ok: true, xAxis, zAxis, centre,
 *   widthM, lengthM, floorY, labels: string[], quality}}
 */
export function fitRoomRectangle(walls, inside) {
  if (!Array.isArray(walls) || walls.length !== WALL_COUNT) {
    return { ok: false, error: `Need ${WALL_COUNT} walls, got ${walls?.length ?? 0}.` };
  }
  const entries = walls.map(asEntries);
  const pts = entries.map((w) => w.map((e) => xz(e.p)));
  const fitted = entries.map(wallLine);
  for (let i = 0; i < WALL_COUNT; i++) {
    if (!fitted[i]) {
      return {
        ok: false,
        error: `Wall ${i + 1} needs 2 floor taps at least ${MIN_WALL_SPREAD_M * 100} cm apart, or 1 tap on the wall itself.`,
      };
    }
  }
  const floorYs = entries.flat().filter((e) => !e.n).map((e) => e.p[1]);
  if (floorYs.length === 0) {
    return { ok: false, error: 'Tap the floor along at least one wall, so the floor height is known.' };
  }
  const lines = fitted.map((f) => f.line);

  // ---- which wall is which ------------------------------------------------
  const front = lines[0];
  let inward = [-front.dir[1], front.dir[0]];
  if (dot2(inward, sub2(xz(inside), front.point)) < 0) inward = [-inward[0], -inward[1]];
  // looking at the front wall from inside, with y up: right = facing x up
  const facing = [-inward[0], -inward[1]];
  const roughRight = [-facing[1], facing[0]];

  const parallelness = lines.map((l) => Math.abs(dot2(l.dir, front.dir)));
  const others = [1, 2, 3];
  const backIndex = others.reduce((a, b) => (parallelness[b] > parallelness[a] ? b : a));
  if (parallelness[backIndex] < Math.cos(45 * DEG)) {
    return { ok: false, error: 'No wall runs roughly parallel to the front wall, so the back wall could not be found.' };
  }
  if (dot2(sub2(lines[backIndex].point, front.point), inward) <= 0) {
    return { ok: false, error: 'The wall opposite the front one is not on the room side of it. Start again from the front wall.' };
  }
  const sides = others.filter((i) => i !== backIndex);
  const mid = [
    mean(lines.map((l) => l.point[0])),
    mean(lines.map((l) => l.point[1])),
  ];
  const sideOf = (i) => dot2(sub2(lines[i].point, mid), roughRight);
  const [a, b] = sides;
  if (parallelness[a] > Math.cos(45 * DEG) || parallelness[b] > Math.cos(45 * DEG)
      || Math.sign(sideOf(a)) === Math.sign(sideOf(b))) {
    return { ok: false, error: 'The two side walls could not be told apart. Tap each wall clearly along its base.' };
  }
  const labels = [];
  labels[0] = 'front';
  labels[backIndex] = 'back';
  labels[a] = sideOf(a) > 0 ? 'right' : 'left';
  labels[b] = sideOf(b) > 0 ? 'right' : 'left';

  // ---- orientation from all four walls ----------------------------------
  // Directions are folded onto one quarter turn (angle x 4) and averaged, so
  // the two horizontal and two vertical walls all vote for one rectangle.
  // Longer tap spreads are more trustworthy and weigh more.
  let s = 0, c = 0;
  lines.forEach((l, i) => {
    const w = fitted[i].weight;
    const theta = Math.atan2(l.dir[1], l.dir[0]);
    s += w * Math.sin(4 * theta);
    c += w * Math.cos(4 * theta);
  });
  const base = Math.atan2(s, c) / 4;
  const candidates = [0, 1, 2, 3].map((k) => [Math.cos(base + k * 90 * DEG), Math.sin(base + k * 90 * DEG)]);
  const xAxis = candidates.reduce((p, q) => (dot2(q, roughRight) > dot2(p, roughRight) ? q : p));
  // right-handed with y up, matching three.js: z = x cross y
  const zAxis = [-xAxis[1], xAxis[0]];

  // ---- size from the separation of opposite walls -----------------------
  const byName = {};
  labels.forEach((name, i) => { byName[name] = i; });
  const offset = (name) => {
    const axis = name === 'front' || name === 'back' ? zAxis : xAxis;
    return mean(pts[byName[name]].map((p) => dot2(p, axis)));
  };
  const zf = offset('front'), zb = offset('back'), xl = offset('left'), xr = offset('right');
  const lengthM = zb - zf;
  const widthM = xr - xl;
  if (!(lengthM > 0.5) || !(widthM > 0.5)) {
    return { ok: false, error: 'The walls do not enclose a room. Check that the front wall was tapped first.' };
  }
  const cx = (xl + xr) / 2, cz = (zf + zb) / 2;
  const centre = [xAxis[0] * cx + zAxis[0] * cz, xAxis[1] * cx + zAxis[1] * cz];
  // the floor's height comes from floor taps only: a tap on a wall surface
  // is somewhere up the wall
  const floorY = median(floorYs);

  // ---- quality ------------------------------------------------------------
  const perWall = labels.map((name, i) => {
    const horizontal = name === 'front' || name === 'back';
    const along = horizontal ? xAxis : zAxis;
    const across = horizontal ? zAxis : xAxis;
    const target = { front: zf, back: zb, left: xl, right: xr }[name];
    const residuals = pts[i].map((p) => dot2(p, across) - target);
    return {
      wall: name,
      taps: pts[i].length,
      angleErrorDeg: Math.acos(Math.min(1, Math.abs(dot2(lines[i].dir, along)))) / DEG,
      residualCm: Math.sqrt(mean(residuals.map((r) => r * r))) * 100,
    };
  });
  const ys = floorYs;
  const quality = {
    walls: perWall,
    maxWallAngleDeg: Math.max(...perWall.map((w) => w.angleErrorDeg)),
    maxResidualCm: Math.max(...perWall.map((w) => w.residualCm)),
    floorSpreadCm: (Math.max(...ys) - Math.min(...ys)) * 100,
  };
  const reasons = [];
  if (quality.maxWallAngleDeg > CHECK_LIMITS.wallAngleDeg) {
    reasons.push(`a wall is ${quality.maxWallAngleDeg.toFixed(1)} deg off square`);
  }
  if (quality.maxResidualCm > CHECK_LIMITS.residualCm) {
    reasons.push(`taps sit up to ${quality.maxResidualCm.toFixed(1)} cm off their wall`);
  }
  if (quality.floorSpreadCm > CHECK_LIMITS.floorSpreadCm) {
    reasons.push(`floor height varied by ${quality.floorSpreadCm.toFixed(0)} cm between taps`);
  }
  quality.verdict = reasons.length === 0 ? 'consistent' : 'check';
  quality.reasons = reasons;

  return { ok: true, xAxis, zAxis, centre, widthM, lengthM, floorY, labels, quality };
}

function wallPlane(fit, wall) {
  const half = { front: -fit.lengthM / 2, back: fit.lengthM / 2, left: -fit.widthM / 2, right: fit.widthM / 2 }[wall];
  const axis = wall === 'front' || wall === 'back' ? fit.zAxis : fit.xAxis;
  const point = wall === 'front' || wall === 'back' ? fromRoom(fit, 0, half) : fromRoom(fit, half, 0);
  return { point, normal: [axis[0], 0, axis[1]] };
}

/** Where a ray meets one named wall, or null if it misses it. */
export function intersectWall(fit, wall, origin, dir, { extentTolM = WALL_EXTENT_TOL_M, minGrazeDeg = MIN_WALL_GRAZE_DEG } = {}) {
  const { point, normal } = wallPlane(fit, wall);
  const hit = rayPlaneIntersect(origin, dir, point, normal, minGrazeDeg);
  if (!hit) return null;
  const r = toRoom(fit, hit.point);
  if (Math.abs(alongWall(wall, r)) > wallLengthM(fit, wall) / 2 + extentTolM) return null;
  if (r.y < -BELOW_FLOOR_TOL_M) return null;
  return { wall, point: hit.point, t: hit.t };
}

/**
 * The wall a ray from the phone points at: the nearest wall it meets within
 * the wall's extent. Null when it points at no wall (at the floor, out of a
 * door, or too sideways along a wall to trust).
 */
export function rayToWall(fit, origin, dir, options) {
  let best = null;
  for (const wall of ['front', 'back', 'left', 'right']) {
    const hit = intersectWall(fit, wall, origin, dir, options);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

/** rayToWall with the looser test used for a second corner. */
function rayToWallLoose(fit, origin, dir) {
  return rayToWall(fit, origin, dir, ON_KNOWN_WALL);
}

/**
 * A door or window from two opposite corners on its wall, in metres.
 * Corners may be given in either order and either diagonal.
 * @returns {{opening: {type, wall, position, width, height, offset}, problems: string[]}}
 *   position is along the wall from its centre (x for front/back, z for
 *   left/right), offset is the sill height (0 for a door)
 */
export function openingFromCorners(fit, type, wall, a, b) {
  const ra = toRoom(fit, a), rb = toRoom(fit, b);
  const horizontal = wall === 'front' || wall === 'back';
  const alongA = horizontal ? ra.x : ra.z;
  const alongB = horizontal ? rb.x : rb.z;
  const bottom = Math.min(ra.y, rb.y);
  const top = Math.max(ra.y, rb.y);
  const width = Math.abs(alongA - alongB);
  const position = (alongA + alongB) / 2;
  const isDoor = type === 'door';
  const opening = {
    type,
    wall,
    position,
    width,
    height: isDoor ? top : top - bottom,
    offset: isDoor ? 0 : bottom,
  };
  const problems = [];
  if (width < 0.3) problems.push(`only ${(width * 100).toFixed(0)} cm wide`);
  if (opening.height < 0.3) problems.push(`only ${(opening.height * 100).toFixed(0)} cm tall`);
  if (Math.abs(position) + width / 2 > wallLengthM(fit, wall) / 2 + 0.1) {
    problems.push('runs past the end of its wall');
  }
  // a door's lower corner should be on the floor; if it is not, the height
  // is measured from the wrong place
  if (isDoor && bottom > 0.15) problems.push(`lower corner is ${(bottom * 100).toFixed(0)} cm above the floor`);
  if (top > 4) problems.push('top corner is more than 4 m up');
  return { opening, problems };
}

// ---- the scan as a sequence of steps ----------------------------------------

// For the second corner of a door, window or wall piece: how far past the
// wall's ends it may land, and how shallow the view of the wall may be.
const SECOND_CORNER_EXTENT_TOL_M = 1.0;
const SECOND_CORNER_GRAZE_DEG = 5;
// used wherever the wall is already decided, so a corner accepted once is
// never refused when the scan is recomputed
const ON_KNOWN_WALL = { extentTolM: SECOND_CORNER_EXTENT_TOL_M, minGrazeDeg: SECOND_CORNER_GRAZE_DEG };

/** A wall named the way the user saw it, not by the app's internal name. */
export function describeWall(wall) {
  return {
    front: 'your first wall',
    back: 'the wall opposite your first wall',
    left: 'the wall on your left when you face your first wall',
    right: 'the wall on your right when you face your first wall',
  }[wall] ?? wall;
}

// Narrower than this, two "opposite" corners were really the same corner.
const MIN_OPENING_WIDTH_M = 0.3;
const MIN_WALL_ITEM_WIDTH_M = 0.1;

/** A saved wall tap as fitRoomRectangle takes it: floor point, or surface point with normal. */
function wallEntry(t) {
  return t.surfaceNormal ? { p: finalPosition(t), n: t.surfaceNormal } : finalPosition(t);
}

/**
 * Recompute everything from what was recorded. Used live on the phone and
 * again on the results page, so a saved scan can always be re-measured with
 * improved code without scanning the room again.
 *
 * @param saved {taps, openings, furniture}
 *   taps: [{wall, hit, cam, anchored?}] - wall is 0-3 for a wall tap, null
 *     for a furniture tap
 *   openings: [{type, wall, corners: [{origin, dir}]}]
 *   furniture: [{type, kind: 'floor', tapIdx: [..]} |
 *               {type, kind: 'wall', wall, corners: [{origin, dir}]}]
 * @param catalog map of type id -> catalog entry; furniture is only measured
 *   when it is given
 */
export function scanResult(saved, catalog = null) {
  const walls = [];
  for (let i = 0; i < WALL_COUNT; i++) walls.push([]);
  const wallTaps = saved.taps.filter((t) => Number.isInteger(t.wall) && t.wall >= 0 && t.wall < WALL_COUNT);
  if (wallTaps.length === 0) return { fit: { ok: false, error: 'No walls tapped.' }, openings: [], furniture: [] };
  // Bottom corners that landed on furniture are left out of the walls, and
  // the top corners place them instead (see cornerCeiling).
  const floorY = roomFloorY(saved.taps);
  const tops = floorY === null ? null : cornerCeiling(saved.taps, saved.ceiling ?? [], floorY);
  for (let i = 0; i < WALL_COUNT; i++) {
    const own = wallTaps.filter((t) => t.wall === i);
    const real = tops ? own.filter((t) => !isOnFurniture(t, floorY)) : own;
    const corners = tops
      ? (saved.ceiling ?? []).filter((c) => c.wallIndex === i).map((c) => topCornerOnFloor(c, floorY, tops.heightM)).filter(Boolean)
      : [];
    // a wall with nothing but furniture taps and no top corners keeps its taps
    walls[i] = real.length + corners.length >= 2 || real.some((t) => t.surfaceNormal)
      ? [...real.map(wallEntry), ...corners]
      : own.map(wallEntry);
  }
  const inside = [0, 1, 2].map((k) => mean(wallTaps.map((t) => t.cam[k])));
  const fit = fitRoomRectangle(walls, inside);
  if (!fit.ok) return { fit, openings: [], furniture: [] };

  const onWall = (wall, corners) => corners.map((c) => intersectWall(fit, wall, c.origin, c.dir, ON_KNOWN_WALL));

  const openings = (saved.openings ?? []).map((o) => {
    const corners = onWall(o.wall, o.corners);
    if (corners.some((c) => !c)) {
      return { opening: null, problems: ['a corner no longer lands on its wall'], type: o.type, wall: o.wall };
    }
    return openingFromCorners(fit, o.type, o.wall, corners[0].point, corners[1].point);
  });

  const furniture = (saved.furniture ?? []).map((f) => {
    const known = catalog?.[f.type];
    if (!known) return { item: null, measured: [], problems: [`unknown furniture type "${f.type}"`], type: f.type };
    // a size preset (e.g. a Queen bed) replaces the catalog's standard sizes
    const entry = f.size ? { ...known, ...f.size } : known;
    const sized = (r) => (f.size?.name ? { ...r, sizeName: f.size.name } : r);
    if (f.kind === 'wall') {
      const corners = onWall(f.wall, f.corners);
      if (corners.some((c) => !c)) {
        return { item: null, measured: [], problems: ['a corner no longer lands on its wall'], type: f.type };
      }
      return sized(wallItemFromCorners(fit, entry, f.wall, corners[0].point, corners[1].point));
    }
    const taps = f.tapIdx.map((i) => saved.taps[i]).filter(Boolean)
      .map((t) => ({ p: finalPosition(t), cam: t.cam }));
    // one tap anywhere on the piece, or (tall pieces) a floor corner + an aimed top corner
    if (f.kind === 'one') return sized(taps[0] ? floorItemFromOneTap(fit, entry, taps[0].p, taps[0].cam) : { item: null, measured: [], problems: ['its tap is missing'] });
    if (f.kind === 'standing') {
      return sized(taps[0] && f.corner
        ? standingItemFromCorners(fit, entry, taps[0].p, f.corner)
        : { item: null, measured: [], problems: ['needs both corners'] });
    }
    return sized(floorItemFromTaps(fit, entry, taps));
  });

  const ceiling = tops
    ? { heightM: tops.heightM, taps: tops.taps, spreadCm: tops.spreadCm }
    : ceilingFrom(fit, saved.ceiling ?? [], saved.taps);
  const onFurniture = floorY === null ? 0 : wallTaps.filter((t) => isOnFurniture(t, floorY)).length;
  return { fit, openings, furniture, ceiling, onFurniture };
}

// ---- rooms full of furniture (1 Nov hostel-room scans) -----------------------
//
// With beds and desks along every wall, most bottom corners are hidden, and
// the ring (always at the centre of the screen) lands on the bed or desk
// top in front of the corner while LOOKING like it is on the corner: 6 of 8
// taps came back 60-84 cm above the floor. Walls placed from them came out
// pulled in and skewed (7.6 deg), and the ceiling 1.91 m instead of 2.74.
// The top corners are never hidden. So:
//   1. the floor is the lowest believable height (the phone's own floor
//      estimate saved with taps, else the lowest wall tap)
//   2. bottom taps more than ON_FURNITURE_M above it are on furniture
//   3. the ceiling height comes from walls with a bottom tap on the real
//      floor: that wall's direction from its two top corners, its position
//      from the floor tap, and where the top corners meet it (1 Nov: 2.71
//      and 2.72 m against a tape's 2.74 m)
//   4. every top corner then meets the ceiling plane; straight down from
//      there is a point on its wall's base, used instead of furniture taps

/** A bottom tap this far above the floor is on furniture, not the floor. */
export const ON_FURNITURE_M = 0.2;

/** The floor height: the phone's saved estimate if any, else the lowest wall floor tap. */
export function roomFloorY(taps) {
  const est = (taps ?? []).map((t) => t.floorEstimate).filter(Number.isFinite);
  if (est.length > 0) return median(est);
  const ys = (taps ?? []).filter((t) => Number.isInteger(t.wall) && !t.surfaceNormal).map((t) => t.hit[1]);
  return ys.length > 0 ? Math.min(...ys) : null;
}

export function isOnFurniture(t, floorY) {
  return !t.surfaceNormal && t.hit[1] - floorY > ON_FURNITURE_M;
}

/** Where an aimed top corner meets the ceiling plane, dropped to the floor: [x, floorY, z]. */
function topCornerOnFloor(c, floorY, heightM) {
  if (!(c.dir[1] > 1e-3)) return null;
  const t = (floorY + heightM - c.origin[1]) / c.dir[1];
  if (!(t > 0)) return null;
  return [c.origin[0] + t * c.dir[0], floorY, c.origin[2] + t * c.dir[2]];
}

/**
 * Ceiling height from walls with a bottom tap on the real floor (or on the
 * wall's own surface) and their top corners. Null if no wall has both.
 * @returns {{heightM, taps, spreadCm} | null}
 */
export function cornerCeiling(taps, ceilingTaps, floorY) {
  const heights = [];
  const fromSurface = [];
  for (let w = 0; w < WALL_COUNT; w++) {
    const tops = ceilingTaps.filter((c) => c.wallIndex === w && c.dir[1] > 1e-3);
    const own = taps.filter((t) => t.wall === w);
    const floorTap = own.find((t) => !t.surfaceNormal && !isOnFurniture(t, floorY));
    const surfaceTap = own.find((t) => t.surfaceNormal);
    let point, dir, out;
    if (floorTap && tops.length >= 2) {
      // the wall's direction from its top corners, at any trial height:
      // scaling about the camera keeps directions
      const [a, b] = tops.map((c) => topCornerOnFloor(c, floorY, 2.7));
      if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < MIN_WALL_SPREAD_M) continue;
      dir = [(b[0] - a[0]) / len, (b[2] - a[2]) / len];
      point = floorTap.hit;
      out = heights;
    } else if (surfaceTap && tops.length >= 1) {
      dir = [-surfaceTap.surfaceNormal[1], surfaceTap.surfaceNormal[0]];
      point = surfaceTap.hit;
      out = fromSurface;
    } else {
      continue;
    }
    for (const c of tops) {
      const hit = rayPlaneIntersect(c.origin, c.dir, [point[0], floorY, point[2]], [-dir[1], 0, dir[0]], SECOND_CORNER_GRAZE_DEG);
      if (!hit) continue;
      const h = hit.point[1] - floorY;
      if (h >= CEILING_MIN_M && h <= CEILING_MAX_M) out.push(h);
    }
  }
  // floor taps first: a surface tap's direction is the phone's guess at the
  // wall's facing, less exact than two top corners
  const use = heights.length > 0 ? heights : fromSurface;
  if (use.length === 0) return null;
  return { heightM: median(use), taps: use.length, spreadCm: (Math.max(...use) - Math.min(...use)) * 100 };
}

/**
 * The floor height under one wall, from that wall's own floor taps as they
 * were when tapped (taken seconds before its top corners). A top corner is
 * measured against this, not the whole room's floor: on 1 Nov the phone's
 * idea of the floor moved 1.15 m between walls 3 and 4, and the room-wide
 * floor made the ceiling come out 2.06 m instead of 2.74 m.
 */
function wallFloorY(taps, wallIndex) {
  const ys = (taps ?? []).filter((t) => t.wall === wallIndex && !t.surfaceNormal).map((t) => t.hit[1]);
  return ys.length ? median(ys) : null;
}

// A ceiling outside this range is a tap that missed the wall-ceiling line.
const CEILING_MIN_M = 1.8;
const CEILING_MAX_M = 5.0;

/**
 * Ceiling height from taps aimed at the line where a wall meets the ceiling.
 * The wall's plane is known, so where the aiming line meets it is a point on
 * that line, and its height above the floor is the ceiling height. Several
 * taps give their median, and how far they spread.
 * A top corner tapped during a wall's own step is measured from THAT wall's
 * floor taps (see wallFloorY), so tracking that drifts between walls does
 * not move it; other taps from the room's floor.
 * @param taps the scan's floor taps, for each wall's own floor height
 * @returns {{heightM: number, taps: number, spreadCm: number} | null}
 */
export function ceilingFrom(fit, ceilingTaps, taps = []) {
  const heights = ceilingTaps
    .map((c) => {
      // taps made during a wall's own step carry its index; the room's names
      // for the walls are only known once all four are in
      const h = intersectWall(fit, c.wall ?? fit.labels[c.wallIndex], c.origin, c.dir, ON_KNOWN_WALL);
      if (!h) return null;
      const own = Number.isInteger(c.wallIndex) ? wallFloorY(taps, c.wallIndex) : null;
      return own !== null ? h.point[1] - own : toRoom(fit, h.point).y;
    })
    .filter((y) => y !== null && y >= CEILING_MIN_M && y <= CEILING_MAX_M);
  if (heights.length === 0) return null;
  return {
    heightM: median(heights),
    taps: heights.length,
    spreadCm: (Math.max(...heights) - Math.min(...heights)) * 100,
  };
}

/**
 * The guided scan: walls one by one, then any number of doors, windows and
 * furniture pieces in any order. Holds only plain data, so its state can be
 * saved and reloaded.
 *
 * Phases: 'walls', then 'extras' (doors, windows, furniture).
 * Undo always removes the most recent thing, across phases if needed, so the
 * tap list only ever shrinks from its end and tap indices (used for anchors)
 * never shift.
 */
export function createRoomScan(catalog = null) {
  let taps = [];           // floor taps, flat; wall taps carry their wall index
  let wallCount = 1;       // walls started so far
  let phase = 'walls';
  let openings = [];       // finished doors and windows
  let furniture = [];      // finished furniture pieces
  let history = [];        // 'opening' | 'furniture' | 'ceiling', in the order finished
  let ceiling = [];        // taps at the wall-ceiling line: {wall, origin, dir}
  let pending = null;      // the door, window or piece being marked now
  // the corner steps done on each wall, in order:
  // {step: 'bl'|'tl'|'tr'|'br', tap?: index, ray?: true, skipped?: true}
  let cornerLog = Array.from({ length: WALL_COUNT }, () => []);

  const current = () => wallCount - 1;
  const tapsOn = (i) => taps.filter((t) => t.wall === i);
  const result = () => scanResult({ taps, openings, furniture, ceiling }, catalog);
  const fit = () => result().fit;
  const nextCorner = () => CORNERS.find((c) => !cornerLog[current()].some((s) => s.step === c)) ?? null;
  const floorYOfWalls = () => {
    const ys = taps.filter((t) => Number.isInteger(t.wall) && !t.surfaceNormal).map((t) => finalPosition(t)[1]);
    return ys.length ? median(ys) : null;
  };

  /** Heights of wall i's top-corner taps, met with the vertical plane through its base line. */
  function topHeights(i) {
    const floor = roomFloorY(taps);
    // the wall's line from taps on the real floor (or its surface) only
    const real = tapsOn(i).filter((t) => floor === null || !isOnFurniture(t, floor));
    const fitted = wallLine((real.length > 0 ? real : tapsOn(i)).map(wallEntry));
    const floorY = floor ?? floorYOfWalls();
    if (!fitted || floorY === null) return [];
    const { point, dir } = fitted.line;
    return ceiling.filter((c) => c.wallIndex === i)
      .map((c) => rayPlaneIntersect(c.origin, c.dir, [point[0], floorY, point[1]], [-dir[1], 0, dir[0]], SECOND_CORNER_GRAZE_DEG))
      .filter(Boolean)
      .map((h) => h.point[1] - floorY)
      .filter((y) => y >= CEILING_MIN_M && y <= CEILING_MAX_M);
  }

  function finishPending() {
    const size = pending.size ? { size: pending.size } : {};
    if (pending.what === 'opening') {
      openings.push({ type: pending.type, wall: pending.wall, corners: pending.corners });
      history.push('opening');
    } else if (pending.kind === 'wall') {
      furniture.push({ type: pending.type, kind: 'wall', wall: pending.wall, corners: pending.corners, ...size });
      history.push('furniture');
    } else {
      const corner = pending.corner ? { corner: pending.corner } : {};
      furniture.push({ type: pending.type, kind: pending.kind, tapIdx: pending.tapIdx, ...corner, ...size });
      history.push('furniture');
    }
    pending = null;
  }

  function pushTap(hit, wall) {
    taps.push({
      ...makeTap({
        index: taps.length, timeMs: hit.timeMs, hit: hit.hit, cam: hit.cam,
        normalUp: hit.normalUp, reportedY: hit.reportedY,
      }),
      wall,
      // the phone's own floor height at the time, so furniture taps can be told apart later
      ...(Number.isFinite(hit.floorEstimate) ? { floorEstimate: hit.floorEstimate } : {}),
    });
    return taps.length - 1;
  }

  return {
    phase: () => phase,
    wallNumber: () => wallCount,
    tapCount: () => taps.length,
    pendingType: () => pending?.type ?? null,
    pendingKind: () => (pending ? (pending.what === 'furniture' ? pending.kind : pending.what) : null),

    /** Whether the next tap is a floor point (true) or an aimed corner (false). */
    wantsFloorTap: () => (phase === 'walls'
      ? nextCorner() !== 'tl' && nextCorner() !== 'tr'
      : pending?.what === 'furniture' && (pending.kind === 'one' || (pending.kind === 'standing' && pending.tapIdx.length === 0))),

    // ---- walls by corners ---------------------------------------------------
    //
    // Each wall: 1 bottom-left, 2 top-left, 3 top-right, 4 bottom-right.
    // Bottom corners are floor points on the wall's base (or one tap on the
    // wall itself when the floor there is hidden); the exact corner is not
    // needed, because room corners come from where wall lines meet. Top
    // corners are aiming lines, turned into the ceiling height once the
    // wall's base is known. Every step can be undone; top steps skipped.

    /** The current wall's next corner: 'bl' | 'tl' | 'tr' | 'br', or null when all four are done. */
    cornerStep: () => (phase === 'walls' ? nextCorner() : null),

    /** The current wall's steps: {bl, tl, tr, br} -> 'done' | 'skipped' | null. */
    cornerState() {
      const log = cornerLog[current()];
      return Object.fromEntries(CORNERS.map((c) => {
        const s = log.find((e) => e.step === c);
        return [c, s ? (s.skipped ? 'skipped' : 'done') : null];
      }));
    },

    /**
     * A bottom corner (step 1 or 4): a floor point on this wall's base, or,
     * with onWall, a tap on the wall's own surface above hidden floor.
     * @returns {{ok: boolean, index?: number, message?: string}}
     */
    addBottomCorner(hit, { onWall = false } = {}) {
      const step = nextCorner();
      if (phase !== 'walls' || (step !== 'bl' && step !== 'br')) {
        return { ok: false, message: step ? 'Aim UP at the top corner now (or Skip).' : 'This wall is done. Tap Next wall, or Redo wall.' };
      }
      if (step === 'br' && !onWall) {
        const bl = cornerLog[current()].find((s) => s.step === 'bl');
        const a = bl && !taps[bl.tap].surfaceNormal ? finalPosition(taps[bl.tap]) : null;
        if (a && Math.hypot(a[0] - hit.hit[0], a[2] - hit.hit[2]) < MIN_WALL_SPREAD_M) {
          return {
            ok: false,
            message: 'That is right next to the bottom-LEFT corner. Tap the bottom-RIGHT corner, at the other end of this wall.',
          };
        }
      }
      const index = onWall ? this.addWallSurfaceTap(hit) : this.addWallTap(hit);
      if (index === false) return { ok: false, message: 'That is not a wall. Aim at the floor where the wall meets it.' };
      cornerLog[current()].push({ step, tap: index });
      return { ok: true, index };
    },

    /**
     * A top corner (step 2 or 3), aimed at where the wall meets the ceiling.
     * @returns {{ok: boolean, message?: string}}
     */
    addTopCorner(ray) {
      const step = nextCorner();
      if (phase !== 'walls' || (step !== 'tl' && step !== 'tr')) return { ok: false, message: 'Tap a bottom corner now.' };
      const up = ray.dir[1] / Math.hypot(...ray.dir);
      if (up < Math.sin(5 * DEG)) {
        return { ok: false, message: 'Tilt the phone UP and aim the dot at the top corner, where this wall meets the ceiling. Or Skip.' };
      }
      ceiling.push({ wallIndex: current(), corner: step, origin: ray.origin, dir: ray.dir });
      cornerLog[current()].push({ step, ray: true });
      return { ok: true };
    },

    /** Skip a top corner (the ceiling is not visible). Bottom corners cannot be skipped. */
    skipCorner() {
      const step = nextCorner();
      if (phase !== 'walls' || (step !== 'tl' && step !== 'tr')) return false;
      cornerLog[current()].push({ step, skipped: true });
      return true;
    },

    /** Start the current wall again: its taps and top corners go. */
    redoWall() {
      if (phase !== 'walls') return false;
      const i = current();
      // the current wall's taps are the newest ones in the walls step
      taps = taps.filter((t) => t.wall !== i);
      ceiling = ceiling.filter((c) => c.wallIndex !== i);
      cornerLog[i] = [];
      return true;
    },

    /**
     * What a finished wall measured: the distance between its bottom corners
     * (about its length) and the ceiling from its top corners.
     * @returns {{lengthM: number | null, heightM: number | null}}
     */
    wallSummary(i = current()) {
      const floor = roomFloorY(taps);
      const own = cornerLog[i].filter((s) => s.tap !== undefined).map((s) => taps[s.tap]);
      // bottom corners on furniture: this wall is placed from its top
      // corners once the room is done, so nothing to say about it yet
      const onFurniture = floor === null ? 0 : own.filter((t) => isOnFurniture(t, floor)).length;
      if (onFurniture > 0) return { lengthM: null, heightM: null, onFurniture };
      const bottoms = own.map(finalPosition);
      const lengthM = bottoms.length === 2 ? Math.hypot(bottoms[0][0] - bottoms[1][0], bottoms[0][2] - bottoms[1][2]) : null;
      const h = topHeights(i);
      return { lengthM, heightM: h.length ? median(h) : null, onFurniture: 0 };
    },

    /**
     * After wall 4: does the room close? The last corner (wall 4 bottom-right)
     * coming back to the first (wall 1 bottom-left), or four walls that agree
     * as a rectangle.
     * @returns {null | {closed: boolean, gapM: number | null, message: string}}
     *   null until wall 4's corners are all done
     */
    closure() {
      if (phase !== 'walls' || wallCount < WALL_COUNT || nextCorner() !== null) return null;
      const f = fit();
      const first = cornerLog[0].find((s) => s.step === 'bl');
      const last = cornerLog[WALL_COUNT - 1].find((s) => s.step === 'br');
      const a = first ? finalPosition(taps[first.tap]) : null;
      const b = last ? finalPosition(taps[last.tap]) : null;
      const gapM = a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : null;
      if (!f.ok) return { closed: false, gapM, message: f.error };
      const closed = (gapM !== null && gapM <= CLOSE_GAP_M) || f.quality.verdict === 'consistent';
      return {
        closed,
        gapM,
        message: closed
          ? 'Room closed: the last corner meets the first.'
          : `The last corner is ${Math.round((gapM ?? 0) * 100)} cm from the first, and the walls do not agree as a rectangle. Redo wall 4 (or wall 1), or close anyway.`,
      };
    },

    /**
     * Close the room and move on to furniture, doors and windows. Only once
     * closure is detected, unless forced (the user chose "Close anyway").
     * @returns {{ok: boolean, message?: string}}
     */
    closeRoom({ force = false } = {}) {
      const c = this.closure();
      if (!c) return { ok: false, message: 'Finish all four corners of wall 4 first.' };
      if (!c.closed && !force) return { ok: false, message: c.message };
      const f = fit();
      if (!f.ok) return { ok: false, message: f.error };
      phase = 'extras';
      return { ok: true };
    },

    /** @returns {number | false} index of the tap (for its anchor), or false */
    addWallTap(hit) {
      if (phase !== 'walls') return false;
      return pushTap(hit, current());
    },

    /**
     * A tap on the current wall's own surface, above whatever stands in front
     * of it. One is enough to place the wall: the phone reports which way the
     * surface faces.
     * @param hit a hit whose `normal` is [nx, ny, nz] and roughly horizontal
     * @returns {number | false} index of the tap (for its anchor), or false
     */
    addWallSurfaceTap(hit) {
      if (phase !== 'walls') return false;
      const [nx, , nz] = hit.normal ?? [];
      const len = Math.hypot(nx, nz);
      if (!(len > 0.5)) return false; // not a wall: the surface faces up or down
      const index = pushTap(hit, current());
      taps[index].surfaceNormal = [nx / len, nz / len];
      return index;
    },

    setAnchored(index, position) {
      if (taps[index]) taps[index].anchored = position;
    },

    canFinishWall() {
      return wallLine(tapsOn(current()).map(wallEntry)) !== null;
    },

    /** @returns {{ok: boolean, message?: string}} */
    nextWall() {
      if (phase !== 'walls') return { ok: false, message: 'The walls are already done.' };
      if (!this.canFinishWall()) {
        return {
          ok: false,
          message: `Tap 2 floor points ${MIN_WALL_SPREAD_M * 100} cm or more apart along this wall, or 1 point on the wall itself, first.`,
        };
      }
      if (wallCount < WALL_COUNT) {
        wallCount += 1;
        return { ok: true };
      }
      const f = fit();
      if (!f.ok) return { ok: false, message: f.error };
      phase = 'extras';
      return { ok: true };
    },

    /** Whether the current wall has its base (line) and its top (ceiling) tap. */
    station() {
      return {
        wall: current(),
        base: this.canFinishWall(),
        top: ceiling.some((c) => c.wallIndex === current()),
      };
    },

    /**
     * During the walls step: a tap aimed at the line where the CURRENT wall
     * meets the ceiling. The room is not known yet, but this wall's line is,
     * so the aiming line is met with the vertical plane through it.
     * @returns {{ok: boolean, message?: string, heightM?: number}}
     */
    addWallTopPoint(ray) {
      if (phase !== 'walls') return { ok: false, message: 'Not during the walls step.' };
      const fitted = wallLine(tapsOn(current()).map(wallEntry));
      if (!fitted) return { ok: false, message: "Do this wall's base first (floor taps or a blue tap on the wall)." };
      const floorYs = taps.filter((t) => Number.isInteger(t.wall) && !t.surfaceNormal).map((t) => finalPosition(t)[1]);
      if (floorYs.length === 0) return { ok: false, message: 'Tap the floor along a wall first, so the floor height is known.' };
      const floorY = median(floorYs);
      const { point, dir } = fitted.line;
      const hit = rayPlaneIntersect(ray.origin, ray.dir, [point[0], floorY, point[1]], [-dir[1], 0, dir[0]], SECOND_CORNER_GRAZE_DEG);
      if (!hit) return { ok: false, message: 'That does not point at this wall. Aim at the top of the wall in front of you.' };
      const y = hit.point[1] - floorY;
      if (y < CEILING_MIN_M || y > CEILING_MAX_M) {
        return {
          ok: false,
          message: `That point is ${y.toFixed(2)} m up, which is not the ceiling. Aim exactly where this wall meets the ceiling.`,
        };
      }
      // one top tap per wall: a new one replaces the old
      ceiling = ceiling.filter((c) => c.wallIndex !== current());
      ceiling.push({ wallIndex: current(), origin: ray.origin, dir: ray.dir });
      return { ok: true, heightM: y };
    },

    /** Start a ceiling-height tap. */
    startCeiling() {
      if (phase !== 'extras') return false;
      pending = { what: 'ceiling' };
      return true;
    },

    /**
     * A tap aimed at the line where a wall meets the ceiling.
     * @returns {{ok: boolean, message?: string, heightM?: number}}
     */
    addCeilingPoint(ray) {
      if (phase !== 'extras' || pending?.what !== 'ceiling') return { ok: false, message: 'Tap Ceiling first.' };
      const f = fit();
      const hit = rayToWall(f, ray.origin, ray.dir);
      if (!hit) return { ok: false, message: 'That points at no wall. Aim at the top of a wall, where it meets the ceiling.' };
      const y = toRoom(f, hit.point).y;
      if (y < CEILING_MIN_M || y > CEILING_MAX_M) {
        return {
          ok: false,
          message: `That point is ${y.toFixed(2)} m up, which is not a ceiling. Aim exactly at the line where the wall meets the ceiling.`,
        };
      }
      ceiling.push({ wall: hit.wall, origin: ray.origin, dir: ray.dir });
      history.push('ceiling');
      pending = null;
      return { ok: true, heightM: y };
    },

    startOpening(type) {
      if (phase !== 'extras') return false;
      pending = { what: 'opening', type, wall: null, corners: [] };
      return true;
    },

    /**
     * Start marking a piece of furniture.
     * @param entry its catalog entry. Wall-mounted pieces: two aimed corners.
     *   Tall pieces (STANDING_TYPES): a floor corner, then an aimed top
     *   corner, like a door. Everything else: ONE tap anywhere on it.
     */
    startFurniture(entry, size = null) {
      if (phase !== 'extras' || !entry) return false;
      const name = size?.name ? `${entry.name} (${size.name})` : entry.name;
      const kind = entry.wallMounted ? 'wall' : STANDING_TYPES.has(entry.id) ? 'standing' : 'one';
      pending = kind === 'wall'
        ? { what: 'furniture', kind, type: entry.id, name, wall: null, corners: [] }
        : { what: 'furniture', kind, type: entry.id, name, tapIdx: [] };
      if (size) pending.size = size;
      return true;
    },

    /** An aimed corner of a door, window or wall-mounted piece. */
    addOpeningCorner(ray) {
      if (phase !== 'extras' || !pending || pending.tapIdx) {
        return { ok: false, message: 'Choose Door, Window or a piece of furniture first.' };
      }
      const f = fit();
      // Once the first corner has fixed the wall, the second only has to meet
      // that wall's plane: a looser test, because a wall placed a little
      // short (taps in front of furniture) must not refuse a real corner. On
      // 27 Oct a door's second corner was refused with the strict test.
      // First corner: the wall the aim meets; if a slightly-off room fit
      // makes it miss every wall (1 Nov: a door corner aimed right at the
      // door was refused), the nearest wall with the looser test.
      const hit = pending.wall
        ? intersectWall(f, pending.wall, ray.origin, ray.dir, ON_KNOWN_WALL)
        : rayToWall(f, ray.origin, ray.dir) ?? rayToWallLoose(f, ray.origin, ray.dir);
      if (!hit) {
        return {
          ok: false,
          message: pending.wall
            ? `That corner is not on the same wall as the first one (${describeWall(pending.wall)}). Aim at the opposite corner of the same ${pending.what === 'opening' ? pending.type : 'piece'}.`
            : 'That points at no wall. Aim the centre of the screen at a corner of it.',
        };
      }
      if (pending.corners.length === 1) {
        // Two taps on (nearly) the same corner give an opening a few cm wide:
        // on 27 Oct a door came out 6 cm wide this way. Refuse it here, while
        // the user can still aim at the right corner.
        const first = intersectWall(f, pending.wall, pending.corners[0].origin, pending.corners[0].dir, ON_KNOWN_WALL);
        const apart = first
          ? Math.abs(alongWall(pending.wall, toRoom(f, hit.point)) - alongWall(pending.wall, toRoom(f, first.point)))
          : 0;
        const minimum = pending.what === 'opening' ? MIN_OPENING_WIDTH_M : MIN_WALL_ITEM_WIDTH_M;
        if (apart < minimum) {
          return {
            ok: false,
            message: `The two corners are only ${Math.round(apart * 100)} cm apart along the wall. `
              + 'Aim at the OPPOSITE corner, on the other side.',
          };
        }
      }
      pending.wall = hit.wall;
      pending.corners.push({ origin: ray.origin, dir: ray.dir });
      if (pending.corners.length === 2) finishPending();
      return { ok: true };
    },

    /**
     * A tap on the piece being marked: its one tap, or a tall piece's floor
     * corner. A one-tap piece is finished by it.
     * @returns {number | false} index of the tap (for its anchor), or false
     */
    addFurnitureTap(hit) {
      if (phase !== 'extras' || !pending?.tapIdx) return false;
      if (pending.kind === 'standing' && pending.tapIdx.length > 0) return false;
      const index = pushTap(hit, null);
      pending.tapIdx.push(index);
      if (pending.kind === 'one' || (pending.kind === 'floor' && pending.tapIdx.length === 3)) finishPending();
      return index;
    },

    /**
     * A tall piece's top-right corner, aimed at, after its bottom-left floor corner.
     * @returns {{ok: boolean, message?: string}}
     */
    addStandingCorner(ray) {
      if (phase !== 'extras' || pending?.kind !== 'standing' || pending.tapIdx.length !== 1) {
        return { ok: false, message: 'Tap its bottom-left corner on the floor first.' };
      }
      const entry = catalog?.[pending.type];
      const f = fit();
      if (entry && f.ok) {
        const sized = pending.size ? { ...entry, ...pending.size } : entry;
        const r = standingItemFromCorners(f, sized, finalPosition(taps[pending.tapIdx[0]]), ray);
        if (!r.item) return { ok: false, message: 'That does not meet the front of it. Aim the dot at its TOP-RIGHT corner.' };
        if (r.item.width < 0.15) {
          return { ok: false, message: 'That is right above the first corner. Aim at the TOP-RIGHT corner, on the other side.' };
        }
      }
      pending.corner = { origin: ray.origin, dir: ray.dir };
      finishPending();
      return { ok: true };
    },

    /** A floor piece with both front corners can finish without a back point. */
    canFinishItem: () => pending?.kind === 'floor' && pending.tapIdx.length >= 2,

    finishItem() {
      if (!this.canFinishItem()) return false;
      finishPending();
      return true;
    },

    /** Step back one action, across phases if needed. */
    undo() {
      if (phase === 'extras') {
        if (pending) {
          if (pending.tapIdx && pending.tapIdx.length > 0) {
            pending.tapIdx.pop();
            taps.pop();
          } else if (pending.corners && pending.corners.length > 0) {
            pending.corners.pop();
            if (pending.corners.length === 0) pending.wall = null;
          } else {
            pending = null;
          }
        } else if (history.length > 0) {
          const last = history.pop();
          if (last === 'opening') {
            openings.pop();
          } else if (last === 'ceiling') {
            ceiling.pop();
          } else {
            const f = furniture.pop();
            // a floor piece's taps are the newest ones, because undo is
            // last-in first-out
            if (f.tapIdx) taps.splice(taps.length - f.tapIdx.length, f.tapIdx.length);
          }
        } else {
          phase = 'walls';
        }
        return;
      }
      // corner steps come off in the order they were done
      const log = cornerLog[current()];
      if (log.length > 0) {
        const s = log.pop();
        if (s.tap !== undefined) taps.splice(s.tap, 1); // the newest tap
        else if (s.ray) ceiling.splice(ceiling.map((c) => c.wallIndex).lastIndexOf(current()), 1);
        return;
      }
      const topHere = ceiling.map((c) => c.wallIndex).lastIndexOf(current());
      if (topHere >= 0) {
        ceiling.splice(topHere, 1); // the wall's top tap comes after its base
      } else if (tapsOn(current()).length > 0) {
        taps.pop(); // the current wall's taps are the newest
      } else if (wallCount > 1) {
        wallCount -= 1;
      }
    },

    clear() {
      taps = [];
      wallCount = 1;
      phase = 'walls';
      openings = [];
      furniture = [];
      history = [];
      ceiling = [];
      pending = null;
      cornerLog = Array.from({ length: WALL_COUNT }, () => []);
    },

    /** What to save: plain data, enough to recompute everything. */
    saved: () => ({ taps, openings, furniture, ceiling }),
    result,

    /** Where the pending piece's taps or corners are so far, for drawing. */
    pendingPoints() {
      if (!pending) return [];
      if (pending.tapIdx) return pending.tapIdx.map((i) => finalPosition(taps[i]));
      const f = fit();
      return pending.corners
        .map((c) => intersectWall(f, pending.wall, c.origin, c.dir, ON_KNOWN_WALL))
        .filter(Boolean)
        .map((h) => h.point);
    },

    /** The pending opening's first corner, for drawing. */
    pendingCorner() {
      if (!pending || pending.tapIdx || pending.corners.length === 0) return null;
      const hit = intersectWall(fit(), pending.wall, pending.corners[0].origin, pending.corners[0].dir, ON_KNOWN_WALL);
      return hit ? hit.point : null;
    },

    prompt() {
      if (phase === 'walls') {
        const which = wallCount === 1 ? 'Wall 1 (door wall)' : `Wall ${wallCount}`;
        const step = nextCorner();
        if (step === 'bl') return `${which}: tap corner 1, bottom-left (floor)`;
        if (step === 'tl') return `${which}: tilt up, tap corner 2, top-left (ceiling)`;
        if (step === 'tr') return `${which}: tap corner 3, top-right (ceiling)`;
        if (step === 'br') return `${which}: tap corner 4, bottom-right (floor)`;
        return wallCount < WALL_COUNT
          ? `Wall ${wallCount} done. Tap Next wall, turn right`
          : 'Wall 4 done.';
      }
      if (!pending) return 'Room done ✓ Add doors, windows and furniture, then Finish';
      if (pending.what === 'ceiling') return 'Ceiling: aim the centre of the screen at the line where a wall meets the ceiling, and tap';
      if (pending.what === 'opening') {
        const what = pending.type === 'door' ? 'Door' : 'Window';
        return pending.corners.length === 0
          ? `${what}: tap its bottom-left corner`
          : `${what}: now its top-right corner`;
      }
      if (pending.kind === 'wall') {
        return pending.corners.length === 0
          ? `${pending.name}: tap its bottom-left corner`
          : `${pending.name}: now its top-right corner`;
      }
      if (pending.kind === 'one') return `${pending.name}: tap once on it`;
      if (pending.kind === 'standing') {
        return pending.tapIdx.length === 0
          ? `${pending.name}: tap its bottom-left corner (floor)`
          : `${pending.name}: now its top-right corner`;
      }
      const n = pending.tapIdx.length;
      if (n === 0) return `${pending.name}: stand in front of it and tap its FRONT-LEFT corner (on the floor, or on its top)`;
      if (n === 1) return `${pending.name}: now tap its FRONT-RIGHT corner`;
      return `${pending.name}: tap its BACK edge, or Done to use the standard depth`;
    },
  };
}
