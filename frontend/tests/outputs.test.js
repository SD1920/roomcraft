import { describe, it, expect } from 'vitest';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';
import { fitRoomRectangle, scanResult } from '../src/roomscan/scan/room_scan.js';
import { fromRoom } from '../src/roomscan/scan/room_frame.js';
import { mergeDetections, MERGE_RADIUS_M } from '../src/roomscan/detect/merge.js';
import { planSvg } from '../src/roomscan/room/plan_sketch.js';
import { toAppDesign, designCsv } from '../src/roomscan/room/app_design.js';

const CATALOG = Object.fromEntries(catalogFile.types.map((t) => [t.id, t]));
const DEG = Math.PI / 180;

// a 3.4 x 4.0 m room, turned 20 degrees, floor at -1.1
const W = 3.4, L = 4.0, F = -1.1;
const x = [Math.cos(20 * DEG), Math.sin(20 * DEG)], z = [-x[1], x[0]];
const at = (u, v, y = F) => [0.3 + x[0] * u + z[0] * v, y, -0.8 + x[1] * u + z[1] * v];
const fit = fitRoomRectangle([
  [at(-1, -L / 2), at(1, -L / 2)], [at(W / 2, -1), at(W / 2, 1)],
  [at(-1, L / 2), at(1, L / 2)], [at(-W / 2, -1), at(-W / 2, 1)],
], at(0, 0, F + 1.4));

// a sighting: room-frame (u, v) placed back into the AR frame, like a real one
const seen = (label, u, v, source = 'gemini', score = 0.8) => ({
  label, score, source, floor: fromRoom(fit, u, v, 0),
  types: source === 'gemini' ? (CATALOG[label] ? [label] : []) : undefined,
});

describe('mergeDetections', () => {
  it('makes one piece from many sightings of the same thing', () => {
    const out = mergeDetections([
      { items: [seen('almirah', 1.2, -0.5)] },
      { items: [seen('almirah', 1.4, -0.3)] },
      { items: [seen('almirah', 1.0, -0.6, 'gemini', 0.95)] },
    ], fit, CATALOG);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'almirah', name: 'Almirah', source: 'gemini', seen: 3, score: 0.95 });
    expect(out[0].x).toBeCloseTo((1.2 + 1.4 + 1.0) / 3, 9);
  });

  it('keeps two of the same type apart when they are far apart', () => {
    const out = mergeDetections([{ items: [seen('bed', -1, 1), seen('bed', 1, 1 - MERGE_RADIUS_M - 0.5)] }], fit, CATALOG);
    expect(out).toHaveLength(2);
  });

  it('lets Gemini overrule the phone at the same spot', () => {
    const out = mergeDetections([
      { items: [seen('refrigerator', 1.2, -0.5, 'phone', 0.7)] },
      { items: [seen('almirah', 1.25, -0.45, 'gemini', 0.9)] },
    ], fit, CATALOG);
    expect(out.map((p) => p.type)).toEqual(['almirah']);
  });

  it('keeps a phone sighting where Gemini saw nothing', () => {
    const out = mergeDetections([{ items: [seen('bed', -1, 1, 'phone', 0.6)] }], fit, CATALOG);
    expect(out[0]).toMatchObject({ type: 'bed', source: 'phone' });
  });

  it('ignores doors, windows, things outside the room, and unplaced boxes', () => {
    const out = mergeDetections([{
      items: [
        seen('door', 0, -L / 2), seen('window', W / 2, 0),
        seen('bed', 0, L / 2 + 2),                         // seen through a doorway
        { label: 'almirah', source: 'gemini', score: 0.9, floor: null },
      ],
    }], fit, CATALOG);
    expect(out).toEqual([]);
  });

  it('gives nothing before the room is known', () => {
    expect(mergeDetections([{ items: [seen('bed', 0, 0)] }], { ok: false }, CATALOG)).toEqual([]);
  });
});

describe('planSvg', () => {
  const result = {
    fit,
    openings: [{ opening: { type: 'door', wall: 'front', position: 0.3, width: 0.9, height: 2, offset: 0 } }],
    furniture: [{ item: { type: 'bed', x: -0.6, z: 0.9, rotation: Math.PI, width: 1, depth: 2, height: 1, elevation: 0 } }],
  };
  const suggestions = [{ type: 'almirah', name: 'Almirah <tall>', source: 'gemini', x: 1.2, z: -0.5, score: 0.9, seen: 3 }];
  const svg = planSvg({ ...result, suggestions, catalog: CATALOG });

  it('is an SVG with all four walls named and the room size written on it', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    for (const wall of ['FRONT', 'BACK', 'LEFT', 'RIGHT']) expect(svg).toContain(wall);
    expect(svg).toContain('3.40 m');
    expect(svg).toContain('4.00 m');
  });

  it('draws the door, the marked bed and the suggestion', () => {
    expect(svg).toContain('door 3.0 ft');
    expect(svg).toContain('>Bed<');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('seen 3x');
  });

  it('escapes names, so text cannot break the drawing', () => {
    expect(svg).toContain('Almirah &lt;tall&gt;?');
    expect(svg).not.toContain('<tall>');
  });

  it('says so when there is no room yet', () => {
    expect(planSvg({ fit: { ok: false } })).toMatch(/No room yet/);
  });
});

describe('designCsv', () => {
  it('lists the room, doors and windows, furniture and suggestions in one table', () => {
    const r = scanResult({ taps: [], openings: [] });
    expect(r.fit.ok).toBe(false);   // a scan with no taps gives no design
    const { design } = toAppDesign({
      fit,
      openings: [{ opening: { type: 'door', wall: 'front', position: 0.3, width: 0.9, height: 2, offset: 0 }, problems: [] }],
      furniture: [{ item: { type: 'bed', x: -0.6, z: 0.9, rotation: Math.PI, width: 1, depth: 2, height: 1, elevation: 0 }, measured: ['width'], problems: [] }],
    }, { catalog: CATALOG, suggestions: [{ type: 'almirah', name: 'Almirah', source: 'gemini', x: 1.2, z: -0.5, score: 0.9, seen: 3 }] });
    const lines = designCsv(design).trimEnd().split('\n');
    expect(lines[0]).toBe('kind,type,name,wall,x_ft,z_ft,position_ft,rotation_deg,width_ft,depth_ft,height_ft,elevation_ft,source,confidence,seen');
    expect(lines.map((l) => l.split(',')[0])).toEqual(['kind', 'room', 'door', 'furniture', 'suggestion']);
    expect(lines[3]).toContain('bed,Bed,');
    expect(lines[3]).toContain(',180,');
    expect(lines[4]).toContain('almirah,Almirah');
    expect(lines[4]).toContain(',gemini,0.9,3');
  });
});
