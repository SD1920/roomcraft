import { describe, it, expect } from 'vitest';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';
import { fitRoomRectangle, createRoomScan, scanResult } from '../src/roomscan/scan/room_scan.js';
import { floorItemFromTaps, wallItemFromCorners, rotationToFace, facingOf } from '../src/roomscan/scan/furniture.js';

// Rooms here are rotated, off the origin and with the floor below zero, as
// in an AR session. Facing is checked against the team app's own rule
// (roomPresets.js rotationToFace): at rotation 0 a piece faces -z, unless its
// type is in FACES_PLUS_Z.

const DEG = Math.PI / 180;
const FT = 0.3048;
const CATALOG = Object.fromEntries(catalogFile.types.map((t) => [t.id, t]));

function makeRoom({ W = 3.6, L = 4.2, rotDeg = -28, centre = [0.9, -1.4], floorY = -1.2 } = {}) {
  const x = [Math.cos(rotDeg * DEG), Math.sin(rotDeg * DEG)];
  const z = [-x[1], x[0]];
  const at = (u, v, y = floorY) => [centre[0] + x[0] * u + z[0] * v, y, centre[1] + x[1] * u + z[1] * v];
  const walls = {
    front: [-1, 1].map((s) => at(s, -L / 2)),
    back: [-1.2, 0.8].map((s) => at(s, L / 2)),
    left: [-1.5, 1].map((s) => at(-W / 2, s)),
    right: [-1, 1.4].map((s) => at(W / 2, s)),
  };
  const inside = at(0, 0, floorY + 1.4);
  const fit = fitRoomRectangle([walls.front, walls.right, walls.back, walls.left], inside);
  return { W, L, at, walls, inside, fit, floorY };
}

const room = makeRoom();
const tap = (u, v, camU, camV) => ({ p: room.at(u, v), cam: room.at(camU, camV, room.floorY + 1.3) });

// the app's own facing rule, copied from roomPresets.js, to check against
function appFacing(entry, r) {
  const f = entry.facesPlusZ ? { x: 0, z: 1 } : { x: 0, z: -1 };
  return [f.x * Math.cos(r) + f.z * Math.sin(r), -f.x * Math.sin(r) + f.z * Math.cos(r)];
}

describe('the catalog copied from the app', () => {
  it('has the app\'s 86 furniture types and 14 room types', () => {
    expect(catalogFile.types).toHaveLength(86);
    expect(catalogFile.roomTypes).toHaveLength(14);
    expect(catalogFile.units).toBe('ft');
  });

  it('marks which types hang on a wall and which face +z', () => {
    expect(CATALOG.tv.wallMounted).toBe(true);
    expect(CATALOG.bed.wallMounted).toBe(false);
    expect(CATALOG.bed.facesPlusZ).toBe(true);
    expect(CATALOG.wardrobe.facesPlusZ).toBe(false);
  });
});

describe('rotationToFace', () => {
  it('agrees with the app\'s rule in every direction, for both kinds of model', () => {
    for (const entry of [CATALOG.bed, CATALOG.wardrobe]) {
      for (const deg of [0, 37, 90, 151, 180, -64, -90, -135]) {
        const want = [Math.sin(deg * DEG), Math.cos(deg * DEG)];
        const r = rotationToFace(entry, want[0], want[1]);
        const got = appFacing(entry, r);
        expect(got[0]).toBeCloseTo(want[0], 9);
        expect(got[1]).toBeCloseTo(want[1], 9);
        const back = facingOf(entry, r);
        expect(back[0]).toBeCloseTo(want[0], 9);
        expect(back[1]).toBeCloseTo(want[1], 9);
      }
    }
  });

  it('gives the app\'s own answer for a bed against the back wall', () => {
    // the app's generator turns a bed on the back wall to face -z: rotation pi
    expect(Math.abs(rotationToFace(CATALOG.bed, 0, -1))).toBeCloseTo(Math.PI, 9);
    expect(rotationToFace(CATALOG.wardrobe, 0, -1)).toBeCloseTo(0, 9);
  });
});

describe('floorItemFromTaps', () => {
  // a wardrobe 1.2 m wide, 0.6 m deep, against the back wall, its centre
  // 0.5 m right of the room's middle; the user stands in front of it
  const back = room.L / 2;

  it('places, sizes and turns a piece from two front corners and a back point', () => {
    const { item, measured, problems } = floorItemFromTaps(room.fit, CATALOG.wardrobe, [
      tap(-0.1, back - 0.6, 0.5, 0), tap(1.1, back - 0.6, 0.5, 0), tap(0.4, back, 0.5, 0),
    ]);
    expect(item.x).toBeCloseTo(0.5, 9);
    expect(item.z).toBeCloseTo(back - 0.3, 9);
    expect(item.width).toBeCloseTo(1.2, 9);
    expect(item.depth).toBeCloseTo(0.6, 9);
    const f = appFacing(CATALOG.wardrobe, item.rotation);
    expect(f[0]).toBeCloseTo(0, 9);
    expect(f[1]).toBeCloseTo(-1, 9);               // facing into the room, away from the back wall
    expect(measured).toEqual(['width', 'depth']);
    expect(problems).toEqual([]);
  });

  it('gives the same piece whichever front corner is tapped first', () => {
    const one = floorItemFromTaps(room.fit, CATALOG.wardrobe, [tap(-0.1, back - 0.6, 0.5, 0), tap(1.1, back - 0.6, 0.5, 0)]).item;
    const two = floorItemFromTaps(room.fit, CATALOG.wardrobe, [tap(1.1, back - 0.6, 0.5, 0), tap(-0.1, back - 0.6, 0.5, 0)]).item;
    expect(two.x).toBeCloseTo(one.x, 9);
    expect(two.z).toBeCloseTo(one.z, 9);
    expect(Math.cos(two.rotation - one.rotation)).toBeCloseTo(1, 9);
  });

  it('uses the standard depth when no back point is given', () => {
    const { item, measured } = floorItemFromTaps(room.fit, CATALOG.wardrobe, [
      tap(-0.1, back - 0.6, 0.5, 0), tap(1.1, back - 0.6, 0.5, 0),
    ]);
    expect(measured).toEqual(['width']);
    expect(item.depth).toBeCloseTo(CATALOG.wardrobe.depth * FT, 9);
    expect(item.z).toBeCloseTo(back - 0.6 + CATALOG.wardrobe.depth * FT / 2, 9);
  });

  it('turns a +z model the right way at an arbitrary angle', () => {
    // a bed standing diagonally, foot facing the room's front-left
    const dir = [-Math.sin(40 * DEG), -Math.cos(40 * DEG)];   // facing direction in room frame
    const side = [dir[1], -dir[0]];
    const foot = [0.2, 0.4];
    const c1 = [foot[0] - side[0] * 0.8, foot[1] - side[1] * 0.8];
    const c2 = [foot[0] + side[0] * 0.8, foot[1] + side[1] * 0.8];
    const stand = [foot[0] + dir[0] * 1, foot[1] + dir[1] * 1];
    const { item } = floorItemFromTaps(room.fit, CATALOG.bed, [
      tap(c1[0], c1[1], stand[0], stand[1]), tap(c2[0], c2[1], stand[0], stand[1]),
    ]);
    const f = appFacing(CATALOG.bed, item.rotation);
    expect(f[0]).toBeCloseTo(dir[0], 9);
    expect(f[1]).toBeCloseTo(dir[1], 9);
    // centre sits behind the foot edge by half the standard depth
    const d = CATALOG.bed.depth * FT;
    expect(item.x).toBeCloseTo(foot[0] - dir[0] * d / 2, 9);
    expect(item.z).toBeCloseTo(foot[1] - dir[1] * d / 2, 9);
  });

  it('flags a back point tapped in front of the piece', () => {
    const { problems } = floorItemFromTaps(room.fit, CATALOG.wardrobe, [
      tap(-0.1, back - 0.6, 0.5, 0), tap(1.1, back - 0.6, 0.5, 0), tap(0.4, back - 1.2, 0.5, 0),
    ]);
    expect(problems.join(' ')).toMatch(/in front of the front edge/);
  });

  it('keeps the standard depth when the back tap lands far away (1 Nov: a 16 ft bed)', () => {
    const { item, measured, problems } = floorItemFromTaps(room.fit, CATALOG.wardrobe, [
      tap(-0.1, back - 0.6, 0.5, -1), tap(1.1, back - 0.6, 0.5, -1), tap(0.4, back + 3, 0.5, -1),
    ]);
    expect(item.depth).toBeCloseTo(CATALOG.wardrobe.depth * FT, 9);
    expect(measured).toEqual(['width']);
    expect(problems.join(' ')).toMatch(/so the standard 1.8 ft was used/);
  });

  it('flags a size far from the catalog\'s, which suggests the wrong type', () => {
    const { problems } = floorItemFromTaps(room.fit, CATALOG.bedside, [
      tap(-1, 0, 0, -1), tap(1, 0, 0, -1),
    ]);
    expect(problems.join(' ')).toMatch(/right type/);
  });

  it('refuses two front corners on top of each other', () => {
    const r = floorItemFromTaps(room.fit, CATALOG.wardrobe, [tap(0, 0, 0, -1), tap(0.05, 0, 0, -1)]);
    expect(r.item).toBeNull();
  });
});

describe('wallItemFromCorners', () => {
  it('places a TV on its wall from two corners', () => {
    const W2 = room.W / 2, f = room.floorY;
    const { item, problems } = wallItemFromCorners(
      room.fit, CATALOG.tv, 'left', room.at(-W2, 0.2, f + 0.95), room.at(-W2, 1.4, f + 1.7),
    );
    expect(item.wall).toBe('left');
    expect(item.wallMounted).toBe(true);
    expect(item.position).toBeCloseTo(0.8, 9);
    expect(item.width).toBeCloseTo(1.2, 9);
    expect(item.elevation).toBeCloseTo(0.95, 9);
    expect(item.height).toBeCloseTo(0.75, 9);
    expect(problems).toEqual([]);
  });
});

describe('furniture in the guided scan', () => {
  const hit = (p, cam = room.inside) => ({ hit: p, cam, normalUp: 1, timeMs: 0 });
  const rayTo = (p) => ({ origin: room.inside, dir: [p[0] - room.inside[0], p[1] - room.inside[1], p[2] - room.inside[2]] });

  function walled() {
    const scan = createRoomScan(CATALOG);
    for (const name of ['front', 'right', 'back', 'left']) {
      room.walls[name].forEach((p) => scan.addWallTap(hit(p)));
      scan.nextWall();
    }
    expect(scan.phase()).toBe('extras');
    return scan;
  }

  it('marks most pieces with ONE tap: near a wall, back to that wall, facing in', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.bed);
    expect(scan.wantsFloorTap()).toBe(true);
    // a tap on the middle of the mattress, 55 cm up, about a metre from the back wall
    const depth = CATALOG.bed.depth * FT;
    scan.addFurnitureTap(hit(room.at(0.3, room.L / 2 - 1.0, room.floorY + 0.55)));
    expect(scan.pendingType()).toBeNull(); // done in one tap
    const [bed] = scan.result().furniture;
    expect(bed.item.z).toBeCloseTo(room.L / 2 - depth / 2, 9);
    expect(bed.item.x).toBeCloseTo(0.3, 9);
    expect(bed.item.width).toBeCloseTo(CATALOG.bed.width * FT, 9);
    expect(bed.measured).toEqual(['position']);
    const [fx, fz] = facingOf(CATALOG.bed, bed.item.rotation);
    expect(fx).toBeCloseTo(0, 9);
    expect(fz).toBeCloseTo(-1, 9);
  });

  it('a bed tapped close to a wall lies with its long side along it', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.singleBed);
    const width = CATALOG.singleBed.width * FT;
    scan.addFurnitureTap(hit(room.at(-room.W / 2 + 0.45, 0.2, room.floorY + 0.55), room.at(0, -1, room.floorY + 1.3)));
    const [bed] = scan.result().furniture;
    expect(bed.item.x).toBeCloseTo(-room.W / 2 + width / 2, 9);
    expect(bed.item.z).toBeCloseTo(0.2, 9);
    const [fx, fz] = facingOf(CATALOG.singleBed, bed.item.rotation);
    expect(fx).toBeCloseTo(0, 9);
    expect(Math.abs(fz)).toBeCloseTo(1, 9); // its foot points along the wall
  });

  it('a one-tap piece out in the room stands at the tap, facing the person', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.studyChair);
    scan.addFurnitureTap(hit(room.at(0, 0), room.at(0, -1.2, room.floorY + 1.3)));
    const [chair] = scan.result().furniture;
    expect(chair.item.x).toBeCloseTo(0, 9);
    expect(chair.item.z).toBeCloseTo(0, 9);
    const [fx, fz] = facingOf(CATALOG.studyChair, chair.item.rotation);
    expect(fx).toBeCloseTo(0, 9);
    expect(fz).toBeCloseTo(-1, 9);
  });

  it('marks a tall piece by two corners like a door: floor corner, then aimed top corner', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.almirah);
    const front = room.L / 2 - 0.55; // its front, 55 cm out from the back wall
    expect(scan.wantsFloorTap()).toBe(true);
    scan.addFurnitureTap(hit(room.at(-0.9, front)));
    expect(scan.wantsFloorTap()).toBe(false);
    expect(scan.prompt()).toMatch(/top-right corner/);
    expect(scan.addStandingCorner(rayTo(room.at(0.1, front, room.floorY + 1.9))).ok).toBe(true);
    const [a] = scan.result().furniture;
    const depth = CATALOG.almirah.depth * FT;
    expect(a.item.width).toBeCloseTo(1.0, 9);
    expect(a.item.height).toBeCloseTo(1.9, 9);
    expect(a.item.depth).toBeCloseTo(depth, 9);
    expect(a.item.x).toBeCloseTo(-0.4, 9);
    expect(a.item.z).toBeCloseTo(front + depth / 2, 9);
    expect(a.measured).toEqual(['width', 'height']);
  });

  it('refuses a tall piece\'s top corner right above its first corner', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.wardrobe);
    const front = room.L / 2 - 0.6;
    scan.addFurnitureTap(hit(room.at(-0.9, front)));
    const r = scan.addStandingCorner(rayTo(room.at(-0.85, front, room.floorY + 1.9)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/TOP-RIGHT corner, on the other side/);
    expect(scan.pendingType()).toBe('wardrobe');
  });

  it('marks a wall piece by two aimed corners', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.tv);
    expect(scan.wantsFloorTap()).toBe(false);
    scan.addOpeningCorner(rayTo(room.at(-room.W / 2, 0.2, room.floorY + 0.95)));
    scan.addOpeningCorner(rayTo(room.at(-room.W / 2, 1.4, room.floorY + 1.7)));
    const [tv] = scan.result().furniture;
    expect(tv.item.wall).toBe('left');
    expect(tv.item.width).toBeCloseTo(1.2, 9);
  });

  it('does not let furniture taps count as wall taps', () => {
    const scan = walled();
    const before = scan.result().fit;
    scan.startFurniture(CATALOG.bed);
    scan.addFurnitureTap(hit(room.at(0, 0)));
    const after = scan.result().fit;
    expect(after.widthM).toBeCloseTo(before.widthM, 12);
    expect(after.lengthM).toBeCloseTo(before.lengthM, 12);
  });

  it('undoes furniture last-in first-out, taps included', () => {
    const scan = walled();
    const wallTaps = scan.tapCount();
    scan.startFurniture(CATALOG.bed);
    scan.addFurnitureTap(hit(room.at(0, 0)));
    scan.startFurniture(CATALOG.almirah);
    scan.addFurnitureTap(hit(room.at(-0.9, room.L / 2 - 0.55)));
    scan.addStandingCorner(rayTo(room.at(0.1, room.L / 2 - 0.55, room.floorY + 1.9)));
    expect(scan.tapCount()).toBe(wallTaps + 2);
    scan.undo();                                   // the almirah and its tap
    expect(scan.result().furniture.map((f) => f.item.type)).toEqual(['bed']);
    expect(scan.tapCount()).toBe(wallTaps + 1);
    scan.undo();                                   // the bed
    expect(scan.tapCount()).toBe(wallTaps);
    scan.startFurniture(CATALOG.wardrobe);         // a half-marked tall piece
    scan.addFurnitureTap(hit(room.at(-0.9, room.L / 2 - 0.6)));
    scan.undo();
    expect(scan.tapCount()).toBe(wallTaps);
    expect(scan.pendingType()).toBe('wardrobe');
  });

  it('recomputes saved furniture to the same pieces', () => {
    const scan = walled();
    scan.startFurniture(CATALOG.bed, { name: 'Queen', width: 5, depth: 6.25 });
    scan.addFurnitureTap(hit(room.at(0.3, room.L / 2 - 1.0)));
    scan.startFurniture(CATALOG.almirah);
    scan.addFurnitureTap(hit(room.at(-0.9, room.L / 2 - 0.55)));
    scan.addStandingCorner(rayTo(room.at(0.1, room.L / 2 - 0.55, room.floorY + 1.9)));
    const live = scan.result().furniture.map((f) => f.item);
    const again = scanResult(JSON.parse(JSON.stringify(scan.saved())), CATALOG).furniture.map((f) => f.item);
    expect(again).toEqual(live);
    expect(again[0].depth).toBeCloseTo(6.25 * FT, 9);
  });

  it('still reads scans saved with the old three-tap pieces', () => {
    const saved = walled().saved();
    const n = saved.taps.length;
    const old = {
      ...saved,
      taps: [...saved.taps,
        { index: n, wall: null, hit: room.at(-0.1, room.L / 2 - 0.6), cam: room.at(0.5, 0.5, room.floorY + 1.3) },
        { index: n + 1, wall: null, hit: room.at(1.1, room.L / 2 - 0.6), cam: room.at(0.5, 0.5, room.floorY + 1.3) }],
      furniture: [{ type: 'wardrobe', kind: 'floor', tapIdx: [n, n + 1] }],
    };
    const [w] = scanResult(old, CATALOG).furniture;
    expect(w.item.width).toBeCloseTo(1.2, 9);
  });


  it('says so when a type is not in the catalog', () => {
    const r = scanResult({ ...walled().saved(), furniture: [{ type: 'spaceship', kind: 'floor', tapIdx: [] }] }, CATALOG);
    expect(r.furniture[0].item).toBeNull();
    expect(r.furniture[0].problems.join(' ')).toMatch(/unknown furniture type/);
  });
});

describe('size presets', () => {
  it('a Queen bed uses the preset depth and is named for it', async () => {
    const { toAppDesign } = await import('../src/roomscan/room/app_design.js');
    const presets = (await import('../src/roomscan/data/size_presets.json')).default.presets;
    const queen = presets.bed.find((p) => p.name === 'Queen');
    const saved = {
      taps: [
        ...[room.walls.front, room.walls.right, room.walls.back, room.walls.left]
          .flatMap((pts, wall) => pts.map((p) => ({ wall, hit: p, cam: room.inside }))),
        { wall: null, hit: room.at(-0.8, 2.1 - 1.9), cam: room.at(0, 0, room.floorY + 1.3) },
        { wall: null, hit: room.at(0.75, 2.1 - 1.9), cam: room.at(0, 0, room.floorY + 1.3) },
      ],
      furniture: [],
    };
    const n = saved.taps.length;
    saved.furniture.push({ type: 'bed', kind: 'floor', tapIdx: [n - 2, n - 1], size: queen });
    const r = scanResult(saved, CATALOG);
    const bed = r.furniture[0];
    expect(bed.sizeName).toBe('Queen');
    expect(bed.item.depth).toBeCloseTo(6.25 * FT, 9);
    expect(bed.item.width).toBeCloseTo(1.55, 9); // measured by the taps
    expect(bed.item.height).toBeCloseTo(CATALOG.bed.height * FT, 9); // no preset height: catalog's
    const { design } = toAppDesign(r, { catalog: CATALOG });
    expect(design.furniture[0]).toMatchObject({ type: 'bed', name: 'Bed (Queen)', depth: 6.25 });
  });

  it('every preset names a catalog type and has a width and depth', async () => {
    const presets = (await import('../src/roomscan/data/size_presets.json')).default.presets;
    for (const [type, list] of Object.entries(presets)) {
      expect(CATALOG[type], type).toBeTruthy();
      for (const p of list) {
        expect(p.name).toBeTruthy();
        expect(p.width).toBeGreaterThan(0);
        expect(p.depth).toBeGreaterThan(0);
      }
    }
  });

  it('the scan carries the preset from the picker to the saved piece', () => {
    const scan = createRoomScan(CATALOG);
    for (const [, pts] of Object.entries({ f: room.walls.front, r: room.walls.right, b: room.walls.back, l: room.walls.left })) {
      pts.forEach((p) => scan.addWallTap({ hit: p, cam: room.inside, normalUp: 1, timeMs: 0 }));
      scan.nextWall();
    }
    scan.startFurniture(CATALOG.bed, { name: 'King', width: 6, depth: 6.25 });
    expect(scan.prompt()).toMatch(/^Bed \(King\): tap once on it/);
  });
});
