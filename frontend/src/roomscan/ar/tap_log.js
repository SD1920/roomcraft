// The record kept for every tap, and the tables built from it.
//
// Pure functions, no browser or three.js: the same code that fills the results
// table on the phone is what the tests check on the laptop.
//
// Taps join into segments in one of two ways:
//   'pairs'    0-1, 2-3, 4-5 ...  separate measurements, for a tape check
//   'outline'  0-1, 1-2, 2-3 ...  one connected line, for tracing a shape
// `trueM` maps a segment number to the tape-measure length it was tagged with.
//
// Every tap has `hit`, where the point was when it was tapped. It may also
// have `anchored`, where the phone's tracking says that same physical point is
// now, after it has corrected its own map. Lengths use `anchored` when present
// and the at-tap length is kept alongside, so one run shows whether anchoring
// helped without needing a second run to compare against.
//
// A log holds several sessions and they are never merged: every AR session
// has its own origin, so coordinates from two sessions do not share a frame.

import { depressionAngleDeg } from '../geometry/floor.js';

const DEG = Math.PI / 180;

export const MODES = ['pairs', 'outline'];

function dist3(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

// Lengths on the floor are measured IN PLAN, ignoring height. The floor is
// flat, but the phone reports each tap at its own height, and that error went
// straight into 3D lengths. Measured on 27 Oct 2026: two lines whose ends were
// reported 58 and 62 cm apart in height came out +6.4 and +5.5 cm long in 3D,
// and +0.7 and -1.3 cm in plan. Over the 8 anchored lines before that, plan
// brought the median error from 3.25 to 2.04 cm.
function distPlan(a, b) {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

// A floor tap whose height is this far from the other taps is not on the
// floor. Chosen between what has been measured: reported floor heights on a
// flat floor varied by up to 26 cm, and the lowest furniture tops (beds,
// sofas, low tables) are about 40 cm. On 27 Oct two corners came back 60 cm
// up, on furniture, and one line built on them was 31 cm short.
export const FLOOR_STEP_LIMIT_M = 0.3;

/**
 * Move a tap the phone reported off the floor down onto the floor, along the
 * line the user was aiming. When the phone's hit lands on a bed or table top,
 * the floor point the user meant is further along that same line.
 * @param ray {origin, dir} through the centre of the screen at the tap
 * @param floorY height of the floor the other taps found
 * @returns {number[] | null} the point on the floor, or null if the line
 *   does not meet the floor steeply enough to trust
 */
export function dropToFloor(ray, floorY) {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return null;
  // must point down at least 5 degrees, and the floor must be below the phone
  if (-dy / len < Math.sin(5 * DEG) || oy <= floorY) return null;
  const t = (floorY - oy) / dy;
  return [ox + t * dx, floorY, oz + t * dz];
}

/**
 * How far a new point's height is from the floor the other taps found.
 * @returns {number | null} metres, positive = above; null with no other taps
 */
export function floorStepM(taps, y) {
  const floor = floorHeightM(taps);
  return floor === null ? null : y - floor;
}

/**
 * The floor's height from every level surface the reticle has passed over.
 *
 * The phone calls any flat surface "level": the floor, a bed top, a desk, a
 * box on a desk. On 27 Oct a scan's floor taps varied by 50 cm in height and
 * the room came out 2 m too big. The floor is the LOWEST of those surfaces,
 * and the one the reticle crosses again and again while the user moves, so
 * it is the lowest height that many samples agree on. A single low outlier
 * is not enough: it takes MIN_SAMPLES within BAND_M of each other.
 * @param ys heights of level hits seen so far
 * @returns {number | null} null until enough agree
 */
export function estimateFloorHeight(ys, { bandM = 0.05, minSamples = 20 } = {}) {
  if (!ys || ys.length < minSamples) return null;
  const v = [...ys].sort((a, b) => a - b);
  let j = 0;
  for (let i = 0; i < v.length; i++) {
    if (j < i) j = i;
    while (j + 1 < v.length && v[j + 1] - v[i] <= bandM) j++;
    if (j - i + 1 >= minSamples) {
      const window = v.slice(i, j + 1);
      return window[window.length >> 1];
    }
  }
  return null;
}

/** Height of the floor the taps found: their median, or null with no taps. */
export function floorHeightM(taps) {
  if (!taps || taps.length === 0) return null;
  const ys = taps.map((t) => finalPosition(t)[1]).sort((a, b) => a - b);
  const mid = ys.length >> 1;
  return ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
}

/** Where a tapped point is now: its anchored position if it has one. */
export function finalPosition(tap) {
  return tap.anchored ?? tap.hit;
}

/**
 * @param hit [x, y, z] of the surface point
 * @param cam [x, y, z] of the phone at the moment of the tap
 * @param normalUp y component of the surface normal (1 = perfectly level)
 */
export function makeTap({ index, timeMs, hit, cam, normalUp, reportedY }) {
  return {
    index,
    timeMs: Math.round(timeMs),
    hit,
    cam,
    rangeM: dist3(cam, hit),
    depressionDeg: depressionAngleDeg(cam, hit),
    // kept so the floor filter's tolerance can be revisited from real data
    normalTiltDeg: Math.acos(Math.min(1, Math.abs(normalUp))) / DEG,
    // set when the user kept a point the phone reported off the floor and it
    // was moved down onto the floor: the height the phone had reported
    ...(reportedY !== undefined ? { reportedY } : {}),
  };
}

/** Number of segments that `count` taps make in the given mode. */
export function segmentCount(count, mode = 'pairs') {
  return mode === 'outline' ? Math.max(0, count - 1) : Math.floor(count / 2);
}

/** Tap index pairs [from, to] for each segment. */
export function segmentIndices(count, mode = 'pairs') {
  const out = [];
  const step = mode === 'outline' ? 1 : 2;
  for (let k = 0; k + 1 < count; k += step) out.push([k, k + 1]);
  return out;
}

/**
 * One row per segment. Error columns are null until the segment has been
 * tagged with its true length -- an untagged one has no error to report.
 */
export function segmentRows(taps, trueM = {}, mode = 'pairs') {
  return segmentIndices(taps.length, mode).map(([i, j], k) => {
    const a = taps[i], b = taps[j];
    const pa = finalPosition(a), pb = finalPosition(b);
    const measuredM = distPlan(pa, pb);
    const t = trueM[k] ?? null;
    return {
      segment: k + 1,
      trueM: t,
      measuredM,
      atTapM: distPlan(a.hit, b.hit),
      // kept so the plan-versus-3D choice can be re-checked on any log
      measured3dM: dist3(pa, pb),
      errorCm: t === null ? null : (measuredM - t) * 100,
      errorPct: t === null ? null : ((measuredM - t) / t) * 100,
      meanRangeM: (a.rangeM + b.rangeM) / 2,
      minDepressionDeg: Math.min(a.depressionDeg, b.depressionDeg),
      // a large height step means one tap landed on something that is not floor
      heightStepCm: Math.abs(pa[1] - pb[1]) * 100,
    };
  });
}

/** Rows for every session in a log, each tagged with its session number. */
export function allRows(sessions) {
  return sessions.flatMap((s, i) => segmentRows(s.taps, s.trueM, s.mode)
    .map((row) => ({ session: i + 1, ...row })));
}

/**
 * For an outline: how far the last tap is from the first. When the user ends
 * by tapping the starting point again this is the tracking drift over the
 * whole trace, measured with no tape. It means nothing if they did not.
 * @returns {number | null} metres
 */
export function outlineGap(session) {
  if (session.mode !== 'outline' || session.taps.length < 3) return null;
  const taps = session.taps;
  return distPlan(finalPosition(taps[0]), finalPosition(taps[taps.length - 1]));
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Error summary over the rows that have a true length. Median rather than
 * mean: one tap on a chair leg should not set the headline number.
 * @returns {{n:number, medianAbsCm:number, maxAbsCm:number, medianAbsPct:number} | null}
 */
export function summarise(rows) {
  const tagged = rows.filter((r) => r.errorCm !== null);
  if (tagged.length === 0) return null;
  const absCm = tagged.map((r) => Math.abs(r.errorCm));
  return {
    n: tagged.length,
    medianAbsCm: median(absCm),
    maxAbsCm: Math.max(...absCm),
    medianAbsPct: median(tagged.map((r) => Math.abs(r.errorPct))),
  };
}

const CSV_COLUMNS = [
  ['session', 0], ['segment', 0], ['trueM', 3], ['measuredM', 4], ['atTapM', 4], ['measured3dM', 4],
  ['errorCm', 2], ['errorPct', 2], ['meanRangeM', 2], ['minDepressionDeg', 1],
  ['heightStepCm', 1],
];

export function rowsToCsv(rows) {
  const head = CSV_COLUMNS.map(([name]) => name).join(',');
  const body = rows.map((r) => CSV_COLUMNS
    .map(([name, digits]) => (r[name] === null || r[name] === undefined ? '' : r[name].toFixed(digits)))
    .join(','));
  return [head, ...body].join('\n') + '\n';
}
