import { describe, it, expect } from 'vitest';
import {
  distance, fitLine2D, intersectLines2D, signedArea, polygonArea,
  loopGap, depressionAngleDeg, toRoomFrame,
} from '../src/roomscan/geometry/floor.js';

// Test shapes are deliberately off-centre, rotated and asymmetric. A square
// centred on the origin gives the right answer under a swapped axis, a flipped
// sign or a mirrored frame, so it proves very little.

const DEG = Math.PI / 180;

function rotate([x, z], deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c * x - s * z, s * x + c * z];
}

function move(poly, deg, [tx, tz]) {
  return poly.map((p) => {
    const [x, z] = rotate(p, deg);
    return [x + tx, z + tz];
  });
}

// L-shaped room, 4 x 3 m with a 1.5 x 1 m notch out of one corner: area 10.5
const L_ROOM = [[0, 0], [4, 0], [4, 2], [2.5, 2], [2.5, 3], [0, 3]];
const L_AREA = 10.5;

function pointsOnLine(origin, deg, ts, offsets = []) {
  const d = [Math.cos(deg * DEG), Math.sin(deg * DEG)];
  const n = [-d[1], d[0]];
  return ts.map((t, i) => {
    const e = offsets[i] ?? 0;
    return [origin[0] + t * d[0] + e * n[0], origin[1] + t * d[1] + e * n[1]];
  });
}

// direction of a line is only defined up to sign
function parallel(a, b) {
  return Math.abs(a[0] * b[1] - a[1] * b[0]);
}

describe('distance', () => {
  it('measures an off-centre 3-4-5', () => {
    expect(distance([-1.5, 2], [1.5, 6])).toBeCloseTo(5, 12);
  });
});

describe('fitLine2D', () => {
  it('recovers an oblique line exactly', () => {
    const line = fitLine2D(pointsOnLine([2, -1], 30, [-1, 0.4, 2.2, 3]));
    expect(parallel(line.dir, [Math.cos(30 * DEG), Math.sin(30 * DEG)])).toBeLessThan(1e-9);
    expect(line.rms).toBeLessThan(1e-9);
    // the returned point must lie on the true line
    const off = (line.point[0] - 2) * -Math.sin(30 * DEG) + (line.point[1] + 1) * Math.cos(30 * DEG);
    expect(Math.abs(off)).toBeLessThan(1e-9);
  });

  it('handles a wall parallel to the z axis', () => {
    const line = fitLine2D([[3.1, -2], [3.1, 0.5], [3.1, 4]]);
    expect(parallel(line.dir, [0, 1])).toBeLessThan(1e-9);
    expect(line.point[0]).toBeCloseTo(3.1, 12);
  });

  it('reports the perpendicular scatter as rms', () => {
    const e = 0.02;
    const pts = pointsOnLine([-3, 5], 112, [0, 1, 2, 3], [e, -e, e, -e]);
    const line = fitLine2D(pts);
    expect(line.rms).toBeGreaterThan(0.5 * e);
    expect(line.rms).toBeLessThanOrEqual(e + 1e-9);
  });

  it('returns null when there is no direction to find', () => {
    expect(fitLine2D([[1, 2]])).toBeNull();
    expect(fitLine2D([[1, 2], [1, 2], [1, 2]])).toBeNull();
    expect(fitLine2D([])).toBeNull();
  });
});

describe('intersectLines2D', () => {
  const corner = [3.2, -1.7];
  const a = fitLine2D(pointsOnLine(corner, 20, [0.5, 1.5, 2.5]));
  const b = fitLine2D(pointsOnLine(corner, 105, [-3, -2, -0.7]));

  it('finds a corner that none of the taps sit on', () => {
    const p = intersectLines2D(a, b);
    expect(p[0]).toBeCloseTo(corner[0], 9);
    expect(p[1]).toBeCloseTo(corner[1], 9);
  });

  it('gives the same corner whichever wall comes first', () => {
    const p = intersectLines2D(a, b), q = intersectLines2D(b, a);
    expect(p[0]).toBeCloseTo(q[0], 9);
    expect(p[1]).toBeCloseTo(q[1], 9);
  });

  it('returns null for parallel and near-parallel walls', () => {
    const base = fitLine2D(pointsOnLine([0, 0], 40, [0, 1]));
    const same = fitLine2D(pointsOnLine([1, 3], 40, [0, 1]));
    const near = fitLine2D(pointsOnLine([1, 3], 42, [0, 1]));
    const flipped = fitLine2D(pointsOnLine([1, 3], 222, [0, 1]));
    expect(intersectLines2D(base, same)).toBeNull();
    expect(intersectLines2D(base, near)).toBeNull();
    expect(intersectLines2D(base, flipped)).toBeNull();
  });

  it('still answers just above the angle limit', () => {
    const base = fitLine2D(pointsOnLine([0, 0], 40, [0, 1]));
    const ok = fitLine2D(pointsOnLine([1, 3], 46, [0, 1]));
    expect(intersectLines2D(base, ok)).not.toBeNull();
  });

  it('passes a missing line through as null', () => {
    expect(intersectLines2D(null, a)).toBeNull();
  });
});

describe('polygon area', () => {
  it('measures an L-shaped room wherever it sits', () => {
    expect(polygonArea(L_ROOM)).toBeCloseTo(L_AREA, 12);
    expect(polygonArea(move(L_ROOM, 37, [-12.3, 4.4]))).toBeCloseTo(L_AREA, 9);
  });

  it('ignores winding for area but not for signed area', () => {
    const rev = [...L_ROOM].reverse();
    expect(polygonArea(rev)).toBeCloseTo(L_AREA, 12);
    expect(signedArea(rev)).toBeCloseTo(-signedArea(L_ROOM), 12);
  });
});

describe('loopGap', () => {
  it('is the first-to-last distance of the trace', () => {
    expect(loopGap([[1, 1], [5, 1], [5, 4], [1.03, 1.04]])).toBeCloseTo(0.05, 12);
  });
  it('returns null without two points', () => {
    expect(loopGap([[1, 1]])).toBeNull();
  });
});

describe('depressionAngleDeg', () => {
  it('is 45 degrees when range equals height', () => {
    expect(depressionAngleDeg([1, 1.4, 2], [2.4, 0, 2])).toBeCloseTo(45, 9);
  });

  it('does not assume the floor is at height zero', () => {
    // the session origin is at the phone, so the floor is typically negative
    expect(depressionAngleDeg([0.3, 0.2, -1], [0.3, -1.2, 0.4])).toBeCloseTo(45, 9);
  });

  it('is 90 looking straight down and small far away', () => {
    expect(depressionAngleDeg([2, 1.5, 2], [2, 0, 2])).toBeCloseTo(90, 9);
    expect(depressionAngleDeg([0, 1.4, 0], [0, 0, 14])).toBeLessThan(6);
  });
});

describe('toRoomFrame', () => {
  const moved = move(L_ROOM, -64, [7.7, -3.1]);
  const back = toRoomFrame(moved);

  it('puts the first corner at the origin and the first wall along +x', () => {
    expect(back[0][0]).toBeCloseTo(0, 9);
    expect(back[0][1]).toBeCloseTo(0, 9);
    expect(back[1][0]).toBeCloseTo(4, 9);
    expect(back[1][1]).toBeCloseTo(0, 9);
  });

  it('recovers the original room, notch on the same side', () => {
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(L_ROOM[i][0], 9);
      expect(p[1]).toBeCloseTo(L_ROOM[i][1], 9);
    });
  });

  it('never mirrors the room', () => {
    expect(Math.sign(signedArea(back))).toBe(Math.sign(signedArea(moved)));
  });

  it('returns null when the first wall has no length', () => {
    expect(toRoomFrame([[1, 1], [1, 1], [2, 3]])).toBeNull();
  });
});
