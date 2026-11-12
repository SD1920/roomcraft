// @vitest-environment jsdom
//
// "Save to my designs" on the RoomCraft app's scan page: the page has the
// extra button, shares the app's login (rc_token in localStorage) and posts
// the scan to the app's own POST /api/designs. fetch is faked.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import catalogFile from '../src/roomscan/data/furniture_catalog.json';
import { createRoomScan } from '../src/roomscan/scan/room_scan.js';
import { toRoomCraftBody } from '../src/roomscan/room/app_design.js';

const CATALOG = Object.fromEntries(catalogFile.types.map((t) => [t.id, t]));
const $ = (id) => document.getElementById(id);
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

// a 3.2 x 4.1 m room with a 2.7 m ceiling and a bed, as the scanner saves it
function savedScan() {
  const W = 3.2, L = 4.1, f = -1.1, CEIL = 2.7;
  const at = (u, v, y = 0) => [u, f + y, v];
  const cam = at(0.1, 0.2, 1.4);
  const scan = createRoomScan(CATALOG);
  const walls = [
    [[-W / 2 + 0.1, -L / 2], [W / 2 - 0.1, -L / 2]],
    [[W / 2, -L / 2 + 0.1], [W / 2, L / 2 - 0.1]],
    [[W / 2 - 0.1, L / 2], [-W / 2 + 0.1, L / 2]],
    [[-W / 2, L / 2 - 0.1], [-W / 2, -L / 2 + 0.1]],
  ];
  const rayTo = (p) => ({ origin: cam, dir: [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]] });
  walls.forEach(([a, b], i) => {
    scan.addBottomCorner({ hit: at(...a), cam, normalUp: 1, timeMs: 0 });
    scan.addTopCorner(rayTo(at(...a, CEIL)));
    scan.addTopCorner(rayTo(at(...b, CEIL)));
    scan.addBottomCorner({ hit: at(...b), cam, normalUp: 1, timeMs: 0 });
    if (i < 3) scan.nextWall();
  });
  scan.closeRoom();
  scan.startFurniture(CATALOG.bed, { name: 'Queen', width: 5, depth: 6.25 });
  scan.addFurnitureTap({ hit: at(0, L / 2 - 1, 0.55), cam, normalUp: 1, timeMs: 0 });
  return { startedAt: 'r1', kind: 'room', ...scan.saved() };
}

let posted = null;

beforeAll(async () => {
  const html = readFileSync(resolve(process.cwd(), 'scan.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script', html.indexOf('<body>')))
    // what the RoomCraft scan page adds
    + '<span id="app-user"></span><button id="btn-save-app" disabled>Save</button><p id="save-status"></p>';
  localStorage.setItem('roomscan.day1', JSON.stringify({ features: null, sessions: [], roomScans: [savedScan()] }));
  localStorage.setItem('rc_token', 'test-token');
  localStorage.setItem('rc_user', JSON.stringify({ name: 'Demo User' }));
  globalThis.fetch = vi.fn(async (url, init) => {
    posted = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 201, json: async () => ({ message: 'Design saved.', design: { id: 42 } }) };
  });
  await import('../src/roomscan/main.js');
  await settle();
});

describe('toRoomCraftBody', () => {
  it('puts the ceiling in the app\'s wall_height, and 8 ft when not measured', () => {
    const d = { name: 'x', room_type: null, room_width: 10, room_length: 13, room_height: 8.86, furniture: [], openings: [] };
    expect(toRoomCraftBody(d)).toMatchObject({ room_width: 10, room_length: 13, wall_height: 8.86, floor_type: 'lightWood' });
    expect(toRoomCraftBody({ ...d, room_height: null }).wall_height).toBe(8);
    expect(toRoomCraftBody(d)).not.toHaveProperty('scan');
  });
});

describe('Save to my designs', () => {
  it('shows who is signed in and enables Save once there is a room', () => {
    expect($('app-user').textContent).toBe('Signed in as Demo User');
    expect($('btn-save-app').disabled).toBe(false);
  });

  it('posts the room to /api/designs with the app login, then links to the editor', async () => {
    click($('btn-save-app'));
    await settle();
    expect(posted.url).toBe('/api/designs');
    expect(posted.init.headers.Authorization).toBe('Bearer test-token');
    expect(posted.body.name).toMatch(/^Scanned room /);
    expect(posted.body.room_width).toBeCloseTo(3.2 / 0.3048, 2);
    expect(posted.body.wall_height).toBeCloseTo(2.7 / 0.3048, 2);
    expect(posted.body.furniture[0]).toMatchObject({ type: 'bed', name: 'Bed (Queen)', depth: 6.25 });
    const a = $('save-status').querySelector('a');
    expect(a.getAttribute('href')).toBe('/editor?id=42');
    expect($('save-status').textContent).toBe('Saved to My Designs. Open it in the 3D editor');
  });

  it('asks to log in again when the login has expired', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ message: 'expired' }) }));
    click($('btn-save-app'));
    await settle();
    expect($('save-status').textContent).toMatch(/^Your login has expired\. Log in again/);
  });
});

describe('Open a scan file', () => {
  it('loads the room scans of a downloaded log and shows the latest', async () => {
    const log = { features: null, sessions: [], roomScans: [savedScan(), savedScan()] };
    const file = new window.File([JSON.stringify(log)], 'floor_measure_log_test.json', { type: 'application/json' });
    const input = $('log-file');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    expect($('log-status').textContent).toBe('Opened floor_measure_log_test.json: 2 room scans, showing the latest.');
    expect($('room-summary').textContent).toMatch(/^Latest of 2 scans: 10\.5 x 13\.45 ft/);
    expect(JSON.parse(localStorage.getItem('roomscan.day1')).roomScans).toHaveLength(2);
  });

  it('says so when the file is not a scan log', async () => {
    const file = new window.File(['{"hello": 1}'], 'other.json', { type: 'application/json' });
    const input = $('log-file');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    expect($('log-status').textContent).toBe('Could not open other.json: it has no room scans');
  });
});
