import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';
import { fitRoomRectangle } from '../src/roomscan/scan/room_scan.js';
import { projectToPixel } from '../src/roomscan/detect/camera_ray.js';
import { placeDetections, mergeCandidates, applyReview, decisionFor, retype, typesLike, planPoint } from '../src/roomscan/detect/place.js';
import { toAppDesign, designCsv } from '../src/roomscan/room/app_design.js';
import { facingOf, rotationToFace } from '../src/roomscan/scan/furniture.js';

// A 3.8 x 2.6 m room (Sanjam's), turned 33 degrees, off the origin, floor at
// -1.1. Frames come from a synthetic camera standing in the room and looking
// squarely at one wall, so a rectangle on that wall projects to an upright
// box, as a detector would draw it.

const CATALOG = Object.fromEntries(catalogFile.types.map((t) => [t.id, t]));
const DEG = Math.PI / 180;
const W = 2.6, L = 3.8, F = -1.1;
const xa = [Math.cos(33 * DEG), Math.sin(33 * DEG)], za = [-xa[1], xa[0]];
const at = (u, v, y = 0) => [1.4 + xa[0] * u + za[0] * v, F + y, -0.7 + xa[1] * u + za[1] * v];
const fit = fitRoomRectangle([
  [at(-1, -L / 2), at(1, -L / 2)],          // front (index 0)
  [at(W / 2, -1.2), at(W / 2, 1.3)],        // right (1)
  [at(-0.9, L / 2), at(1, L / 2)],          // back  (2)
  [at(-W / 2, -1.4), at(-W / 2, 1.2)],      // left  (3)
], at(0, 0, 1.4));

const PX_W = 640, PX_H = 1200;

/** A frame from (u, v) in the room, eye 1.35 m up, looking at room point (tu, tv, ty). */
function frameFrom(u, v, [tu, tv, ty], wallIndex) {
  const cam = new PerspectiveCamera(60, PX_W / PX_H, 0.05, 50);
  cam.position.set(...at(u, v, 1.35));
  cam.lookAt(new Vector3(...at(tu, tv, ty)));
  cam.updateMatrixWorld(true);
  return { wallIndex, projection: cam.projectionMatrix.toArray(), view: cam.matrixWorld.toArray(), width: PX_W, height: PX_H };
}

/** The upright box a detector would draw around these room points. */
function boxAround(frame, points) {
  const px = points.map((p) => projectToPixel(frame.projection, frame.view, at(...p), PX_W, PX_H));
  const us = px.map((p) => p[0]), vs = px.map((p) => p[1]);
  return { x: Math.min(...us), y: Math.min(...vs), w: Math.max(...us) - Math.min(...us), h: Math.max(...vs) - Math.min(...vs) };
}

describe('placeDetections', () => {
  it('puts a door on the wall being faced, with its width, height and position', () => {
    // door on the front wall: 0.9 m wide from 0.2 to 1.1 m along, 2.03 m tall
    const fr = frameFrom(0.65, 0.4, [0.65, -L / 2, 1.35], 0);
    const box = boxAround(fr, [[0.2, -L / 2, 0], [1.1, -L / 2, 0], [0.2, -L / 2, 2.03], [1.1, -L / 2, 2.03]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'door', source: 'gemini', score: 0.9, box }] }], fit, CATALOG);
    expect(c.kind).toBe('opening');
    expect(c.wall).toBe('front');
    expect(c.opening.position).toBeCloseTo(0.65, 6);
    expect(c.opening.width).toBeCloseTo(0.9, 6);
    expect(c.opening.height).toBeCloseTo(2.03, 6);
    expect(c.opening.offset).toBe(0);
  });

  it('puts a TV on its wall with its height off the floor', () => {
    // left wall, 1.1 m wide, from 0.95 to 1.6 m up, centred 0.3 m along
    const fr = frameFrom(0.2, 0.3, [-W / 2, 0.3, 1.35], 3);
    const box = boxAround(fr, [[-W / 2, -0.25, 0.95], [-W / 2, 0.85, 0.95], [-W / 2, -0.25, 1.6], [-W / 2, 0.85, 1.6]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'tv', source: 'gemini', score: 0.9, box }] }], fit, CATALOG);
    expect(c.kind).toBe('wallItem');
    expect(c.wall).toBe('left');
    expect(c.item.position).toBeCloseTo(0.3, 6);
    expect(c.item.width).toBeCloseTo(1.1, 6);
    expect(c.item.elevation).toBeCloseTo(0.95, 6);
    expect(c.item.height).toBeCloseTo(0.65, 6);
  });

  it('stands an almirah against the wall being faced, facing into the room', () => {
    // back wall; front bottom edge 0.55 m out from the wall, 1.0 m wide, centred -0.4 along
    const fr = frameFrom(-0.4, -1.5, [-0.4, L / 2, 1.35], 2);
    const front = L / 2 - 0.55;
    const box = boxAround(fr, [[-0.9, front, 0], [0.1, front, 0], [-0.9, front, 1.9], [0.1, front, 1.9]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'almirah', source: 'gemini', score: 0.95, box }] }], fit, CATALOG);
    expect(c.kind).toBe('floorItem');
    expect(c.wall).toBe('back');
    const depth = CATALOG.almirah.depth * 0.3048;
    expect(c.item.z).toBeCloseTo(L / 2 - depth / 2, 6);   // back to the wall
    expect(c.item.x).toBeCloseTo(-0.4, 2);
    expect(c.item.width).toBeCloseTo(1.0, 2);
    const [fx, fz] = facingOf(CATALOG.almirah, c.item.rotation);
    expect(fx).toBeCloseTo(0, 9);
    expect(fz).toBeCloseTo(-1, 9);                         // facing into the room
  });

  it('leaves a piece in the middle of the room free-standing, facing the camera', () => {
    const fr = frameFrom(0, -1.5, [0, 0.2, 0.3], 2);
    const box = boxAround(fr, [[-0.25, 0, 0], [0.25, 0, 0], [-0.25, 0, 0.9], [0.25, 0, 0.9]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'studyChair', source: 'gemini', score: 0.8, box }] }], fit, CATALOG);
    expect(c.kind).toBe('floorItem');
    expect(c.wall).toBeNull();
    const depth = CATALOG.studyChair.depth * 0.3048;
    expect(c.item.z).toBeCloseTo(0 + depth / 2, 2);       // behind its front edge, away from the camera
    expect(c.item.x).toBeCloseTo(0, 2);
  });

  it('uses the centre of view to find the wall when a frame has no station', () => {
    const fr = frameFrom(0.65, 0.4, [0.65, -L / 2, 1.35], undefined);
    const box = boxAround(fr, [[0.2, -L / 2, 0], [1.1, -L / 2, 0], [0.2, -L / 2, 2.03], [1.1, -L / 2, 2.03]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'door', source: 'gemini', score: 0.9, box }] }], fit, CATALOG);
    expect(c.wall).toBe('front');
  });

  it('ignores labels that are not furniture, doors or windows', () => {
    const fr = frameFrom(0, 0, [0, -L / 2, 1], 0);
    const items = [{ label: 'person', source: 'phone', score: 0.9, box: { x: 10, y: 10, w: 50, h: 50 } },
      { label: 'other', source: 'gemini', score: 0.9, box: { x: 10, y: 10, w: 50, h: 50 } }];
    expect(placeDetections([{ ...fr, items }], fit, CATALOG)).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  const almirah = (x, source = 'gemini', type = 'almirah', score = 0.9) => ({
    kind: 'floorItem', type, wall: 'back', source, score, frame: 0,
    item: { type, x, z: 1.6, rotation: 0, width: 1, depth: 0.55, height: 1.98, elevation: 0 },
  });

  it('makes one piece from several sightings, averaged', () => {
    const [p] = mergeCandidates([almirah(-0.4), almirah(-0.3), almirah(-0.5, 'gemini', 'almirah', 0.97)]);
    expect(p.seen).toBe(3);
    expect(p.score).toBe(0.97);
    expect(p.item.x).toBeCloseTo(-0.4, 9);
  });

  it('drops the phone\'s guess where Gemini named something', () => {
    const out = mergeCandidates([almirah(-0.4, 'phone', 'fridge', 0.7), almirah(-0.35)]);
    expect(out.map((p) => p.type)).toEqual(['almirah']);
  });

  it('keeps two pieces apart when they are far apart', () => {
    expect(mergeCandidates([almirah(-0.9), almirah(0.6)])).toHaveLength(2);
  });

  it('gives the same id to the same piece after a recompute', () => {
    const a = mergeCandidates([almirah(-0.4), almirah(-0.38)]);
    const b = mergeCandidates([almirah(-0.39), almirah(-0.41)]);
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toMatch(/^floorItem\|almirah\|back\|/);
  });

  it('merges doors only along the same wall', () => {
    const door = (wall, position) => ({ kind: 'opening', type: 'door', wall, source: 'gemini', score: 0.9, frame: 0, opening: { type: 'door', wall, position, width: 0.9, height: 2, offset: 0 } });
    expect(mergeCandidates([door('front', 0.3), door('front', 0.4)])).toHaveLength(1);
    expect(mergeCandidates([door('front', 0.3), door('back', 0.3)])).toHaveLength(2);
  });
});

describe('review', () => {
  const FT = 0.3048;
  const result = { fit, openings: [], furniture: [], ceiling: null };
  const door = { id: 'opening|door|front|1|0', kind: 'opening', type: 'door', wall: 'front', source: 'gemini', score: 0.9, seen: 2,
    opening: { type: 'door', wall: 'front', position: 0.65, width: 0.9, height: 2.03, offset: 0 } };
  const tv = { id: 'wallItem|tv|left|1|2', kind: 'wallItem', type: 'tv', wall: 'left', source: 'gemini', score: 0.9, seen: 1,
    item: { type: 'tv', wallMounted: true, wall: 'left', position: 0.3, elevation: 0.95, width: 1.1, height: 0.65, depth: CATALOG.tv.depth * FT } };
  const almirah = { id: 'floorItem|almirah|back|-1|3', kind: 'floorItem', type: 'almirah', wall: 'back', source: 'gemini', score: 0.95, seen: 3,
    item: { type: 'almirah', x: -0.4, z: L / 2 - CATALOG.almirah.depth * FT / 2, rotation: 0, width: 1.0, depth: CATALOG.almirah.depth * FT, height: CATALOG.almirah.height * FT, elevation: 0 } };
  almirah.item.rotation = rotationToFace(CATALOG.almirah, 0, -1); // facing into the room
  const fridge = { id: 'floorItem|fridge|-|2|-2', kind: 'floorItem', type: 'fridge', wall: null, source: 'phone', score: 0.6, seen: 1,
    item: { type: 'fridge', x: 1.0, z: -1.0, rotation: 0, width: 0.7, depth: 0.7, height: 1.7, elevation: 0 } };

  it('keeps Gemini pieces and leaves phone guesses as suggestions by default', () => {
    expect(decisionFor(door, {})).toBe('keep');
    expect(decisionFor(fridge, {})).toBe('maybe');
    const { result: r, suggestions } = applyReview(result, [door, tv, almirah, fridge], {}, CATALOG);
    expect(r.openings).toHaveLength(1);
    expect(r.furniture.map((f) => f.item.type)).toEqual(['tv', 'almirah']);
    expect(suggestions.map((sg) => sg.type)).toEqual(['fridge']);
    expect(suggestions[0]).toMatchObject({ x: 1.0, z: -1.0, source: 'phone' });
  });

  it('puts kept pieces into the design in the app format, marked as found by the camera', () => {
    const { result: r, suggestions } = applyReview(result, [door, tv, almirah, fridge], {}, CATALOG);
    const { design } = toAppDesign(r, { catalog: CATALOG, suggestions });
    expect(design.openings[0]).toMatchObject({ type: 'door', wall: 'front', offset: 0 });
    expect(design.openings[0].width).toBeCloseTo(0.9 / FT, 1);
    const t = design.furniture.find((f) => f.type === 'tv');
    expect(t).toMatchObject({ wallMounted: true, wall: 'left', rotation: 0, x: 0, z: 0 });
    expect(t.elevation).toBeCloseTo(0.95 / FT, 1);
    expect(design.scan.furniture.every((n) => n.source === 'camera')).toBe(true);
    expect(design.scan.openings[0].source).toBe('camera');
    expect(design.scan.suggestions[0]).toMatchObject({ kind: 'floorItem', type: 'fridge' });
    const csv = designCsv(design);
    expect(csv).toMatch(/\ndoor,door,,front,.*,camera,/);
    expect(csv).toMatch(/\nsuggestion,fridge,/);
  });

  it('removes, keeps or changes type as the user decides', () => {
    const review = { [door.id]: 'remove', [fridge.id]: 'keep', [almirah.id]: { type: 'bookshelf' } };
    const { result: r, pieces } = applyReview(result, [door, almirah, fridge], review, CATALOG);
    expect(r.openings).toHaveLength(0);
    expect(r.furniture.map((f) => f.item.type)).toEqual(['bookshelf', 'fridge']);
    const changed = pieces.find((p) => p.id === almirah.id);
    expect(changed).toMatchObject({ decision: 'keep', changed: true, originalType: 'almirah', type: 'bookshelf' });
  });

  it('keeps a retyped piece against its wall, facing the same way', () => {
    const b = retype(almirah, 'bookshelf', CATALOG);
    const depth = CATALOG.bookshelf.depth * FT;
    expect(b.item.z).toBeCloseTo(L / 2 - depth / 2, 9);
    expect(b.item.x).toBeCloseTo(-0.4, 9);
    expect(b.item.width).toBe(1.0);
    expect(b.item.height).toBeCloseTo(CATALOG.bookshelf.height * FT, 9);
    const [fx, fz] = facingOf(CATALOG.bookshelf, b.item.rotation);
    expect(fx).toBeCloseTo(0, 9);
    expect(fz).toBeCloseTo(-1, 9);
  });

  it('only offers types of the same kind', () => {
    expect(typesLike(door, CATALOG)).toEqual(['door', 'window']);
    expect(typesLike(tv, CATALOG)).toContain('wallShelf');
    expect(typesLike(tv, CATALOG)).not.toContain('bed');
    expect(typesLike(almirah, CATALOG)).not.toContain('tv');
    expect(retype(almirah, 'tv', CATALOG)).toBe(almirah);
  });

  it('a window changed to a door comes down to the floor', () => {
    const w = { ...door, type: 'window', opening: { ...door.opening, type: 'window', offset: 0.9 } };
    expect(retype(w, 'door', CATALOG).opening.offset).toBe(0);
  });

  it('marks wall pieces on their wall in the plan', () => {
    expect(planPoint(fit, door)).toEqual({ x: 0.65, z: -fit.lengthM / 2 });
    expect(planPoint(fit, tv)).toEqual({ x: -fit.widthM / 2, z: 0.3 });
  });
});

describe('placeDetections picks the wall from the geometry', () => {
  it('puts a door on the wall its box points at, even if the station says another', () => {
    const fr = frameFrom(0.65, 0.4, [0.65, -L / 2, 1.35], 2); // station: back, but looking at the front
    const box = boxAround(fr, [[0.2, -L / 2, 0], [1.1, -L / 2, 0], [0.2, -L / 2, 2.03], [1.1, -L / 2, 2.03]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'door', source: 'gemini', score: 0.9, box }] }], fit, CATALOG);
    expect(c.wall).toBe('front');
    expect(c.opening.width).toBeCloseTo(0.9, 6);
  });

  it('stands a piece against the nearest wall when it is not the one faced', () => {
    // an almirah against the LEFT wall, seen from the room looking towards the back-left
    const fr = frameFrom(1.0, -1.8, [-0.8, 0.5, 1.35], 2); // far enough back that its base is in view
    const depth = CATALOG.almirah.depth * 0.3048;
    const fx = -W / 2 + depth; // its front face, a plane parallel to the left wall
    const box = boxAround(fr, [[fx, 0, 0], [fx, 1.0, 0], [fx, 0, 1.9], [fx, 1.0, 1.9]]);
    const [c] = placeDetections([{ ...fr, items: [{ label: 'almirah', source: 'gemini', score: 0.9, box }] }], fit, CATALOG);
    expect(c.wall).toBe('left');
    expect(c.item.x).toBeCloseTo(-W / 2 + depth / 2, 6);
    const [fxx, fzz] = facingOf(CATALOG.almirah, c.item.rotation);
    expect(fxx).toBeCloseTo(1, 9);
    expect(fzz).toBeCloseTo(0, 9);
  });
});
