import { describe, it, expect } from 'vitest';
import {
  fitRoomRectangle, toRoom, fromRoom, rayToWall, intersectWall, openingFromCorners,
  scanResult, createRoomScan, wallLengthM,
} from '../src/roomscan/scan/room_scan.js';

// Every test room is rotated, moved off the origin and has its floor below
// zero, as in a real AR session. A square room on the origin would pass with
// swapped axes, a mirrored frame or a sign error left in.

const DEG = Math.PI / 180;

function makeRoom({ W = 3.2, L = 4.1, rotDeg = 23, centre = [-1.7, 2.4], floorY = -1.15 } = {}) {
  const x = [Math.cos(rotDeg * DEG), Math.sin(rotDeg * DEG)];
  const z = [-x[1], x[0]];
  // (u, v) in the room's own frame: u along the front wall, v towards the back
  const at = (u, v, y = floorY) => [centre[0] + x[0] * u + z[0] * v, y, centre[1] + x[1] * u + z[1] * v];
  const walls = {
    front: [-1.2, 0.3, 1.1].map((s) => at(s, -L / 2)),
    back: [-0.8, 0.9].map((s) => at(s, L / 2)),
    left: [-1.5, 1.4].map((s) => at(-W / 2, s)),
    right: [-1.0, 0.2, 1.6].map((s) => at(W / 2, s)),
  };
  return { W, L, x, z, centre, floorY, at, walls, inside: at(0.2, 0.3, floorY + 1.4) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function expectClose(got, want, digits = 9) {
  want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
}

describe('fitRoomRectangle', () => {
  const room = makeRoom();
  const fit = fitRoomRectangle(
    [room.walls.front, room.walls.left, room.walls.back, room.walls.right],
    room.inside,
  );

  it('measures width and length exactly from clean taps', () => {
    expect(fit.ok).toBe(true);
    expect(fit.widthM).toBeCloseTo(3.2, 9);
    expect(fit.lengthM).toBeCloseTo(4.1, 9);
    expect(fit.floorY).toBeCloseTo(-1.15, 12);
  });

  it('names the walls by geometry, not by tap order', () => {
    expect(fit.labels).toEqual(['front', 'left', 'back', 'right']);
    const other = fitRoomRectangle(
      [room.walls.front, room.walls.right, room.walls.left, room.walls.back],
      room.inside,
    );
    expect(other.labels).toEqual(['front', 'right', 'left', 'back']);
    expect(other.widthM).toBeCloseTo(3.2, 9);
  });

  it('puts the room in the app frame without mirroring it', () => {
    expectClose(fit.xAxis, room.x);
    expectClose(fit.zAxis, room.z);
    expectClose(fit.centre, room.centre);
    // the wall tapped at +x is the one called right
    const r = toRoom(fit, room.walls.right[0]);
    expect(r.x).toBeCloseTo(room.W / 2, 9);
  });

  it('round-trips points between the AR frame and the room frame', () => {
    const p = room.at(0.7, -1.3, room.floorY + 0.85);
    const r = toRoom(fit, p);
    expect(r.x).toBeCloseTo(0.7, 9);
    expect(r.z).toBeCloseTo(-1.3, 9);
    expect(r.y).toBeCloseTo(0.85, 9);
    expectClose(fromRoom(fit, r.x, r.z, r.y), p);
  });

  it('calls clean taps consistent', () => {
    expect(fit.quality.verdict).toBe('consistent');
    expect(fit.quality.maxResidualCm).toBeLessThan(1e-6);
    expect(fit.quality.maxWallAngleDeg).toBeLessThan(1e-6);
  });

  it('stays within a centimetre when every tap is a centimetre off', () => {
    const e = 0.01;
    const wobble = (pts, axis) => pts.map((p, i) => {
      const s = i % 2 ? -e : e;
      return [p[0] + axis[0] * s, p[1], p[2] + axis[1] * s];
    });
    const noisy = fitRoomRectangle([
      wobble(room.walls.front, room.z), wobble(room.walls.left, room.x),
      wobble(room.walls.back, room.z), wobble(room.walls.right, room.x),
    ], room.inside);
    expect(Math.abs(noisy.widthM - 3.2)).toBeLessThan(0.01);
    expect(Math.abs(noisy.lengthM - 4.1)).toBeLessThan(0.01);
    expect(noisy.quality.verdict).toBe('consistent');
  });

  it('flags a wall that is not square to the others', () => {
    const t = Math.tan(12 * DEG);
    const skewed = [-1.5, 1.4].map((s) => room.at(-room.W / 2 + s * t, s));
    const f = fitRoomRectangle([room.walls.front, skewed, room.walls.back, room.walls.right], room.inside);
    expect(f.ok).toBe(true);
    expect(f.quality.verdict).toBe('check');
    expect(f.quality.reasons.join(' ')).toMatch(/off square/);
  });

  it('flags taps that report very different floor heights', () => {
    const raised = room.walls.right.map((p) => [p[0], p[1] + 0.2, p[2]]);
    const f = fitRoomRectangle([room.walls.front, room.walls.left, room.walls.back, raised], room.inside);
    expect(f.quality.verdict).toBe('check');
    expect(f.quality.reasons.join(' ')).toMatch(/floor height/);
  });

  it('refuses a wall whose taps are too close together', () => {
    const tight = [room.at(0, -room.L / 2), room.at(0.1, -room.L / 2)];
    const f = fitRoomRectangle([tight, room.walls.left, room.walls.back, room.walls.right], room.inside);
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/Wall 1/);
  });

  it('refuses when no wall is opposite the front one', () => {
    const middle = [-1.5, 1.4].map((s) => room.at(0.4, s));
    const f = fitRoomRectangle([room.walls.front, room.walls.left, middle, room.walls.right], room.inside);
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/back wall/);
  });

  it('refuses two side walls on the same side', () => {
    const alsoLeft = [-1.5, 1.4].map((s) => room.at(-room.W / 2 + 0.4, s));
    const f = fitRoomRectangle([room.walls.front, room.walls.left, room.walls.back, alsoLeft], room.inside);
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/side walls/);
  });

  it('refuses an opposite wall that is outside the room', () => {
    const behind = [-0.8, 0.9].map((s) => room.at(s, -room.L / 2 - 2));
    const f = fitRoomRectangle([room.walls.front, room.walls.left, behind, room.walls.right], room.inside);
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/room side/);
  });

  it('refuses anything but four walls', () => {
    expect(fitRoomRectangle([room.walls.front], room.inside).ok).toBe(false);
  });
});

describe('rays and walls', () => {
  const room = makeRoom();
  const fit = fitRoomRectangle(
    [room.walls.front, room.walls.left, room.walls.back, room.walls.right],
    room.inside,
  );
  const eye = room.at(0, 0, room.floorY + 1.4);

  it('finds the wall a ray points at, and where', () => {
    const target = room.at(1.0, room.L / 2, room.floorY + 1.2);
    const hit = rayToWall(fit, eye, sub(target, eye));
    expect(hit.wall).toBe('back');
    expectClose(hit.point, target);
  });

  it('takes the nearest wall when a ray near a corner meets two', () => {
    // aimed at the back wall 10 cm from the corner: the right wall's plane is
    // also met, a little further on and still inside its end tolerance
    const target = room.at(room.W / 2 - 0.1, room.L / 2, room.floorY + 1.4);
    expect(intersectWall(fit, 'right', eye, sub(target, eye))).not.toBeNull();
    const hit = rayToWall(fit, eye, sub(target, eye));
    expect(hit.wall).toBe('back');
    expectClose(hit.point, target);
  });

  it('returns nothing for a ray aimed at the floor', () => {
    const down = room.at(0.5, 0.5, room.floorY);
    expect(rayToWall(fit, eye, sub(down, eye))).toBeNull();
  });

  it('ignores a wall the ray only grazes and takes the one it faces', () => {
    const nearFront = room.at(0, -room.L / 2 + 0.02, room.floorY + 1.4);
    const alongFront = sub(room.at(5, -room.L / 2 + 0.02, room.floorY + 1.4), nearFront);
    expect(rayToWall(fit, nearFront, alongFront).wall).toBe('right');
  });

  it('misses a wall when the ray passes beyond its end', () => {
    const past = room.at(room.W / 2 + 1.5, room.L / 2, room.floorY + 1);
    expect(intersectWall(fit, 'back', eye, sub(past, eye))).toBeNull();
  });

  it('reports wall lengths: front and back run the width', () => {
    expect(wallLengthM(fit, 'front')).toBeCloseTo(3.2, 9);
    expect(wallLengthM(fit, 'left')).toBeCloseTo(4.1, 9);
  });
});

describe('openingFromCorners', () => {
  const room = makeRoom();
  const fit = fitRoomRectangle(
    [room.walls.front, room.walls.left, room.walls.back, room.walls.right],
    room.inside,
  );
  const W2 = room.W / 2, L2 = room.L / 2, f = room.floorY;

  it('measures a window from either diagonal, in either order', () => {
    const want = { type: 'window', wall: 'right', position: 0.5, width: 1.0, height: 1.2, offset: 0.9 };
    for (const [a, b] of [
      [room.at(W2, 0, f + 0.9), room.at(W2, 1, f + 2.1)],
      [room.at(W2, 1, f + 2.1), room.at(W2, 0, f + 0.9)],
      [room.at(W2, 0, f + 2.1), room.at(W2, 1, f + 0.9)],
    ]) {
      const { opening, problems } = openingFromCorners(fit, 'window', 'right', a, b);
      for (const [k, v] of Object.entries(want)) {
        if (typeof v === 'number') expect(opening[k]).toBeCloseTo(v, 9);
        else expect(opening[k]).toBe(v);
      }
      expect(problems).toEqual([]);
    }
  });

  it('measures a door from the floor, with no sill', () => {
    const { opening, problems } = openingFromCorners(
      fit, 'door', 'front', room.at(-0.4, -L2, f), room.at(0.5, -L2, f + 2.03),
    );
    expect(opening.position).toBeCloseTo(0.05, 9);
    expect(opening.width).toBeCloseTo(0.9, 9);
    expect(opening.height).toBeCloseTo(2.03, 9);
    expect(opening.offset).toBe(0);
    expect(problems).toEqual([]);
  });

  it('flags a door whose lower corner is off the floor', () => {
    const { problems } = openingFromCorners(
      fit, 'door', 'front', room.at(-0.4, -L2, f + 0.4), room.at(0.5, -L2, f + 2.03),
    );
    expect(problems.join(' ')).toMatch(/above the floor/);
  });

  it('flags an opening that runs past the end of its wall', () => {
    const { problems } = openingFromCorners(
      fit, 'window', 'right', room.at(W2, 1.8, f + 1), room.at(W2, 2.6, f + 2),
    );
    expect(problems.join(' ')).toMatch(/past the end/);
  });

  it('measures along z on a side wall, positive towards the back', () => {
    const { opening } = openingFromCorners(
      fit, 'window', 'left', room.at(-W2, 0.8, f + 1), room.at(-W2, 1.6, f + 2),
    );
    expect(opening.position).toBeCloseTo(1.2, 9);
  });
});

describe('the guided scan', () => {
  const room = makeRoom();
  const hit = (p, timeMs = 0) => ({ hit: p, cam: room.inside, normalUp: 1, timeMs });
  const rayTo = (p) => ({ origin: room.inside, dir: sub(p, room.inside) });

  function walledScan() {
    const scan = createRoomScan();
    for (const name of ['front', 'right', 'back', 'left']) {
      room.walls[name].forEach((p) => scan.addWallTap(hit(p)));
      expect(scan.nextWall().ok).toBe(true);
    }
    return scan;
  }

  it('will not move on from a wall with one tap', () => {
    const scan = createRoomScan();
    scan.addWallTap(hit(room.walls.front[0]));
    expect(scan.canFinishWall()).toBe(false);
    const r = scan.nextWall();
    expect(r.ok).toBe(false);
    expect(scan.wallNumber()).toBe(1);
  });

  it('goes from walls to doors, windows and furniture once four walls are in', () => {
    const scan = walledScan();
    expect(scan.phase()).toBe('extras');
    const { fit } = scan.result();
    expect(fit.widthM).toBeCloseTo(3.2, 9);
    expect(fit.lengthM).toBeCloseTo(4.1, 9);
  });

  it('records a door from two aimed corners', () => {
    const scan = walledScan();
    expect(scan.addOpeningCorner(rayTo(room.at(0, -room.L / 2, room.floorY + 1))).ok).toBe(false);
    scan.startOpening('door');
    expect(scan.addOpeningCorner(rayTo(room.at(-0.4, -room.L / 2, room.floorY + 0.01))).ok).toBe(true);
    expect(scan.pendingCorner()).not.toBeNull();
    expect(scan.addOpeningCorner(rayTo(room.at(0.5, -room.L / 2, room.floorY + 2.03))).ok).toBe(true);
    const [door] = scan.result().openings;
    expect(door.opening.wall).toBe('front');
    expect(door.opening.width).toBeCloseTo(0.9, 6);
    expect(door.opening.height).toBeCloseTo(2.03, 6);
  });

  it('keeps both corners of an opening on one wall', () => {
    const scan = walledScan();
    scan.startOpening('window');
    scan.addOpeningCorner(rayTo(room.at(room.W / 2, 0, room.floorY + 1)));
    const r = scan.addOpeningCorner(rayTo(room.at(0, room.L / 2, room.floorY + 2)));
    expect(r.ok).toBe(false);
    // named the way the user saw the room, not by the app's internal name
    expect(r.message).toMatch(/not on the same wall as the first one \(the wall on your right when you face your first wall\)/);
    expect(r.message).toMatch(/opposite corner of the same window/);
  });

  it('refuses a corner aimed at the floor', () => {
    const scan = walledScan();
    scan.startOpening('window');
    expect(scan.addOpeningCorner(rayTo(room.at(0.3, 0.3, room.floorY))).ok).toBe(false);
  });

  it('undoes one step at a time, back across into the walls', () => {
    const scan = walledScan();
    scan.startOpening('door');
    scan.addOpeningCorner(rayTo(room.at(-0.4, -room.L / 2, room.floorY)));
    scan.undo();                                   // the corner
    expect(scan.pendingCorner()).toBeNull();
    expect(scan.pendingType()).toBe('door');
    scan.undo();                                   // the door itself
    expect(scan.pendingType()).toBeNull();
    scan.undo();                                   // back to the walls
    expect(scan.phase()).toBe('walls');
    const before = scan.tapCount();
    scan.undo();                                   // the last tap on wall 4
    expect(scan.tapCount()).toBe(before - 1);
  });

  it('uses anchored positions when the phone corrects a tap', () => {
    const scan = walledScan();
    const before = scan.result().fit.lengthM;
    // move every front-wall tap 5 cm further out of the room
    scan.saved().taps.forEach((t, i) => {
      if (t.wall === 0) scan.setAnchored(i, [t.hit[0] - room.z[0] * 0.05, t.hit[1], t.hit[2] - room.z[1] * 0.05]);
    });
    expect(scan.result().fit.lengthM).toBeCloseTo(before + 0.05, 9);
  });

  it('recomputes a saved scan to the same result', () => {
    const scan = walledScan();
    scan.startOpening('window');
    scan.addOpeningCorner(rayTo(room.at(room.W / 2, 0, room.floorY + 0.9)));
    scan.addOpeningCorner(rayTo(room.at(room.W / 2, 1, room.floorY + 2.1)));
    const reloaded = scanResult(JSON.parse(JSON.stringify(scan.saved())));
    expect(reloaded.fit.widthM).toBeCloseTo(3.2, 9);
    expect(reloaded.openings[0].opening.offset).toBeCloseTo(0.9, 6);
  });

  it('clear starts again from the front wall', () => {
    const scan = walledScan();
    scan.clear();
    expect(scan.phase()).toBe('walls');
    expect(scan.wallNumber()).toBe(1);
    expect(scan.tapCount()).toBe(0);
    expect(scan.prompt()).toMatch(/^Wall 1 \(door wall\): tap corner 1, bottom-left/);
  });
});

describe('walls placed from a tap on their own surface', () => {
  const room = makeRoom();
  // a tap high on the left wall, above an almirah; the surface faces into
  // the room, which is +x in the room's own frame
  const surface = (u, v, h, normal) => ({ p: room.at(u, v, room.floorY + h), n: normal });
  const leftFromSurface = [surface(-room.W / 2, 0.4, 1.5, room.x)];

  it('measures the room exactly with one wall given by one surface tap', () => {
    const f = fitRoomRectangle([room.walls.front, leftFromSurface, room.walls.back, room.walls.right], room.inside);
    expect(f.ok).toBe(true);
    expect(f.labels[1]).toBe('left');
    expect(f.widthM).toBeCloseTo(room.W, 9);
    expect(f.lengthM).toBeCloseTo(room.L, 9);
  });

  it('takes the floor height from floor taps only, not from up the wall', () => {
    const f = fitRoomRectangle([room.walls.front, leftFromSurface, room.walls.back, room.walls.right], room.inside);
    expect(f.floorY).toBeCloseTo(room.floorY, 12);
    expect(f.quality.floorSpreadCm).toBeLessThan(1e-6);
  });

  it('accepts a normal pointing either way along the wall', () => {
    const outward = [surface(-room.W / 2, 0.4, 1.5, [-room.x[0], -room.x[1]])];
    const f = fitRoomRectangle([room.walls.front, outward, room.walls.back, room.walls.right], room.inside);
    expect(f.widthM).toBeCloseTo(room.W, 9);
  });

  it('needs at least one floor tap somewhere', () => {
    const all = [
      [surface(0, -room.L / 2, 1.4, room.z)], [surface(-room.W / 2, 0, 1.4, room.x)],
      [surface(0, room.L / 2, 1.4, room.z)], [surface(room.W / 2, 0, 1.4, room.x)],
    ];
    const f = fitRoomRectangle(all, room.inside);
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/floor height/);
  });

  describe('in the guided scan', () => {
    const hit = (p, normal) => ({ hit: p, cam: room.inside, normalUp: normal[1], normal, timeMs: 0 });
    const wallNormal3 = [room.x[0], 0, room.x[1]];

    it('lets one surface tap finish a wall, but not a tap on a level surface', () => {
      const scan = createRoomScan();
      room.walls.front.forEach((p) => scan.addWallTap(hit(p, [0, 1, 0])));
      scan.nextWall();
      expect(scan.addWallSurfaceTap(hit(room.at(-room.W / 2 + 0.5, 0, room.floorY + 0.6), [0, 1, 0]))).toBe(false);
      expect(scan.canFinishWall()).toBe(false);
      expect(scan.addWallSurfaceTap(hit(room.at(-room.W / 2, 0.4, room.floorY + 1.5), wallNormal3))).toBe(room.walls.front.length);
      expect(scan.canFinishWall()).toBe(true);
      expect(scan.nextWall().ok).toBe(true);
    });

    it('measures the room from a mix of floor and surface taps', () => {
      const scan = createRoomScan();
      room.walls.front.forEach((p) => scan.addWallTap(hit(p, [0, 1, 0])));
      scan.nextWall();
      scan.addWallSurfaceTap(hit(room.at(-room.W / 2, 0.4, room.floorY + 1.5), wallNormal3));
      scan.nextWall();
      room.walls.back.forEach((p) => scan.addWallTap(hit(p, [0, 1, 0])));
      scan.nextWall();
      room.walls.right.forEach((p) => scan.addWallTap(hit(p, [0, 1, 0])));
      expect(scan.nextWall().ok).toBe(true);
      const { fit } = scanResult(JSON.parse(JSON.stringify(scan.saved())));
      expect(fit.widthM).toBeCloseTo(room.W, 9);
    });
  });
});

describe('an opening with both corners in the same place', () => {
  const room = makeRoom();
  const hit = (p) => ({ hit: p, cam: room.inside, normalUp: 1, timeMs: 0 });
  const rayTo = (p) => ({ origin: room.inside, dir: sub(p, room.inside) });

  it('is refused at the second corner, with a hint, and the first corner kept', () => {
    const scan = createRoomScan();
    for (const name of ['front', 'right', 'back', 'left']) {
      room.walls[name].forEach((p) => scan.addWallTap(hit(p)));
      scan.nextWall();
    }
    scan.startOpening('door');
    scan.addOpeningCorner(rayTo(room.at(-0.4, -room.L / 2, room.floorY)));
    const r = scan.addOpeningCorner(rayTo(room.at(-0.35, -room.L / 2, room.floorY + 2)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/only 5 cm apart.*OPPOSITE/);
    expect(scan.result().openings).toHaveLength(0);
    expect(scan.pendingCorner()).not.toBeNull();
    expect(scan.addOpeningCorner(rayTo(room.at(0.5, -room.L / 2, room.floorY + 2))).ok).toBe(true);
    expect(scan.result().openings[0].opening.width).toBeCloseTo(0.9, 6);
  });
});

describe('ceiling height', () => {
  const room = makeRoom();
  const hit = (p) => ({ hit: p, cam: room.inside, normalUp: 1, timeMs: 0 });
  const rayTo = (p) => ({ origin: room.inside, dir: sub(p, room.inside) });
  const CEIL = 2.95;

  function walled() {
    const scan = createRoomScan();
    for (const name of ['front', 'right', 'back', 'left']) {
      room.walls[name].forEach((p) => scan.addWallTap(hit(p)));
      scan.nextWall();
    }
    return scan;
  }

  it('comes from a tap at the line where a wall meets the ceiling', () => {
    const scan = walled();
    expect(scan.result().ceiling).toBeNull();
    scan.startCeiling();
    expect(scan.pendingKind()).toBe('ceiling');
    const r = scan.addCeilingPoint(rayTo(room.at(0.4, room.L / 2, room.floorY + CEIL)));
    expect(r.ok).toBe(true);
    expect(r.heightM).toBeCloseTo(CEIL, 9);
    expect(scan.result().ceiling).toEqual({ heightM: expect.closeTo(CEIL, 9), taps: 1, spreadCm: 0 });
  });

  it('takes the median of several readings and reports their spread', () => {
    const scan = walled();
    for (const [u, v, dh] of [[0.4, room.L / 2, 0], [room.W / 2, 0.3, 0.04], [-room.W / 2, -0.6, -0.02]]) {
      scan.startCeiling();
      const p = Math.abs(v) === room.L / 2 ? room.at(u, v, room.floorY + CEIL + dh) : room.at(u, v, room.floorY + CEIL + dh);
      expect(scan.addCeilingPoint(rayTo(p)).ok).toBe(true);
    }
    const c = scan.result().ceiling;
    expect(c.taps).toBe(3);
    expect(c.heightM).toBeCloseTo(CEIL, 9);
    expect(c.spreadCm).toBeCloseTo(6, 6);
  });

  it('refuses a tap that is nowhere near a ceiling', () => {
    const scan = walled();
    scan.startCeiling();
    const r = scan.addCeilingPoint(rayTo(room.at(0.4, room.L / 2, room.floorY + 1.1)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/1\.10 m up, which is not a ceiling/);
    expect(scan.result().ceiling).toBeNull();
  });

  it('is undone like everything else, and saved for recomputing', () => {
    const scan = walled();
    scan.startCeiling();
    scan.addCeilingPoint(rayTo(room.at(0.4, room.L / 2, room.floorY + CEIL)));
    const again = scanResult(JSON.parse(JSON.stringify(scan.saved())));
    expect(again.ceiling.heightM).toBeCloseTo(CEIL, 9);
    scan.undo();
    expect(scan.result().ceiling).toBeNull();
    expect(scan.phase()).toBe('extras');
  });
});

describe('wall stations: base, then top (ceiling) during the walls step', () => {
  const room = makeRoom();
  const hit = (p) => ({ hit: p, cam: room.inside, normalUp: 1, timeMs: 0 });
  const rayTo = (p) => ({ origin: room.inside, dir: sub(p, room.inside) });
  const CEIL = 2.95;
  const order = ['front', 'right', 'back', 'left'];
  const topOf = { front: [0.4, -room.L / 2], right: [room.W / 2, 0.3], back: [-0.3, room.L / 2], left: [-room.W / 2, -0.6] };

  it('reports what the current wall still needs', () => {
    const scan = createRoomScan();
    expect(scan.station()).toEqual({ wall: 0, base: false, top: false });
    room.walls.front.forEach((p) => scan.addWallTap(hit(p)));
    expect(scan.station()).toEqual({ wall: 0, base: true, top: false });
    expect(scan.addWallTopPoint(rayTo(room.at(...topOf.front, room.floorY + CEIL))).ok).toBe(true);
    expect(scan.station()).toEqual({ wall: 0, base: true, top: true });
    scan.nextWall();
    expect(scan.station()).toEqual({ wall: 1, base: false, top: false });
  });

  it('needs the base first', () => {
    const scan = createRoomScan();
    const r = scan.addWallTopPoint(rayTo(room.at(...topOf.front, room.floorY + CEIL)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/base first/);
  });

  it('gives the ceiling height from one top tap per wall, once the room is fitted', () => {
    const scan = createRoomScan();
    const dh = { front: 0, right: 0.03, back: -0.01, left: 0.01 };
    for (const name of order) {
      room.walls[name].forEach((p) => scan.addWallTap(hit(p)));
      const r = scan.addWallTopPoint(rayTo(room.at(...topOf[name], room.floorY + CEIL + dh[name])));
      expect(r.ok).toBe(true);
      expect(r.heightM).toBeCloseTo(CEIL + dh[name], 6);
      scan.nextWall();
    }
    expect(scan.phase()).toBe('extras');
    const c = scan.result().ceiling;
    expect(c.taps).toBe(4);
    expect(c.heightM).toBeCloseTo(CEIL + 0.005, 6);
    expect(c.spreadCm).toBeCloseTo(4, 6);
    const again = scanResult(JSON.parse(JSON.stringify(scan.saved())));
    expect(again.ceiling.heightM).toBeCloseTo(CEIL + 0.005, 6);
  });

  it('keeps only the newest top tap for a wall, and undo removes it before the base', () => {
    const scan = createRoomScan();
    room.walls.front.forEach((p) => scan.addWallTap(hit(p)));
    scan.addWallTopPoint(rayTo(room.at(...topOf.front, room.floorY + 2.5)));
    scan.addWallTopPoint(rayTo(room.at(...topOf.front, room.floorY + CEIL)));
    expect(scan.saved().ceiling).toHaveLength(1);
    scan.undo();
    expect(scan.station()).toEqual({ wall: 0, base: true, top: false });
    expect(scan.tapCount()).toBe(room.walls.front.length);
  });

  it('refuses a top tap that is not near a ceiling', () => {
    const scan = createRoomScan();
    room.walls.front.forEach((p) => scan.addWallTap(hit(p)));
    const r = scan.addWallTopPoint(rayTo(room.at(...topOf.front, room.floorY + 1.2)));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/1\.20 m up/);
  });
});

describe('walls by corners: bottom-left, top-left, top-right, bottom-right', () => {
  const room = makeRoom();
  const { W, L } = room;
  const CEIL = 2.6, IN = 0.1; // taps 10 cm in from the true corners
  const hit = (p) => ({ hit: p, cam: room.inside, normalUp: 1, timeMs: 0 });
  const rayTo = (p) => ({ origin: room.inside, dir: sub(p, room.inside) });
  const up = (u, v) => room.at(u, v, room.floorY + CEIL);
  // [bottom-left, bottom-right] in room (u, v), each wall seen from inside, turning right
  const WALLS = [
    [[-W / 2 + IN, -L / 2], [W / 2 - IN, -L / 2]], // 1 front
    [[W / 2, -L / 2 + IN], [W / 2, L / 2 - IN]],   // 2 right
    [[W / 2 - IN, L / 2], [-W / 2 + IN, L / 2]],   // 3 back
    [[-W / 2, L / 2 - IN], [-W / 2, -L / 2 + IN]], // 4 left
  ];
  function doWall(scan, [[u1, v1], [u2, v2]]) {
    expect(scan.addBottomCorner(hit(room.at(u1, v1))).ok).toBe(true);
    expect(scan.addTopCorner(rayTo(up(u1, v1))).ok).toBe(true);
    expect(scan.addTopCorner(rayTo(up(u2, v2))).ok).toBe(true);
    expect(scan.addBottomCorner(hit(room.at(u2, v2))).ok).toBe(true);
  }
  function allWalls(walls = WALLS) {
    const scan = createRoomScan();
    walls.forEach((w, i) => {
      doWall(scan, w);
      if (i < 3) expect(scan.nextWall().ok).toBe(true);
    });
    return scan;
  }

  it('asks for the corners in order, and measures the wall', () => {
    const scan = createRoomScan();
    const [[u1, v1], [u2, v2]] = WALLS[0];
    expect(scan.cornerStep()).toBe('bl');
    expect(scan.wantsFloorTap()).toBe(true);
    scan.addBottomCorner(hit(room.at(u1, v1)));
    expect(scan.cornerStep()).toBe('tl');
    expect(scan.wantsFloorTap()).toBe(false);
    expect(scan.prompt()).toMatch(/corner 2, top-left/);
    scan.addTopCorner(rayTo(up(u1, v1)));
    expect(scan.cornerStep()).toBe('tr');
    scan.addTopCorner(rayTo(up(u2, v2)));
    expect(scan.cornerStep()).toBe('br');
    expect(scan.wantsFloorTap()).toBe(true);
    scan.addBottomCorner(hit(room.at(u2, v2)));
    expect(scan.cornerStep()).toBeNull();
    expect(scan.cornerState()).toEqual({ bl: 'done', tl: 'done', tr: 'done', br: 'done' });
    const s = scan.wallSummary();
    expect(s.lengthM).toBeCloseTo(W - 2 * IN, 9);
    expect(s.heightM).toBeCloseTo(CEIL, 9);
    expect(scan.prompt()).toMatch(/^Wall 1 done\. Tap Next wall, turn right/);
  });

  it('closes after wall 4 when the last corner comes back to the first', () => {
    const scan = createRoomScan();
    WALLS.slice(0, 3).forEach((w) => { doWall(scan, w); scan.nextWall(); });
    expect(scan.closure()).toBeNull(); // wall 4 not done yet
    doWall(scan, WALLS[3]);
    const c = scan.closure();
    expect(c.closed).toBe(true);
    expect(c.gapM).toBeCloseTo(Math.SQRT2 * IN, 9);
    expect(scan.closeRoom().ok).toBe(true);
    expect(scan.phase()).toBe('extras');
    const r = scan.result();
    expect(r.fit.widthM).toBeCloseTo(W, 9);
    expect(r.fit.lengthM).toBeCloseTo(L, 9);
    expect(r.ceiling).toEqual({ heightM: expect.closeTo(CEIL, 9), taps: 8, spreadCm: expect.closeTo(0, 6) });
  });

  it('does not close when the walls disagree, unless the user closes anyway', () => {
    const skewed = WALLS.map((w) => w.map((p) => [...p]));
    skewed[2][1] = [-W / 2 + IN, L / 2 - 0.6]; // the back wall 15 degrees off
    skewed[3][1] = [-W / 2, 0];                 // the last corner far from the first
    const scan = allWalls(skewed);
    const c = scan.closure();
    expect(c.closed).toBe(false);
    expect(c.message).toMatch(/cm from the first/);
    expect(scan.closeRoom().ok).toBe(false);
    expect(scan.phase()).toBe('walls');
    expect(scan.closeRoom({ force: true }).ok).toBe(true);
    expect(scan.phase()).toBe('extras');
  });

  it('takes a tap on the wall itself when a bottom corner is hidden', () => {
    const scan = createRoomScan();
    const [[u1, v1], [u2, v2]] = WALLS[0];
    const onWall = { ...hit(room.at(u1, v1, room.floorY + 1.0)), normal: [room.z[0], 0, room.z[1]] };
    expect(scan.addBottomCorner(onWall, { onWall: true }).ok).toBe(true);
    scan.addTopCorner(rayTo(up(u1, v1)));
    scan.addTopCorner(rayTo(up(u2, v2)));
    scan.addBottomCorner(hit(room.at(u2, v2)));
    expect(scan.wallSummary().lengthM).toBeCloseTo(W - 2 * IN, 9);
    expect(scan.wallSummary().heightM).toBeCloseTo(CEIL, 9);
  });

  it('lets the top corners be skipped, and the wall still finishes', () => {
    const scan = createRoomScan();
    const [[u1, v1], [u2, v2]] = WALLS[0];
    scan.addBottomCorner(hit(room.at(u1, v1)));
    expect(scan.skipCorner()).toBe(true);
    expect(scan.skipCorner()).toBe(true);
    expect(scan.skipCorner()).toBe(false); // a bottom corner cannot be skipped
    scan.addBottomCorner(hit(room.at(u2, v2)));
    expect(scan.cornerState()).toEqual({ bl: 'done', tl: 'skipped', tr: 'skipped', br: 'done' });
    expect(scan.wallSummary().heightM).toBeNull();
    expect(scan.nextWall().ok).toBe(true);
  });

  it('refuses a top corner aimed down, and a bottom-right on top of the bottom-left', () => {
    const scan = createRoomScan();
    const [[u1, v1]] = WALLS[0];
    scan.addBottomCorner(hit(room.at(u1, v1)));
    const down = scan.addTopCorner(rayTo(room.at(u1, v1)));
    expect(down.ok).toBe(false);
    expect(down.message).toMatch(/Tilt the phone UP/);
    scan.skipCorner();
    scan.skipCorner();
    const near = scan.addBottomCorner(hit(room.at(u1 + 0.1, v1)));
    expect(near.ok).toBe(false);
    expect(near.message).toMatch(/bottom-RIGHT corner, at the other end/);
    expect(scan.cornerStep()).toBe('br');
  });

  it('undo steps back one corner at a time, across walls; Redo wall clears the wall', () => {
    const scan = createRoomScan();
    const [[u1, v1]] = WALLS[0];
    scan.addBottomCorner(hit(room.at(u1, v1)));
    scan.addTopCorner(rayTo(up(u1, v1)));
    scan.undo();
    expect(scan.cornerStep()).toBe('tl');
    expect(scan.saved().ceiling).toHaveLength(0);
    scan.undo();
    expect(scan.cornerStep()).toBe('bl');
    expect(scan.tapCount()).toBe(0);

    doWall(scan, WALLS[0]);
    scan.nextWall();
    doWall(scan, WALLS[1]);
    expect(scan.redoWall()).toBe(true);
    expect(scan.cornerStep()).toBe('bl');
    expect(scan.tapCount()).toBe(2);
    expect(scan.saved().ceiling).toHaveLength(2);
    scan.undo(); // nothing on wall 2: back to wall 1, all done
    expect(scan.wallNumber()).toBe(1);
    expect(scan.cornerStep()).toBeNull();
    scan.undo();
    expect(scan.cornerStep()).toBe('br');
  });
});

describe('a room with furniture along the walls (1 Nov hostel-room scan)', () => {
  const room = makeRoom();
  const { W, L } = room;
  const CEIL = 2.74, IN = 0.1;
  const WALLS = [
    [[-W / 2 + IN, -L / 2], [W / 2 - IN, -L / 2]],
    [[W / 2, -L / 2 + IN], [W / 2, L / 2 - IN]],
    [[W / 2 - IN, L / 2], [-W / 2 + IN, L / 2]],
    [[-W / 2, L / 2 - IN], [-W / 2, -L / 2 + IN]],
  ];
  const INTO_ROOM = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  const hit = (p) => ({ hit: p, cam: room.inside, normalUp: 1, timeMs: 0 });
  const top = (u, v) => ({ origin: room.inside, dir: sub(room.at(u, v, room.floorY + CEIL), room.inside) });

  /** Walls 2 and 3: their bottom corners hidden, the ring lands on a bed top 60 cm up, 50 cm in front. */
  function scanWithFurniture({ skipTops = false } = {}) {
    const scan = createRoomScan();
    WALLS.forEach((corners, i) => {
      const hidden = i === 1 || i === 2;
      const [du, dv] = INTO_ROOM[i];
      const bottom = ([u, v]) => (hidden
        ? room.at(u + du * 0.5, v + dv * 0.5, room.floorY + 0.6)
        : room.at(u, v));
      scan.addBottomCorner(hit(bottom(corners[0])));
      if (skipTops) { scan.skipCorner(); scan.skipCorner(); } else {
        scan.addTopCorner(top(...corners[0]));
        scan.addTopCorner(top(...corners[1]));
      }
      scan.addBottomCorner(hit(bottom(corners[1])));
      if (i < 3) scan.nextWall();
    });
    return scan;
  }

  it('places the hidden walls from their top corners: size and ceiling right', () => {
    const r = scanWithFurniture().result();
    expect(r.onFurniture).toBe(4);
    expect(r.fit.widthM).toBeCloseTo(W, 6);
    expect(r.fit.lengthM).toBeCloseTo(L, 6);
    expect(r.fit.quality.maxWallAngleDeg).toBeLessThan(1e-6);
    expect(r.ceiling.heightM).toBeCloseTo(CEIL, 6);
  });

  it('without top corners it can only use the furniture taps (why the top corners matter)', () => {
    const r = scanWithFurniture({ skipTops: true }).result();
    expect(r.fit.widthM).toBeLessThan(W - 0.3);
    expect(r.ceiling).toBeNull();
  });

  it('still takes a door corner aimed a little past the measured end of a wall', () => {
    const scan = createRoomScan();
    WALLS.forEach(([[u1, v1], [u2, v2]], i) => {
      scan.addBottomCorner({ hit: room.at(u1, v1), cam: room.inside, normalUp: 1, timeMs: 0 });
      scan.skipCorner();
      scan.skipCorner();
      scan.addBottomCorner({ hit: room.at(u2, v2), cam: room.inside, normalUp: 1, timeMs: 0 });
      if (i < 3) scan.nextWall();
    });
    expect(scan.closeRoom().ok).toBe(true);
    scan.startOpening('door');
    // 0.6 m past the front wall's right end: outside the strict 0.3 m tolerance
    const p = room.at(W / 2 + 0.6, -L / 2, room.floorY + 0.05);
    const r = scan.addOpeningCorner({ origin: room.inside, dir: sub(p, room.inside) });
    expect(r.ok).toBe(true);
  });
});
