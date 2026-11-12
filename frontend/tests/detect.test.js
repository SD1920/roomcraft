import { describe, it, expect } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { pixelRay, placeBoxOnFloor, projectToPixel } from '../src/roomscan/detect/camera_ray.js';
import { COCO_TO_CATALOG, catalogTypesFor } from '../src/roomscan/detect/coco_catalog.js';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';

// A synthetic phone camera: 640 x 360 frame, 60 degree vertical field of
// view, 1.3 m above a floor at -1.2, turned and tilted down, off the origin.
// The real projection and pose come from WebXR in the same column-major form.
const W = 640, H = 360, FLOOR = -1.2;

function makeCamera() {
  const cam = new PerspectiveCamera(60, W / H, 0.05, 50);
  cam.position.set(0.7, FLOOR + 1.3, -0.4);
  cam.lookAt(new Vector3(2.1, FLOOR, -2.8));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return {
    projection: cam.projectionMatrix.toArray(),
    view: cam.matrixWorld.toArray(),
    width: W,
    height: H,
  };
}

const frame = makeCamera();

describe('pixelRay and projectToPixel', () => {
  it('round-trip: a floor point seen at a pixel is found again from that pixel', () => {
    for (const p of [[2.1, FLOOR, -2.8], [1.4, FLOOR, -1.9], [3.0, FLOOR, -2.2]]) {
      const [u, v] = projectToPixel(frame.projection, frame.view, p, W, H);
      const ray = pixelRay(frame.projection, frame.view, u, v, W, H);
      const t = (FLOOR - ray.origin[1]) / ray.dir[1];
      const hit = ray.origin.map((o, i) => o + t * ray.dir[i]);
      hit.forEach((x, i) => expect(x).toBeCloseTo(p[i], 6));
    }
  });

  it('puts the image centre on the camera\'s viewing direction', () => {
    const ray = pixelRay(frame.projection, frame.view, W / 2, H / 2, W, H);
    const forward = new Vector3(0, 0, -1).applyMatrix4(new Matrix4().extractRotation(new Matrix4().fromArray(frame.view)));
    expect(ray.dir[0]).toBeCloseTo(forward.x, 9);
    expect(ray.dir[1]).toBeCloseTo(forward.y, 9);
    expect(ray.dir[2]).toBeCloseTo(forward.z, 9);
  });

  it('keeps top and bottom the right way round: lower pixels are nearer floor', () => {
    const near = pixelRay(frame.projection, frame.view, W / 2, H - 5, W, H);
    const far = pixelRay(frame.projection, frame.view, W / 2, H / 2, W, H);
    // looking down: the bottom of the image points more steeply down
    expect(near.dir[1]).toBeLessThan(far.dir[1]);
  });

  it('knows a point behind the camera has no pixel', () => {
    expect(projectToPixel(frame.projection, frame.view, [-1, FLOOR + 1.3, 2], W, H)).toBeNull();
  });
});

describe('placeBoxOnFloor', () => {
  it('stands a box on the floor point under its bottom-centre', () => {
    const foot = [1.9, FLOOR, -2.4];
    const [u, v] = projectToPixel(frame.projection, frame.view, foot, W, H);
    const box = { x: u - 60, y: v - 90, w: 120, h: 90 };
    const placed = placeBoxOnFloor(box, frame, FLOOR);
    placed.point.forEach((x, i) => expect(x).toBeCloseTo(foot[i], 6));
    expect(placed.widthM).toBeGreaterThan(0);
  });

  it('measures the floor width spanned by the bottom edge', () => {
    const a = [1.5, FLOOR, -2.6], b = [2.3, FLOOR, -2.6];
    const [ua, va] = projectToPixel(frame.projection, frame.view, a, W, H);
    const [ub, vb] = projectToPixel(frame.projection, frame.view, b, W, H);
    // both ends on the same image row only approximately; use their mean
    const v = (va + vb) / 2;
    const placed = placeBoxOnFloor({ x: ua, y: v - 50, w: ub - ua, h: 50 }, frame, FLOOR);
    expect(placed.widthM).toBeGreaterThan(0.7);
    expect(placed.widthM).toBeLessThan(0.9);
  });

  it('does not place a box cut off by the bottom of the frame', () => {
    const r = placeBoxOnFloor({ x: 100, y: 120, w: 400, h: H - 120 }, frame, FLOOR);
    expect(r.point).toBeNull();
    expect(r.cutOff).toBe(true);
  });

  it('gives nothing without a known floor', () => {
    expect(placeBoxOnFloor({ x: 300, y: 200, w: 40, h: 40 }, frame, null)).toBeNull();
  });

  it('gives nothing when the box bottom is above the horizon', () => {
    // a box at the very top of a frame that looks up gets no floor point
    const up = new PerspectiveCamera(60, W / H, 0.05, 50);
    up.position.set(0, FLOOR + 1.3, 0);
    up.lookAt(new Vector3(0, FLOOR + 3, -2));
    up.updateMatrixWorld(true);
    const f = { projection: up.projectionMatrix.toArray(), view: up.matrixWorld.toArray(), width: W, height: H };
    expect(placeBoxOnFloor({ x: 280, y: 0, w: 80, h: 20 }, f, FLOOR)).toBeNull();
  });
});

describe('detector labels to catalog types', () => {
  const ids = new Set(catalogFile.types.map((t) => t.id));

  it('only ever suggests types that exist in the app\'s catalog', () => {
    for (const [label, types] of Object.entries(COCO_TO_CATALOG)) {
      expect(types.length).toBeGreaterThan(0);
      for (const t of types) expect(ids.has(t), `${label} -> ${t}`).toBe(true);
    }
  });

  it('maps furniture labels and ignores everything else', () => {
    expect(catalogTypesFor('couch')[0]).toBe('sofa');
    expect(catalogTypesFor('Bed')[0]).toBe('bed');
    expect(catalogTypesFor('person')).toEqual([]);
    expect(catalogTypesFor('laptop')).toEqual([]);
  });
});
