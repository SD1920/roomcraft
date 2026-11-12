import { describe, it, expect } from 'vitest';
import {
  makeTap, segmentCount, segmentIndices, segmentRows, allRows, outlineGap,
  finalPosition, summarise, rowsToCsv, floorStepM, FLOOR_STEP_LIMIT_M, dropToFloor, estimateFloorHeight,
} from '../src/roomscan/ar/tap_log.js';

const DEG = Math.PI / 180;

// a tap seen from a phone 1.4 m above a floor that is NOT at height zero
function tap(index, x, z, { floorY = -1.2, cam = [0.3, 0.2, -1] } = {}) {
  return makeTap({ index, timeMs: index * 1000.4, hit: [x, floorY, z], cam, normalUp: 1 });
}

describe('makeTap', () => {
  it('derives range, look-down angle and surface tilt', () => {
    const t = makeTap({
      index: 0, timeMs: 12.6, hit: [0.3, -1.2, 0.4], cam: [0.3, 0.2, -1],
      normalUp: Math.cos(10 * DEG),
    });
    expect(t.rangeM).toBeCloseTo(Math.hypot(1.4, 1.4), 9);
    expect(t.depressionDeg).toBeCloseTo(45, 9);
    expect(t.normalTiltDeg).toBeCloseTo(10, 6);
    expect(t.timeMs).toBe(13);
  });
});

describe('segments', () => {
  it('pairs taps two at a time and ignores an odd one', () => {
    expect(segmentIndices(5, 'pairs')).toEqual([[0, 1], [2, 3]]);
    expect(segmentCount(5, 'pairs')).toBe(2);
    expect(segmentCount(1, 'pairs')).toBe(0);
  });

  it('chains every tap to the one before in an outline', () => {
    expect(segmentIndices(5, 'outline')).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(segmentCount(5, 'outline')).toBe(4);
    expect(segmentCount(1, 'outline')).toBe(0);
    expect(segmentCount(0, 'outline')).toBe(0);
  });

  it('agrees between the count and the index list in both modes', () => {
    for (const mode of ['pairs', 'outline']) {
      for (let n = 0; n < 9; n++) {
        expect(segmentIndices(n, mode)).toHaveLength(segmentCount(n, mode));
      }
    }
  });

  it('treats a log with no mode as pairs', () => {
    expect(segmentIndices(4)).toEqual([[0, 1], [2, 3]]);
  });
});

describe('segmentRows in pairs mode', () => {
  // pair 1: 2.013 m apart along an oblique direction; pair 2: a 3-4-5 scaled to 1 m
  const dir = [Math.cos(28 * DEG), Math.sin(28 * DEG)];
  const taps = [
    tap(0, 1.1, -0.7),
    tap(1, 1.1 + 2.013 * dir[0], -0.7 + 2.013 * dir[1]),
    tap(2, -2, 3),
    tap(3, -1.4, 3.8),
    tap(4, 5, 5), // unpaired: must not produce a row
  ];

  it('makes one row per completed pair', () => {
    expect(segmentRows(taps)).toHaveLength(2);
  });

  it('reports error only for a line with a tape length', () => {
    const [first, second] = segmentRows(taps, { 0: 2 });
    expect(first.measuredM).toBeCloseTo(2.013, 9);
    expect(first.errorCm).toBeCloseTo(1.3, 6);
    expect(first.errorPct).toBeCloseTo(0.65, 6);
    expect(second.measuredM).toBeCloseTo(1, 9);
    expect(second.trueM).toBeNull();
    expect(second.errorCm).toBeNull();
    expect(second.errorPct).toBeNull();
  });

  it('gives a negative error when the measurement is short', () => {
    const [, second] = segmentRows(taps, { 1: 1.02 });
    expect(second.errorCm).toBeCloseTo(-2, 6);
  });

  it('measures in plan, keeps the 3D length, and exposes the height step', () => {
    const stepped = [tap(0, 0, 0), tap(1, 0.4, 0, { floorY: -0.9 })];
    const [row] = segmentRows(stepped);
    expect(row.measuredM).toBeCloseTo(0.4, 9);
    expect(row.atTapM).toBeCloseTo(0.4, 9);
    expect(row.measured3dM).toBeCloseTo(0.5, 9);
    expect(row.heightStepCm).toBeCloseTo(30, 6);
  });

  it('keeps the shallower of the two look-down angles', () => {
    const near = tap(0, 0.3, 0.4);            // 45 degrees
    const far = tap(1, 0.3, 13);              // far away, shallow
    const [row] = segmentRows([near, far]);
    expect(row.minDepressionDeg).toBeCloseTo(far.depressionDeg, 9);
    expect(row.minDepressionDeg).toBeLessThan(10);
  });
});

describe('segmentRows in outline mode', () => {
  // a 0.6 x 0.8 rectangle traced corner to corner and closed on the start
  const corners = [[2, 1], [2.6, 1], [2.6, 1.8], [2, 1.8], [2, 1]];
  const taps = corners.map(([x, z], i) => tap(i, x, z));

  it('measures every side, including the one that closes the shape', () => {
    const rows = segmentRows(taps, {}, 'outline');
    expect(rows.map((r) => r.segment)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => +r.measuredM.toFixed(6))).toEqual([0.6, 0.8, 0.6, 0.8]);
  });

  it('tags a side by its own number, not by a pair number', () => {
    const rows = segmentRows(taps, { 1: 0.79 }, 'outline');
    expect(rows[0].errorCm).toBeNull();
    expect(rows[1].errorCm).toBeCloseTo(1, 6);
    expect(rows[2].errorCm).toBeNull();
  });
});

describe('anchored positions', () => {
  const a = tap(0, 0, 0), b = tap(1, 0.6, 0);

  it('falls back to the at-tap position when a tap has no anchor', () => {
    expect(finalPosition(a)).toBe(a.hit);
    const [row] = segmentRows([a, b]);
    expect(row.measuredM).toBeCloseTo(row.atTapM, 12);
  });

  it('measures from the anchored position and keeps the at-tap length', () => {
    const moved = { ...b, anchored: [0.63, -1.2, 0.04] };
    const [row] = segmentRows([a, moved], { 0: 0.6 });
    expect(row.atTapM).toBeCloseTo(0.6, 9);
    expect(row.measuredM).toBeCloseTo(Math.hypot(0.63, 0.04), 9);
    // the error is judged on the final position, which is what gets drawn
    expect(row.errorCm).toBeCloseTo((Math.hypot(0.63, 0.04) - 0.6) * 100, 6);
  });

  it('never mutates the at-tap record', () => {
    const before = [...b.hit];
    segmentRows([a, { ...b, anchored: [9, 9, 9] }]);
    expect(b.hit).toEqual(before);
  });
});

describe('outlineGap', () => {
  const trace = (pts) => pts.map(([x, z], i) => tap(i, x, z));

  it('is the distance from the last tap back to the first', () => {
    const s = { mode: 'outline', taps: trace([[1, 1], [5, 1], [5, 4], [1, 4], [1.03, 1.04]]) };
    expect(outlineGap(s)).toBeCloseTo(0.05, 9);
  });

  it('uses anchored positions when they exist', () => {
    const taps = trace([[1, 1], [5, 1], [5, 4], [1.03, 1.04]]);
    taps[3] = { ...taps[3], anchored: [1, -1.2, 1] };
    expect(outlineGap({ mode: 'outline', taps })).toBeCloseTo(0, 9);
  });

  it('is null for pairs and for an outline too short to close', () => {
    expect(outlineGap({ mode: 'pairs', taps: trace([[0, 0], [1, 0], [1, 1], [0, 0]]) })).toBeNull();
    expect(outlineGap({ taps: trace([[0, 0], [1, 0], [1, 1], [0, 0]]) })).toBeNull();
    expect(outlineGap({ mode: 'outline', taps: trace([[0, 0], [1, 0]]) })).toBeNull();
  });
});

describe('allRows', () => {
  it('never joins a tap from one session to a tap from another', () => {
    const sessions = [
      { taps: [tap(0, 0, 0), tap(1, 1, 0), tap(2, 9, 9)], trueM: { 0: 1 } },
      { taps: [tap(0, 0, 0), tap(1, 0, 2)], trueM: {} },
    ];
    const rows = allRows(sessions);
    expect(rows.map((r) => [r.session, r.segment])).toEqual([[1, 1], [2, 1]]);
    expect(rows[1].measuredM).toBeCloseTo(2, 9);
  });

  it('uses each session\'s own mode', () => {
    const three = [tap(0, 0, 0), tap(1, 1, 0), tap(2, 1, 1)];
    const rows = allRows([
      { mode: 'pairs', taps: three, trueM: {} },
      { mode: 'outline', taps: three, trueM: {} },
    ]);
    expect(rows.map((r) => r.session)).toEqual([1, 2, 2]);
  });
});

describe('summarise', () => {
  const row = (errorCm, trueM = 2) => ({
    errorCm, errorPct: errorCm === null ? null : errorCm / trueM,
  });

  it('returns null when nothing has a tape length', () => {
    expect(summarise([row(null), row(null)])).toBeNull();
    expect(summarise([])).toBeNull();
  });

  it('uses the median, so one bad tap does not set the headline', () => {
    const s = summarise([row(1), row(-2), row(1.5), row(40), row(null)]);
    expect(s.n).toBe(4);
    expect(s.medianAbsCm).toBeCloseTo(1.75, 9);
    expect(s.maxAbsCm).toBeCloseTo(40, 9);
  });

  it('takes the middle value of an odd count, whatever the input order', () => {
    const s = summarise([row(5), row(-1), row(3)]);
    expect(s.medianAbsCm).toBeCloseTo(3, 9);
    expect(s.medianAbsPct).toBeCloseTo(1.5, 9);
  });
});

describe('rowsToCsv', () => {
  it('writes a header and leaves untagged cells empty', () => {
    const rows = allRows([{
      taps: [tap(0, 0, 0), tap(1, 2.013, 0), tap(2, 0, 0), tap(3, 0, 1)],
      trueM: { 0: 2 },
    }]);
    const lines = rowsToCsv(rows).trimEnd().split('\n');
    expect(lines[0]).toBe(
      'session,segment,trueM,measuredM,atTapM,measured3dM,errorCm,errorPct,meanRangeM,minDepressionDeg,heightStepCm',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('1,1,2.000,2.0130,2.0130,2.0130,1.30,0.65,')).toBe(true);
    expect(lines[2].startsWith('1,2,,1.0000,1.0000,1.0000,,,')).toBe(true);
  });
});

describe('dropToFloor', () => {
  // phone 1.1 m above a floor at -1.2, aiming down at 33 degrees: the hit
  // landed on a bed top 48 cm up; the floor point is further along the line
  const origin = [0.4, -0.1, 0.2];
  const down = 33 * Math.PI / 180;
  const dir = [Math.cos(down) * 0.6, -Math.sin(down), Math.cos(down) * 0.8];

  it('follows the aiming line down to the floor', () => {
    const p = dropToFloor({ origin, dir }, -1.2);
    expect(p[1]).toBe(-1.2);
    const horiz = 1.1 / Math.tan(down);
    expect(p[0]).toBeCloseTo(0.4 + horiz * 0.6, 9);
    expect(p[2]).toBeCloseTo(0.2 + horiz * 0.8, 9);
  });

  it('does not care how long the direction vector is', () => {
    const a = dropToFloor({ origin, dir }, -1.2);
    const b = dropToFloor({ origin, dir: dir.map((v) => v * 9) }, -1.2);
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9));
  });

  it('refuses a line that is nearly flat or points up', () => {
    expect(dropToFloor({ origin, dir: [1, -0.02, 0] }, -1.2)).toBeNull();
    expect(dropToFloor({ origin, dir: [1, 0.3, 0] }, -1.2)).toBeNull();
  });

  it('refuses a floor that is above the phone', () => {
    expect(dropToFloor({ origin, dir }, 0.5)).toBeNull();
  });
});

describe('floorStepM', () => {
  const taps = [tap(0, 0, 0), tap(1, 1, 0), tap(2, 2, 0, { floorY: -1.15 })];

  it('is null with nothing to compare against', () => {
    expect(floorStepM([], -1.2)).toBeNull();
  });

  it('measures from the median height, so one odd tap does not move the floor', () => {
    // heights -1.2, -1.2, -1.15: median -1.2
    expect(floorStepM(taps, -0.6)).toBeCloseTo(0.6, 9);
    expect(floorStepM(taps, -1.25)).toBeCloseTo(-0.05, 9);
  });

  it('separates furniture from floor noise at the chosen limit', () => {
    expect(Math.abs(floorStepM(taps, -1.2 + 0.26))).toBeLessThan(FLOOR_STEP_LIMIT_M);
    expect(Math.abs(floorStepM(taps, -1.2 + 0.4))).toBeGreaterThan(FLOOR_STEP_LIMIT_M);
  });

  it('uses anchored heights when a tap has one', () => {
    const moved = [{ ...taps[0], anchored: [0, -0.5, 0] }];
    expect(floorStepM(moved, -0.5)).toBeCloseTo(0, 9);
  });
});

describe('estimateFloorHeight', () => {
  const many = (y, n, jitter = 0.01) => Array.from({ length: n }, (_, i) => y + ((i % 5) - 2) * jitter / 2);

  it('waits until enough level hits agree', () => {
    expect(estimateFloorHeight(many(-1.2, 19))).toBeNull();
    expect(estimateFloorHeight(many(-1.2, 20))).toBeCloseTo(-1.2, 2);
  });

  it('picks the floor, not the bed, desk or box the user looked at more', () => {
    const ys = [...many(-0.65, 300), ...many(-0.45, 200), ...many(-0.2, 100), ...many(-1.2, 40)];
    expect(estimateFloorHeight(ys)).toBeCloseTo(-1.2, 2);
  });

  it('ignores a few stray hits below the floor', () => {
    const ys = [-1.9, -1.75, -1.6, ...many(-1.2, 60), ...many(-0.6, 200)];
    expect(estimateFloorHeight(ys)).toBeCloseTo(-1.2, 2);
  });

  it('gives nothing when no height has enough support', () => {
    expect(estimateFloorHeight([-1.2, -1.1, -1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])).toBeNull();
  });
});
