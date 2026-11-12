// @vitest-environment jsdom
//
// Runs the real page script against the real index.html. Everything else is
// tested as separate modules; this is the check that they are wired together:
// that every element the script reaches for exists, and that typing a tape
// length actually changes the saved log and the summary.
//
// It cannot start an AR session -- there is no camera here -- so it covers the
// page as it is before and after one, not during.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PerspectiveCamera, Vector3 } from 'three';
import { projectToPixel } from '../src/roomscan/detect/camera_ray.js';

const STORE_KEY = 'roomscan.day1';

function tap(index, x, z, anchored) {
  return {
    index, timeMs: index * 1000, hit: [x, -1.1, z], cam: [x, 0, z + 0.3],
    rangeM: 1.14, depressionDeg: 74.7, normalTiltDeg: 0,
    ...(anchored ? { anchored } : {}),
  };
}

// session 1: one separate line of 61.5 cm.
// session 2: a 120 x 60 outline closed 3 cm short of its start, with the
// second corner anchored 2 cm away from where it was tapped.
const LOG = {
  features: null,
  sessions: [
    { startedAt: 's1', taps: [tap(0, 0, 0), tap(1, 0.615, 0)], trueM: {} },
    {
      startedAt: 's2',
      mode: 'outline',
      taps: [
        tap(0, 0, 0), tap(1, 1.22, 0, [1.2, -1.1, 0]), tap(2, 1.2, 0.6),
        tap(3, 0, 0.6), tap(4, 0.03, 0),
      ],
      trueM: { 0: 1.2 },
    },
  ],
  roomScans: [roomScan()],
};

// A 3.2 x 4.1 m room, turned 15 degrees, floor at -1.1, with one window on
// the right wall: 1.0 m wide from 0 to 1.0 m along it, sill 0.9, top 2.1.
function roomScan() {
  const DEG = Math.PI / 180;
  const W = 3.2, L = 4.1, f = -1.1;
  const x = [Math.cos(15 * DEG), Math.sin(15 * DEG)];
  const z = [-x[1], x[0]];
  const at = (u, v, y = f) => [0.4 + x[0] * u + z[0] * v, y, -0.6 + x[1] * u + z[1] * v];
  const cam = at(0.1, 0.2, f + 1.4);
  const taps = [
    [at(-1, -L / 2), at(1, -L / 2)],          // front
    [at(W / 2, -1.2), at(W / 2, 1.3)],        // right
    [at(-1.1, L / 2), at(0.9, L / 2)],        // back
    [at(-W / 2, -1), at(-W / 2, 1.5)],        // left
  ].flatMap((pts, wall) => pts.map((hit) => ({ wall, hit, cam })));
  const ray = (p) => ({ origin: cam, dir: [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]] });
  // a wardrobe 1.2 m wide against the back wall, front edge 0.6 m out,
  // tapped by someone standing in front of it
  const stand = at(0.5, 0.5, f + 1.3);
  const wardrobeTaps = [at(-0.1, L / 2 - 0.6), at(1.1, L / 2 - 0.6), at(0.4, L / 2)]
    .map((hit) => ({ wall: null, hit, cam: stand }));
  return {
    startedAt: 'r1',
    kind: 'room',
    taps: [...taps, ...wardrobeTaps],
    openings: [{
      type: 'window', wall: 'right',
      corners: [ray(at(W / 2, 0, f + 0.9)), ray(at(W / 2, 1, f + 2.1))],
    }],
    furniture: [{ type: 'wardrobe', kind: 'floor', tapIdx: [8, 9, 10] }],
    detections: [doorPicture(at, L, f)],
  };
}

// A low-view picture of the front wall with a door Gemini found: 0.9 m wide
// from -0.6 to 0.3 m along the wall, 2.0 m tall.
function doorPicture(at, L, f) {
  const PX_W = 480, PX_H = 900;
  const cam = new PerspectiveCamera(60, PX_W / PX_H, 0.05, 50);
  cam.position.set(...at(-0.15, 0.3, f + 1.35));
  cam.lookAt(new Vector3(...at(-0.15, -L / 2, f + 1.35)));
  cam.updateMatrixWorld(true);
  const frame = { projection: cam.projectionMatrix.toArray(), view: cam.matrixWorld.toArray(), width: PX_W, height: PX_H };
  const px = [[-0.6, 0], [0.3, 0], [-0.6, 2], [0.3, 2]]
    .map(([u, h]) => projectToPixel(frame.projection, frame.view, at(u, -L / 2, f + h), PX_W, PX_H));
  const us = px.map((q) => q[0]), vs = px.map((q) => q[1]);
  const box = { x: Math.min(...us), y: Math.min(...vs), w: Math.max(...us) - Math.min(...us), h: Math.max(...vs) - Math.min(...vs) };
  return { ...frame, wallIndex: 0, look: 'low', floorY: f, items: [{ label: 'door', source: 'gemini', score: 0.9, types: [], box }] };
}

const $ = (id) => document.getElementById(id);
const saved = () => JSON.parse(localStorage.getItem(STORE_KEY));
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

const tapeBoxes = () => [...document.querySelectorAll('#result-table input.tape')];

beforeAll(async () => {
  // from the project root: under jsdom this file's own URL is not a file:
  // URL, so the usual "relative to this test" lookup does not work
  const html = readFileSync(resolve(process.cwd(), 'scan.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script', html.indexOf('<body>')));
  localStorage.setItem(STORE_KEY, JSON.stringify(LOG));
  await import('../src/roomscan/main.js');
  await settle();
});

describe('page without AR', () => {
  it('says so and keeps the AR buttons disabled', () => {
    expect($('env-table').textContent).toMatch(/AR sessions supported\s*no/);
    expect($('btn-start').disabled).toBe(true);
    expect($('btn-features').disabled).toBe(true);
  });

  it('offers the three modes, room scan by default, with its how-to card', () => {
    const modes = [...document.querySelectorAll('input[name="mode"]')];
    expect(modes.map((m) => m.value)).toEqual(['room', 'pairs', 'outline']);
    expect(modes[0].checked).toBe(true);
    expect($('measure').dataset.mode).toBe('room');
    expect($('howto').textContent).toMatch(/bottom-left, top-left, top-right, bottom-right/);
    modes[1].checked = true;
    modes[1].dispatchEvent(new window.Event('change', { bubbles: true }));
    expect($('measure').dataset.mode).toBe('pairs');
    modes[0].checked = true;
    modes[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  });
});

describe('off-floor tap confirmation', () => {
  it('is hidden until a tap comes back off the floor', () => {
    expect($('ov-confirm').hidden).toBe(true);
  });

  it('does nothing when there is no held tap', () => {
    click($('ov-use'));
    click($('ov-skip'));
    expect($('ov-confirm').hidden).toBe(true);
    expect($('ov-msg').textContent).toBe('');
  });
});

describe('room scan result from a saved scan', () => {
  it('gives the room in feet and metres, recomputed from the raw taps', () => {
    const text = $('room-summary').textContent;
    expect(text).toMatch(/^Scan: 10\.5 x 13\.45 ft \(3\.20 x 4\.10 m\), ceiling not measured, 2 doors\/windows, 1 piece of furniture\. The camera took 1 picture and found 1 piece: 1 kept, 0 left as suggestions\./);
    expect(text).toMatch(/Walls agree with each other/);
  });

  it('lists the window with the app\'s fields', () => {
    const cells = [...document.querySelectorAll('#room-openings tr')]
      .slice(1)
      .map((tr) => [...tr.children].map((td) => td.textContent));
    expect(cells).toEqual([
      ['window', 'right', '1.64', '3.28', '3.94', '2.95'],
      // found by the camera and kept by default (Gemini)
      ['door', 'front', (-0.15 / 0.3048).toFixed(2), (0.9 / 0.3048).toFixed(2), (2 / 0.3048).toFixed(2), '0.00'],
    ]);
  });

  it('lists the wardrobe where it stands, turned to face into the room', () => {
    const cells = [...document.querySelectorAll('#room-furniture tr')]
      .slice(1)
      .map((tr) => [...tr.children].map((td) => td.textContent));
    // centre 0.5 m right, 0.3 m in from the back wall (2.05 - 0.3 = 1.75 m),
    // then 0.13 ft further in: the app's room size runs to the wall centre
    // lines, and its pieces keep that clearance from them (WALL_CLEARANCE);
    // a wardrobe model faces -z at rotation 0, so facing the room is 0 deg
    expect(cells).toEqual([[
      'Wardrobe', `x ${(0.5 / 0.3048).toFixed(2)}, z ${(1.75 / 0.3048 - 0.13).toFixed(2)}`, '0',
      (1.2 / 0.3048).toFixed(2), (0.6 / 0.3048).toFixed(2), 'width, depth',
    ]]);
  });

  it('has nothing to warn about and offers the download', () => {
    expect($('room-problems').children).toHaveLength(0);
    expect($('btn-design').disabled).toBe(false);
  });
});

describe('review list of pieces found by the camera', () => {
  const doorRow = () => document.querySelector('#room-review tr[data-id]');
  const openingRows = () => [...document.querySelectorAll('#room-openings tr')].slice(1).map((tr) => tr.children[0].textContent);

  it('lists the door as kept, with where it is and its size', () => {
    expect($('review-head').hidden).toBe(false);
    const cells = [...doorRow().children].map((td) => td.textContent);
    expect(cells[0]).toBe('Door');
    expect(cells[1]).toBe('front wall, -0.15 m from its centre');
    expect(cells[2]).toBe('0.90 x 2.00 m');
    expect(doorRow().querySelector('[data-decide="keep"]').classList.contains('on')).toBe(true);
  });

  it('Remove takes it out of the design and is saved', () => {
    click(doorRow().querySelector('[data-decide="remove"]'));
    expect(openingRows()).toEqual(['window']);
    expect(Object.values(saved().roomScans[0].review)).toEqual(['remove']);
    expect(doorRow().className).toBe('removed');
  });

  it('Maybe leaves it as a suggestion', () => {
    click(doorRow().querySelector('[data-decide="maybe"]'));
    expect(openingRows()).toEqual(['window']);
    expect($('room-summary').textContent).toMatch(/0 kept, 1 left as suggestions/);
  });

  it('changing the type keeps it as the new type', () => {
    const select = doorRow().querySelector('select');
    expect([...select.options].map((o) => o.value)).toEqual(['door', 'window']);
    select.value = 'window';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(openingRows()).toEqual(['window', 'window']);
    expect(doorRow().children[0].textContent).toBe('Window (was Door)');
  });
});

describe('results from a saved log', () => {
  it('lists one line for the pair and four for the outline', () => {
    expect(tapeBoxes()).toHaveLength(5);
  });

  it('shows the tag already in the log, in cm', () => {
    expect(tapeBoxes().map((b) => b.value)).toEqual(['', '120', '', '', '']);
  });

  it('judges an anchored line on its anchored position', () => {
    // tapped 122 cm, anchored 120 cm, tape 120 cm: no error
    expect($('summary').textContent).toMatch(/^1 tagged line: median error 0\.0 cm/);
  });

  it('reports how far the outline ended from its start', () => {
    expect($('outline-gaps').textContent).toMatch(/Session 2 outline: last point is 3\.0 cm from the first/);
  });

  it('enables the downloads', () => {
    expect($('btn-json').disabled).toBe(false);
    expect($('btn-csv').disabled).toBe(false);
  });
});

describe('typing a tape length on the results page', () => {
  it('saves it against the right session and line, and updates the summary', () => {
    typeInto(tapeBoxes()[0], '60');
    expect(saved().sessions[0].trueM).toEqual({ 0: 0.6 });
    expect(saved().sessions[1].trueM).toEqual({ 0: 1.2 });
    expect($('summary').textContent).toMatch(/^2 tagged lines/);
    expect($('summary').textContent).toMatch(/worst 1\.5 cm/);
  });

  it('accepts a length that is on no chip', () => {
    typeInto(tapeBoxes()[2], '59.5');          // session 2, line 2
    expect(saved().sessions[1].trueM[1]).toBeCloseTo(0.595, 9);
    expect(tapeBoxes()[2].value).toBe('59.5');
  });

  it('removes the tag when the box is cleared', () => {
    typeInto(tapeBoxes()[0], '');
    expect(saved().sessions[0].trueM).toEqual({});
    expect($('summary').textContent).toMatch(/^2 tagged lines/);
  });

  it('ignores zero and negative lengths', () => {
    typeInto(tapeBoxes()[0], '-5');
    expect(saved().sessions[0].trueM).toEqual({});
    typeInto(tapeBoxes()[0], '0');
    expect(saved().sessions[0].trueM).toEqual({});
  });
});

describe('keypad in the AR overlay', () => {
  const key = (k) => click(document.querySelector(`#kp-keys [data-k="${k}"]`));

  it('is closed until asked for', () => {
    expect($('ov-keypad').hidden).toBe(true);
    click($('ov-type'));
    expect($('ov-keypad').hidden).toBe(false);
  });

  it('builds a number, one decimal point at most, with delete', () => {
    ['1', '2', '0', '.', '.', '5', 'back', '7'].forEach(key);
    expect($('kp-display').textContent).toMatch(/120\.7 cm$/);
  });

  it('starts a bare decimal point with a zero', () => {
    click($('kp-cancel'));
    click($('ov-type'));
    key('.');
    key('5');
    expect($('kp-display').textContent).toMatch(/0\.5 cm$/);
  });

  it('refuses to set an empty length', () => {
    click($('kp-cancel'));
    click($('ov-type'));
    click($('kp-set'));
    expect($('kp-display').textContent).toMatch(/Enter a length/);
    expect($('ov-keypad').hidden).toBe(false);
  });

  it('says so when there is no line to tag, instead of closing silently', () => {
    key('6');
    key('0');
    click($('kp-set'));
    expect($('kp-display').textContent).toMatch(/no line to tag/);
  });

  it('cancel closes it and forgets what was typed', () => {
    click($('kp-cancel'));
    expect($('ov-keypad').hidden).toBe(true);
    click($('ov-type'));
    expect($('kp-display').textContent).toMatch(/_ cm$/);
  });
});
