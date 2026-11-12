import { describe, it, expect } from 'vitest';
import { toAppDesign, M_TO_FT } from '../src/roomscan/room/app_design.js';
import { fitRoomRectangle, openingFromCorners } from '../src/roomscan/scan/room_scan.js';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';

const DEG = Math.PI / 180;

function scanOf(W, L, openingsSpec = []) {
  const x = [Math.cos(31 * DEG), Math.sin(31 * DEG)];
  const z = [-x[1], x[0]];
  const c = [2.2, -0.9], f = -1.1;
  const at = (u, v, y = f) => [c[0] + x[0] * u + z[0] * v, y, c[1] + x[1] * u + z[1] * v];
  const fit = fitRoomRectangle([
    [at(-W / 3, -L / 2), at(W / 3, -L / 2)],
    [at(W / 2, -L / 3), at(W / 2, L / 3)],
    [at(-W / 3, L / 2), at(W / 3, L / 2)],
    [at(-W / 2, -L / 3), at(-W / 2, L / 3)],
  ], at(0, 0, f + 1.4));
  const openings = openingsSpec.map(([type, wall, a, b]) => openingFromCorners(fit, type, wall, at(...a), at(...b)));
  return { fit, openings, at, f };
}

describe('toAppDesign', () => {
  const W = 3.2, L = 4.1;
  const { fit, openings } = scanOf(W, L, [
    ['window', 'right', [W / 2, 0, -1.1 + 0.9], [W / 2, 1, -1.1 + 2.1]],
    ['door', 'front', [0.2, -L / 2, -1.1], [1.1, -L / 2, -1.1 + 2.03]],
  ]);
  const { design, problems } = toAppDesign({ fit, openings }, { name: 'Bedroom scan', roomType: 'bedroom' });

  it('gives the room in feet to the database\'s two decimals', () => {
    expect(design.room_width).toBe(+(W * M_TO_FT).toFixed(2));
    expect(design.room_length).toBe(+(L * M_TO_FT).toFixed(2));
    expect(design.room_width).toBe(10.5);
    expect(design.room_length).toBe(13.45);
  });

  it('is a body the app\'s POST /api/designs accepts', () => {
    expect(design.name).toBe('Bedroom scan');
    expect(design.room_type).toBe('bedroom');
    expect(Array.isArray(design.furniture)).toBe(true);
    expect(Array.isArray(design.openings)).toBe(true);
  });

  it('converts openings to the app\'s fields and units', () => {
    const win = design.openings.find((o) => o.type === 'window');
    expect(win).toEqual({
      id: 'scan-window-1', type: 'window', wall: 'right',
      position: +(0.5 * M_TO_FT).toFixed(2), width: +(1 * M_TO_FT).toFixed(2),
      height: +(1.2 * M_TO_FT).toFixed(2), offset: +(0.9 * M_TO_FT).toFixed(2),
    });
    const door = design.openings.find((o) => o.type === 'door');
    expect(door.wall).toBe('front');
    expect(door.offset).toBe(0);
    // right of the front wall's centre is positive, as in the app's layout.js
    expect(door.position).toBeGreaterThan(0);
    expect(door.position).toBe(+(0.65 * M_TO_FT).toFixed(2));
  });

  it('gives every opening a distinct id', () => {
    expect(new Set(design.openings.map((o) => o.id)).size).toBe(design.openings.length);
  });

  it('reports nothing to check for a clean scan', () => {
    expect(problems).toEqual([]);
    expect(design.scan.verdict).toBe('consistent');
    expect(design.scan.method).toBe('ar-scan');
    expect(design.scan.ceilingMeasured).toBe(false);
  });

  it('warns when the room is below the app\'s 6 ft minimum', () => {
    const small = scanOf(1.5, 1.5);
    expect(toAppDesign(small).problems.join(' ')).toMatch(/6 ft/);
  });

  it('returns no design when the scan produced no room', () => {
    const r = toAppDesign({ fit: { ok: false, error: 'Wall 2 needs 2 taps' }, openings: [] });
    expect(r.design).toBeNull();
    expect(r.problems).toEqual(['Wall 2 needs 2 taps']);
  });

  it('drops an opening that could not be measured and says so', () => {
    const r = toAppDesign({
      fit, openings: [{ opening: null, problems: ['a corner no longer lands on its wall'] }],
    });
    expect(r.design.openings).toEqual([]);
    expect(r.problems.join(' ')).toMatch(/Opening 1 was dropped/);
  });

  it('turns furniture into the app\'s item shape, in feet', () => {
    const catalog = Object.fromEntries(catalogFile.types.map((t) => [t.id, t]));
    const furniture = [
      {
        item: { type: 'bed', x: 0.4, z: -0.2, rotation: Math.PI, width: 1.7, depth: 2.0, height: 1.13, elevation: 0 },
        measured: ['width', 'depth'], problems: [],
      },
      {
        item: { type: 'tv', wallMounted: true, wall: 'left', position: 0.8, elevation: 0.95, width: 1.2, depth: 0.05, height: 0.75 },
        measured: ['width', 'height', 'elevation'], problems: [],
      },
    ];
    const { design } = toAppDesign({ fit, openings: [], furniture }, { catalog });
    const [bed, tv] = design.furniture;
    // the same keys the app's createFurniture / createWallFurniture produce
    expect(Object.keys(bed).sort()).toEqual(
      ['category', 'depth', 'elevation', 'height', 'id', 'name', 'rotation', 'type', 'width', 'x', 'z'],
    );
    expect(Object.keys(tv).sort()).toEqual(
      ['category', 'depth', 'elevation', 'height', 'id', 'name', 'position', 'rotation', 'type', 'wall', 'wallMounted', 'width', 'x', 'z'],
    );
    expect(bed).toMatchObject({ id: 'scan-bed-1', name: 'Bed', category: 'Bedroom', x: +(0.4 * M_TO_FT).toFixed(2), width: +(1.7 * M_TO_FT).toFixed(2) });
    expect(bed.rotation).toBeCloseTo(Math.PI, 4);
    expect(tv).toMatchObject({ wallMounted: true, wall: 'left', position: +(0.8 * M_TO_FT).toFixed(2), elevation: +(0.95 * M_TO_FT).toFixed(2), rotation: 0 });
    expect(design.scan.furniture.map((f) => f.measured)).toEqual([['width', 'depth'], ['width', 'height', 'elevation']]);
  });

  it('drops a piece that could not be measured and says so', () => {
    const r = toAppDesign({ fit, openings: [], furniture: [{ item: null, type: 'bed', measured: [], problems: ['needs both front corners'] }] });
    expect(r.design.furniture).toEqual([]);
    expect(r.problems.join(' ')).toMatch(/Furniture 1 \(bed\) was dropped/);
  });

  it('passes on what is wrong with an opening it keeps', () => {
    const { fit: f2, openings: o2 } = scanOf(W, L, [
      ['door', 'front', [0.2, -L / 2, -1.1 + 0.4], [1.1, -L / 2, -1.1 + 2.03]],
    ]);
    expect(toAppDesign({ fit: f2, openings: o2 }).problems.join(' ')).toMatch(/door 1 on the front wall: lower corner/);
  });
});

describe('ceiling height in the design', () => {
  it('is in feet as room_height, with how it was measured', () => {
    const { fit } = scanOf(3.2, 4.1);
    const { design } = toAppDesign({ fit, openings: [], ceiling: { heightM: 2.95, taps: 2, spreadCm: 3 } });
    expect(design.room_height).toBe(+(2.95 * M_TO_FT).toFixed(2));
    expect(design.scan).toMatchObject({ ceilingMeasured: true, ceilingHeightM: 2.95, ceilingTaps: 2, ceilingSpreadCm: 3 });
  });

  it('says so when it was not measured, instead of guessing one', () => {
    const { fit } = scanOf(3.2, 4.1);
    const { design } = toAppDesign({ fit, openings: [] });
    expect(design.room_height).toBeNull();
    expect(design.scan.ceilingMeasured).toBe(false);
  });
});

describe('settleFurniture: square to the walls, no overlaps', () => {
  it('turns pieces to the nearest quarter and keeps them where they were when free', async () => {
    const { settleFurniture } = await import('../src/roomscan/room/app_design.js');
    const room = { width: 10, length: 14 };
    const chair = { id: 'c', type: 'studyChair', x: 2, z: 3, rotation: 1.2, width: 1.8, depth: 1.8, height: 4.3, elevation: 0 };
    const { furniture, moved } = settleFurniture([chair], room);
    expect(furniture[0].rotation).toBeCloseTo(Math.PI / 2, 4);
    expect(furniture[0].x).toBe(2);
    expect(furniture[0].z).toBe(3);
    expect(moved).toEqual([]);
  });

  it('moves a piece out of another, biggest stays put, and keeps all inside the walls', async () => {
    const { settleFurniture, footprintsOverlap, WALL_CLEARANCE_FT } = await import('../src/roomscan/room/app_design.js');
    const room = { width: 9.4, length: 14.7 };
    const bed = { id: 'bed', type: 'bed', x: 0.8, z: -0.5, rotation: -1.57, width: 3, depth: 6.25, height: 3.7, elevation: 0 };
    const desk = { id: 'desk', type: 'desk', x: 0.8, z: -2, rotation: -1.93, width: 3.5, depth: 2, height: 2.7, elevation: 0 };
    const tv = { id: 'tv', type: 'tv', wallMounted: true, wall: 'left', position: 0, elevation: 3, rotation: 0, x: 0, z: 0, width: 4, depth: 0.18, height: 2.5 };
    const { furniture, moved } = settleFurniture([desk, bed, tv], room);
    const [d, b, t] = furniture;
    expect(b.x).toBe(0.8);                     // the bed, biggest, kept its spot
    expect(b.z).toBe(-0.5);
    expect(footprintsOverlap(d, b)).toBe(false);
    for (const f of [d, b]) {
      expect(Math.abs(Math.sin(2 * f.rotation))).toBeLessThan(1e-3); // a multiple of 90 degrees
      const along = Math.abs(Math.cos(f.rotation)) > 0.5;
      const hw = (along ? f.width : f.depth) / 2, hd = (along ? f.depth : f.width) / 2;
      expect(Math.abs(f.x) + hw).toBeLessThanOrEqual(room.width / 2 - WALL_CLEARANCE_FT + 1e-6);
      expect(Math.abs(f.z) + hd).toBeLessThanOrEqual(room.length / 2 - WALL_CLEARANCE_FT + 1e-6);
    }
    expect(t).toBe(tv);                         // wall pieces untouched
    expect(moved.map((m) => m.id)).toEqual(['desk']);
  });
});
