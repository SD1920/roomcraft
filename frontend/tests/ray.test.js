import { describe, it, expect } from 'vitest';
import { rayPlaneIntersect } from '../src/roomscan/geometry/ray.js';

const DEG = Math.PI / 180;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(v) { return Math.hypot(v[0], v[1], v[2]); }

function expectPoint(got, want) {
  for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i], 9);
}

describe('rayPlaneIntersect', () => {
  // camera held off-centre, aimed at a point high on a wall
  const cam = [0.5, 1.4, 0.3];
  const target = [3, 2.2, -1.1];
  const wallPoint = [3, 0, 5];
  const wallNormal = [1, 0, 0];

  it('hits a known point on an axis-aligned wall', () => {
    const r = rayPlaneIntersect(cam, sub(target, cam), wallPoint, wallNormal);
    expectPoint(r.point, target);
    expect(r.t).toBeCloseTo(len(sub(target, cam)), 9);
  });

  it('does not care which way the normal faces or how long the vectors are', () => {
    const dir = sub(target, cam).map((v) => v * 7.5);
    const r = rayPlaneIntersect(cam, dir, wallPoint, [-4, 0, 0]);
    expectPoint(r.point, target);
    // t is a distance in metres regardless of the length of dir
    expect(r.t).toBeCloseTo(len(sub(target, cam)), 9);
  });

  it('hits a known point on a wall at an arbitrary angle', () => {
    // wall through (2, 0, -3), turned 30 degrees about the vertical
    const p0 = [2, 0, -3];
    const along = [Math.cos(30 * DEG), 0, Math.sin(30 * DEG)];
    const normal = [-Math.sin(30 * DEG), 0, Math.cos(30 * DEG)];
    const want = [p0[0] + 1.7 * along[0], 2.05, p0[2] + 1.7 * along[2]];
    const from = [-0.4, 1.35, -5.2];
    const r = rayPlaneIntersect(from, sub(want, from), p0, normal);
    expectPoint(r.point, want);
  });

  it('reports the angle between ray and plane', () => {
    // 45 degrees down onto a floor at y = -1.2
    const r = rayPlaneIntersect([0, 0.2, 0], [1, -1, 0], [9, -1.2, 9], [0, 1, 0]);
    expect(r.grazeDeg).toBeCloseTo(45, 9);
    expectPoint(r.point, [1.4, -1.2, 0]);
  });

  it('returns null for a grazing or parallel ray', () => {
    const floorPoint = [0, 0, 0], up = [0, 1, 0];
    const graze = [Math.cos(1 * DEG), -Math.sin(1 * DEG), 0];
    expect(rayPlaneIntersect([0, 1.4, 0], graze, floorPoint, up)).toBeNull();
    expect(rayPlaneIntersect([0, 1.4, 0], [1, 0, 0], floorPoint, up)).toBeNull();
  });

  it('still answers just above the grazing limit', () => {
    const dir = [Math.cos(3 * DEG), -Math.sin(3 * DEG), 0];
    expect(rayPlaneIntersect([0, 1.4, 0], dir, [0, 0, 0], [0, 1, 0])).not.toBeNull();
  });

  it('returns null when the plane is behind the camera', () => {
    expect(rayPlaneIntersect(cam, sub(cam, target), wallPoint, wallNormal)).toBeNull();
  });

  it('returns null for a zero-length direction or normal', () => {
    expect(rayPlaneIntersect(cam, [0, 0, 0], wallPoint, wallNormal)).toBeNull();
    expect(rayPlaneIntersect(cam, [1, 0, 0], wallPoint, [0, 0, 0])).toBeNull();
  });
});
