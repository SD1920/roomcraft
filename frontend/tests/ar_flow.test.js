// @vitest-environment jsdom
//
// The room scan end to end, as a user does it, with the AR session faked:
//   pass 1: each wall by its 4 corners (bottom-left, top-left, top-right,
//           bottom-right); wall 2's bottom-left hidden, so tapped on the wall
//           itself; wall 3's top corners skipped; then the room closes
//   pass 2: a door by 2 corners, a Queen bed by its 2 front corners, a camera
//           guess in the picker; Finish
// and the results page must show the room, the ceiling, the door and the bed.
//
// What it cannot check: the real camera, real hit tests, timing on a phone.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Scene } from 'three';

const fake = vi.hoisted(() => ({ session: null, callbacks: null, gemini: null, now: 0 }));

vi.mock('../src/roomscan/ar/session.js', () => ({
  startSession: async (callbacks) => {
    fake.callbacks = callbacks;
    return fake.session;
  },
}));
vi.mock('../src/roomscan/detect/detector.js', () => ({
  detectObjects: async () => ({ items: [], ms: 5, loadMs: 0 }),
}));
vi.mock('../src/roomscan/detect/gemini_client.js', () => ({
  jpegBase64: () => 'AAAA',
  geminiDetect: async () => fake.gemini,
}));

const FT = 0.3048;
const DEG = Math.PI / 180;
const W = 3.2, L = 4.1, f = -1.1, CEIL = 2.7, IN = 0.1;
const xa = [Math.cos(15 * DEG), Math.sin(15 * DEG)];
const za = [-xa[1], xa[0]];
const at = (u, v, y = 0) => [0.4 + xa[0] * u + za[0] * v, f + y, -0.6 + xa[1] * u + za[1] * v];
const cam = at(0.1, 0.2, 1.4);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rayTo = (p) => ({ origin: cam, dir: sub(p, cam) });
const floorHit = (p) => ({ hit: p, cam, normalUp: 1, normal: [0, 1, 0], isFloor: true, isWall: false, floorEstimate: f, timeMs: 0 });

// each wall's bottom-left and bottom-right, 10 cm in from the true corners,
// seen from inside the room, turning right
const WALLS = [
  [[-W / 2 + IN, -L / 2], [W / 2 - IN, -L / 2]], // 1 front (the door wall)
  [[W / 2, -L / 2 + IN], [W / 2, L / 2 - IN]],   // 2 right
  [[W / 2 - IN, L / 2], [-W / 2 + IN, L / 2]],   // 3 back
  [[-W / 2, L / 2 - IN], [-W / 2, -L / 2 + IN]], // 4 left
];

const $ = (id) => document.getElementById(id);
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const tap = (t) => { fake.now += 1000; return fake.callbacks.onTap(t); };
const floorTap = ([u, v]) => tap({ floorHit: floorHit(at(u, v)), ray: rayTo(at(u, v)), hit: floorHit(at(u, v)) });
const aimTap = (p) => tap({ floorHit: null, ray: rayTo(p), hit: null });
/** A frame with the ring on `hit`, so the status line refreshes. */
const frame = (hit = null) => { fake.now += 200; fake.callbacks.onHit(hit); };
const visible = (id) => !$(id).hidden;

beforeAll(async () => {
  vi.spyOn(performance, 'now').mockImplementation(() => fake.now);
  window.HTMLCanvasElement.prototype.getContext = () => ({ putImageData() {}, drawImage() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  // the camera guess: Gemini sees a bed in the middle of the picture
  fake.gemini = { items: [{ label: 'bed', score: 0.9, box: { x: 150, y: 400, w: 180, h: 200 } }], dropped: 0, model: 'fake', ms: 10, roundTripMs: 12 };
  fake.session = {
    scene: new Scene(),
    end: () => fake.callbacks.onEnd(),
    forgetAnchorsFrom() {},
    floorEstimate: () => f,
    captureFrame: async () => ({ image: { width: 480, height: 900 }, width: 480, height: 900, projection: [], view: [], timeMs: 0 }),
    enabledFeatures: [],
  };
  const html = readFileSync(resolve(process.cwd(), 'scan.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script', html.indexOf('<body>')));
  localStorage.clear();
  await import('../src/roomscan/main.js');
  await settle();
  // room scan is the default mode
  expect(document.querySelector('input[name="mode"]:checked').value).toBe('room');
  $('btn-start').disabled = false;
  click($('btn-start'));
  await settle();
});

describe('pass 1: walls by their corners', () => {
  it('starts with a hint pointing at the progress diagram', () => {
    expect(visible('rs-coach')).toBe(true);
    expect($('rs-coach').textContent).toMatch(/Your progress shows here/);
  });

  it('says "Getting ready" until the phone reads the floor at a sensible depth', () => {
    frame({ ...floorHit(at(0, -L / 2)), floorEstimate: null });
    expect($('ov-status').textContent).toMatch(/^Getting ready: sweep the floor slowly, phone at chest height/);
    frame({ ...floorHit(at(0, -L / 2)), floorEstimate: cam[1] - 0.6 });
    expect($('ov-status').textContent).toMatch(/^Getting ready: keep sweeping \(floor reads 0\.6 m below\)/);
  });

  it('starts on wall 1, the door wall, with corner 1 next', () => {
    frame(floorHit(at(0, -L / 2)));
    expect($('ov-status').textContent).toMatch(/^Wall 1 \(door wall\): tap corner 1, bottom-left \(floor\)/);
    expect($('rs-guide').textContent).toMatch(/Wall 1 of 4/);
    expect($('rs-guide').querySelectorAll('.next')).toHaveLength(1);
    expect($('ov-readout').hidden).toBe(true); // numbers behind "details"
    expect(visible('rs-door')).toBe(false);    // doors come in pass 2
    expect($('rs-next').disabled).toBe(true);
  });

  it('wall 1: bottom-left, top-left, top-right, bottom-right', () => {
    const [bl, br] = WALLS[0];
    expect(typeof floorTap(bl)).toBe('number');
    expect(visible('rs-coach')).toBe(false); // gone at the first tap
    expect(visible('rs-skip')).toBe(true);
    expect(aimTap(at(...bl, CEIL))).toBe(true);
    expect(aimTap(at(...br, CEIL))).toBe(true);
    expect(visible('rs-skip')).toBe(false);
    expect(typeof floorTap(br)).toBe('number');
    expect($('ov-msg').textContent).toMatch(/^✓ Wall 1: about 3\.00 m wide, 2\.70 m high\. Next wall, turn right\./);
    expect($('rs-guide').querySelectorAll('.next')).toHaveLength(0);
    expect($('rs-next').disabled).toBe(false);
  });

  it('wall 2: its bottom-left corner is hidden, so it is tapped on the wall itself', () => {
    click($('rs-next'));
    expect($('ov-msg').textContent).toMatch(/^Wall 2: turn right, start at corner 1\./);
    const [bl, br] = WALLS[1];
    const p = at(...bl, 1.0);
    const onWall = { hit: p, cam, normalUp: 0, normal: [-xa[0], 0, -xa[1]], isFloor: false, isWall: true, floorEstimate: f, timeMs: 0 };
    frame(onWall);
    expect($('ov-status').textContent).toMatch(/blue ring: on the wall/);
    expect(typeof tap({ floorHit: null, ray: rayTo(p), hit: onWall })).toBe('number');
    aimTap(at(...bl, CEIL));
    aimTap(at(...br, CEIL));
    floorTap(br);
    expect($('ov-msg').textContent).toMatch(/^✓ Wall 2: about 3\.90 m wide, 2\.70 m high/);
  });

  it('wall 3: the ceiling is not visible, so both top corners are skipped', () => {
    click($('rs-next'));
    const [bl, br] = WALLS[2];
    floorTap(bl);
    click($('rs-skip'));
    click($('rs-skip'));
    floorTap(br);
    expect($('ov-msg').textContent).toMatch(/^✓ Wall 3: about 3\.00 m wide\. Next wall/);
  });

  it('wall 4 closes the room: Close room is offered, keep capturing is allowed', () => {
    click($('rs-next'));
    expect(visible('rs-close')).toBe(false);
    const [bl, br] = WALLS[3];
    floorTap(bl);
    aimTap(at(...bl, CEIL));
    aimTap(at(...br, CEIL));
    floorTap(br);
    expect(visible('rs-next')).toBe(false);
    expect(visible('rs-close')).toBe(true);
    expect($('rs-close-msg').textContent).toMatch(/Room closed/);
    expect(visible('rs-close-room')).toBe(true);
    expect(visible('rs-close-anyway')).toBe(false);
    click($('rs-keep'));
    expect(visible('rs-close')).toBe(false);
    expect(visible('rs-close-show')).toBe(true);
    click($('rs-close-show'));
    expect(visible('rs-close')).toBe(true);
  });

  it('Close room starts pass 2', () => {
    click($('rs-close-room'));
    expect($('ov-msg').textContent).toMatch(/^Room done ✓ Now add doors, windows and furniture/);
    expect($('rs-dims').textContent).toMatch(/^Room 3\.20 x 4\.10 m .*ceiling 2\.70 m/);
    expect(visible('rs-door') && visible('rs-window') && visible('rs-furniture') && visible('rs-finish')).toBe(true);
    expect(visible('rs-ceiling')).toBe(false); // measured already
  });
});

describe('pass 2: doors, windows and furniture by tapping', () => {
  it('a door by its bottom-left and top-right corners', () => {
    click($('rs-door'));
    frame();
    expect($('ov-status').textContent).toMatch(/^Door: tap its bottom-left corner/);
    expect($('rs-guide').textContent).toMatch(/Door/);
    expect(aimTap(at(-0.6, -L / 2, 0))).toBe(true);
    expect(aimTap(at(0.3, -L / 2, 2.0))).toBe(true);
  });

  it('Guess from camera pre-selects the type in the picker', async () => {
    click($('rs-furniture'));
    expect(visible('ov-picker')).toBe(true);
    click($('pk-guess'));
    await settle();
    expect($('pk-note').textContent).toMatch(/^Looks like: Bed\. Tap it to confirm/);
    expect($('pk-types').querySelector('[data-type="bed"]').classList.contains('guess')).toBe(true);
  });

  it('a Queen bed: pick the size, then tap its 2 front corners', () => {
    click($('pk-types').querySelector('[data-type="bed"]'));
    expect(visible('pk-sizes')).toBe(true);
    const queen = [...$('pk-sizes').querySelectorAll('button')].find((b) => /^Queen/.test(b.textContent));
    click(queen);
    expect(visible('ov-picker')).toBe(false);
    frame(floorHit(at(0, 0)));
    expect($('ov-status').textContent).toMatch(/^Bed \(Queen\): tap once on it/);
    expect($('rs-guide').textContent).toMatch(/Bed: 1 tap/);
    // ONE tap on the mattress, 55 cm up, its head against the back wall
    const h = floorHit(at(0, L / 2 - 3.1 * FT, 0.55));
    expect(typeof tap({ floorHit: h, ray: rayTo(h.hit), hit: h })).toBe('number');
    expect($('ov-msg').textContent).toBe('✓ Bed added');
    expect(visible('ov-confirm')).toBe(false); // no off-floor question for furniture
    expect(visible('rs-done')).toBe(false);
  });

  it('an almirah by two corners, like a door: floor corner, then top corner', () => {
    click($('rs-furniture'));
    click($('pk-cats').querySelector('[data-cat="Bedroom"]'));
    click($('pk-types').querySelector('[data-type="almirah"]'));
    click([...$('pk-sizes').querySelectorAll('button')].find((b) => /^2-door/.test(b.textContent)));
    frame(floorHit(at(0, 0)));
    expect($('ov-status').textContent).toMatch(/^Almirah \(2-door\): tap its bottom-left corner \(floor\)/);
    // against the left wall, its front 55 cm out, 1.0 m wide, 1.9 m tall
    const front = -W / 2 + 0.55;
    expect(typeof floorTap([front, 0.5])).toBe('number');
    frame();
    expect($('ov-status').textContent).toMatch(/top-right corner/);
    expect(aimTap(at(front, -0.5, 1.9))).toBe(true);
    expect($('ov-msg').textContent).toBe('✓ Almirah added');
  });

  it('the "Use it as is / Skip" row is hidden whenever no tap is waiting', () => {
    expect(visible('ov-confirm')).toBe(false);
    // and the stylesheet makes the hidden attribute win over .row { display: flex }
    const css = readFileSync(resolve(process.cwd(), 'src/roomscan/style.css'), 'utf8');
    expect(css).toMatch(/\[hidden\] \{ display: none !important; \}/);
  });

  it('Finish shows the room, the ceiling, the door, the bed and the almirah', async () => {
    click($('rs-finish'));
    await settle();
    expect($('room-summary').textContent).toMatch(
      /^Scan: 10\.5 x 13\.45 ft \(3\.20 x 4\.10 m\), ceiling 8\.86 ft \(2\.70 m\), 1 door\/window, 2 pieces of furniture\./,
    );
    const door = [...document.querySelectorAll('#room-openings tr')][1];
    expect([...door.children].map((td) => td.textContent).slice(0, 2)).toEqual(['door', 'front']);
    const [, bed, almirah] = [...document.querySelectorAll('#room-furniture tr')];
    expect(bed.children[0].textContent).toBe('Bed (Queen)');
    expect(bed.children[3].textContent).toBe('5.00');   // width, from the Queen size
    expect(bed.children[4].textContent).toBe('6.25');   // depth, from the Queen size
    expect(almirah.children[0].textContent).toBe('Almirah (2-door)');
    expect(almirah.children[3].textContent).toBe((1.0 / FT).toFixed(2)); // width, measured
    expect(almirah.children[4].textContent).toBe('1.75');                 // depth, from the 2-door size
  });
});

describe('a corner tap on furniture', () => {
  it('is kept without a question, and the wall is placed from its top corners', async () => {
    // a fresh scan: wall 1's bottom-left lands on a bed top 60 cm up
    localStorage.clear();
    document.querySelector('input[name="mode"][value="room"]').checked = true;
    click($('btn-start'));
    await settle();
    const [bl, br] = WALLS[0];
    const onBed = floorHit(at(bl[0], bl[1] + 0.5, 0.6));
    expect(typeof tap({ floorHit: onBed, ray: rayTo(onBed.hit), hit: onBed })).toBe('number');
    expect(visible('ov-confirm')).toBe(false);
    aimTap(at(...bl, CEIL));
    aimTap(at(...br, CEIL));
    floorTap(br);
    expect($('ov-msg').textContent).toMatch(/^✓ Wall 1 \(floor corner hidden: measured from the top corners\)\./);
  });
});
