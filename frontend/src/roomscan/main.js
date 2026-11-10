// Page shell: device report, AR feature report, the AR session (line
// measuring or room scan), and the results.

import './style.css';
import { basicSupport, probeFeatures, featureRows, verdict } from './ar/feature_report.js';
import { startSession } from './ar/session.js';
import { createMeasure } from './ar/measure.js';
import {
  allRows, summarise, rowsToCsv, outlineGap, floorStepM, FLOOR_STEP_LIMIT_M,
} from './ar/tap_log.js';
import { createRoomScan, scanResult } from './scan/room_scan.js';
import { createRoomScanView } from './scan/room_scan_view.js';
import { toAppDesign, designCsv, toRoomCraftBody, designFurnitureInMetres } from './room/app_design.js';
import { planSvg } from './room/plan_sketch.js';
import { placeDetections, mergeCandidates, applyReview, typesLike } from './detect/place.js';
import { geminiDetect, jpegBase64 } from './detect/gemini_client.js';
import catalogFile from './data/furniture_catalog.json';
import sizePresetsFile from './data/size_presets.json';
import { detectObjects } from './detect/detector.js';
import { catalogTypesFor } from './detect/coco_catalog.js';

// the team app's furniture types, copied by scripts/build_furniture_catalog.mjs
const CATALOG = Object.fromEntries(catalogFile.types.map((t) => [t.id, t]));
// common sizes (e.g. Bed: Single / Double / Queen / King), feet, keyed by type
const SIZE_PRESETS = sizePresetsFile.presets;

const STORE_KEY = 'roomscan.day1';
const $ = (id) => document.getElementById(id);

// ---- saved data -----------------------------------------------------------
// Written on every tap. A reload, a crash or a dropped session must not cost
// the measurements already taken.
//   sessions   line-measuring sessions (pairs / outline)
//   roomScans  room scans, kept apart because their taps belong to walls

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && Array.isArray(raw.sessions)) {
      return { ...raw, roomScans: Array.isArray(raw.roomScans) ? raw.roomScans : [] };
    }
  } catch {
    // unreadable or blocked storage: start empty
  }
  return { features: null, sessions: [], roomScans: [] };
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // storage full or blocked; the in-memory copy still feeds the downloads
  }
}

const store = loadStore();

// ---- small DOM helpers ----------------------------------------------------

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function fillTable(table, head, rows) {
  table.replaceChildren();
  if (head) {
    const tr = el('tr');
    head.forEach(([label, cls]) => tr.append(el('th', label, cls)));
    table.append(tr);
  }
  rows.forEach((cells) => {
    const tr = el('tr');
    cells.forEach(([content, cls]) => {
      // a cell is either plain text or a ready-made element such as an input
      const td = el('td', content instanceof Node ? undefined : content, cls);
      if (content instanceof Node) td.append(content);
      tr.append(td);
    });
    table.append(tr);
  });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const yesNo = (v) => (v ? ['yes', 'yes'] : ['no', 'no']);
const fmt = (v, digits) => (v === null || v === undefined ? '-' : v.toFixed(digits));
const signed = (v, digits) => (v === null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(digits));

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// ---- 1. this device -------------------------------------------------------

async function renderEnvironment() {
  const env = await basicSupport();
  fillTable($('env-table'), null, [
    [['Secure page (HTTPS or localhost)'], yesNo(env.secure)],
    [['WebXR available in this browser'], yesNo(env.hasXr)],
    [['AR sessions supported'], yesNo(env.arSupported)],
  ]);
  let help = '';
  if (!env.secure) {
    help = 'AR only runs on HTTPS or localhost. Open this page as http://localhost:5173 through the USB port forward, not through the laptop\'s IP address.';
  } else if (!env.hasXr) {
    help = 'This browser has no WebXR. Open the page in Chrome on an Android phone.';
  } else if (!env.arSupported) {
    help = 'AR is not supported on this device. On a phone, check that Google Play Services for AR is installed and up to date.';
  }
  if (env.error) help += ` (${env.error})`;
  $('env-help').textContent = help;
  const ready = env.secure && env.hasXr && env.arSupported;
  $('btn-features').disabled = !ready;
  $('btn-start').disabled = !ready;
}

// ---- 2. AR features -------------------------------------------------------

function renderFeatures() {
  const f = store.features;
  if (!f) return;
  if (f.error) {
    $('feature-verdict').textContent = `Could not open an AR session: ${f.error}`;
    $('feature-table').replaceChildren();
    return;
  }
  $('feature-verdict').textContent = verdict(f.enabled);
  fillTable($('feature-table'), [['Feature'], ['Granted'], ['If missing']],
    featureRows(f.enabled).map((r) => [
      [r.required ? `${r.name} (required)` : r.name],
      r.granted === null ? ['not reported'] : yesNo(r.granted),
      [r.note],
    ]));
}

$('btn-features').addEventListener('click', async () => {
  $('btn-features').disabled = true;
  const result = await probeFeatures($('overlay'));
  store.features = { ...result, checkedAt: new Date().toISOString(), userAgent: navigator.userAgent };
  saveStore();
  renderFeatures();
  $('btn-features').disabled = false;
});

// ---- 4. line results ------------------------------------------------------

// A box for the real length of one line, in cm. Lets a line be tagged after
// the session, and with any length, not only the ones on the chips.
function tapeInput(row) {
  const input = el('input', undefined, 'tape');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = '0';
  input.step = '0.1';
  input.placeholder = 'cm';
  input.setAttribute('aria-label', `Tape length in cm, session ${row.session} line ${row.segment}`);
  if (row.trueM !== null) input.value = String(+(row.trueM * 100).toFixed(1));
  input.addEventListener('change', () => {
    const session = store.sessions[row.session - 1];
    const cm = parseFloat(input.value);
    if (cm > 0) session.trueM[row.segment - 1] = cm / 100;
    else delete session.trueM[row.segment - 1];
    saveStore();
    renderResults();
  });
  return input;
}

function renderResults() {
  const rows = allRows(store.sessions);
  const s = summarise(rows);
  $('summary').textContent = s
    ? `${s.n} tagged line${s.n === 1 ? '' : 's'}: median error ${s.medianAbsCm.toFixed(1)} cm (${s.medianAbsPct.toFixed(1)}%), worst ${s.maxAbsCm.toFixed(1)} cm.`
    : rows.length > 0
      ? 'No line has a tape length yet, so there is no error to report.'
      : 'No measurements yet.';
  // only meaningful when the outline was finished on the point it started from
  $('outline-gaps').textContent = store.sessions
    .map((session, i) => [i + 1, outlineGap(session)])
    .filter(([, gap]) => gap !== null)
    .map(([n, gap]) => `Session ${n} outline: last point is ${(gap * 100).toFixed(1)} cm from the first.`)
    .join(' ');
  fillTable($('result-table'), rows.length === 0 ? null : [
    ['Session', 'num'], ['Line', 'num'], ['Tape (cm)', 'num'], ['Measured (cm)', 'num'],
    ['At tap (cm)', 'num'], ['Error (cm)', 'num'], ['Error (%)', 'num'], ['Range (m)', 'num'],
    ['Look-down (deg)', 'num'], ['Height step (cm)', 'num'],
  ], rows.map((r) => [
    [String(r.session), 'num'], [String(r.segment), 'num'], [tapeInput(r), 'num'],
    [fmt(r.measuredM * 100, 1), 'num'], [fmt(r.atTapM * 100, 1), 'num'],
    [signed(r.errorCm, 1), 'num'], [signed(r.errorPct, 1), 'num'], [fmt(r.meanRangeM, 2), 'num'],
    [fmt(r.minDepressionDeg, 0), 'num'], [fmt(r.heightStepCm, 1), 'num'],
  ]));
  const any = store.sessions.length > 0 || store.roomScans.length > 0;
  $('btn-json').disabled = !any;
  $('btn-csv').disabled = rows.length === 0;
  $('btn-clear').disabled = !any && !store.features;
  renderRoomScan();
}

// ---- 5. room scan result --------------------------------------------------

/**
 * The latest room scan, recomputed from its raw taps and detections: the
 * design in the app's format, plus the sketch. Camera sightings are placed
 * on the fitted room, merged into pieces, and the user's review applied:
 * kept pieces become furniture, doors and windows; the rest suggestions.
 */
function latestDesign() {
  const latest = store.roomScans[store.roomScans.length - 1];
  if (!latest) return null;
  const tapped = scanResult(latest, CATALOG);
  const candidates = tapped.fit.ok ? mergeCandidates(placeDetections(latest.detections, tapped.fit, CATALOG)) : [];
  const { result, suggestions, pieces } = applyReview(tapped, candidates, latest.review, CATALOG);
  const out = toAppDesign(result, { name: 'Scanned room', catalog: CATALOG, suggestions });
  // the sketch shows the furniture as tidied for the app (square, no overlaps)
  const drawn = out.design ? { ...result, furniture: designFurnitureInMetres(out.design) } : result;
  const sketch = planSvg({ ...drawn, suggestions, catalog: CATALOG });
  return { ...out, sketch, pieces, detections: latest.detections?.length ?? 0 };
}

// ---- review list: pieces found by the camera --------------------------------

const pieceName = (type) => (type === 'door' ? 'Door' : type === 'window' ? 'Window' : CATALOG[type]?.name ?? type);

function pieceWhere(p) {
  const m = (v) => `${v.toFixed(2)} m`;
  if (p.kind === 'opening') {
    return `${p.wall} wall, ${m(p.opening.position)} from its centre` + (p.opening.offset > 0.05 ? `, sill ${m(p.opening.offset)}` : '');
  }
  if (p.kind === 'wallItem') return `${p.wall} wall, ${m(p.item.position)} from its centre, ${m(p.item.elevation)} up`;
  return p.wall ? `against the ${p.wall} wall` : `free-standing at x ${p.item.x.toFixed(2)}, z ${p.item.z.toFixed(2)} m`;
}

function pieceSize(p) {
  const o = p.opening ?? p.item;
  return `${o.width.toFixed(2)} x ${o.height.toFixed(2)} m`;
}

function renderReview(out) {
  const pieces = out?.pieces ?? [];
  $('review-head').hidden = pieces.length === 0;
  $('review-note').hidden = pieces.length === 0;
  $('review-note').textContent = 'Kept pieces go into the design. Gemini\'s finds are kept unless you remove them; '
    + 'the phone\'s own guesses stay suggestions until you keep them. Change the type if it is wrong.';
  const table = $('room-review');
  if (pieces.length === 0) {
    table.replaceChildren();
    return;
  }
  const head = el('tr');
  for (const h of ['Piece', 'Where', 'Size (w x h)', 'Seen', 'Decide']) head.append(el('th', h));
  const rows = pieces.map((p) => {
    const tr = el('tr');
    tr.dataset.id = p.id;
    if (p.decision === 'remove') tr.className = 'removed';
    tr.append(
      el('td', pieceName(p.type) + (p.changed ? ` (was ${pieceName(p.originalType)})` : '')),
      el('td', pieceWhere(p)),
      el('td', pieceSize(p)),
      el('td', `${p.seen ?? 1}x, ${p.source}`),
    );
    const td = el('td');
    for (const [d, label] of [['keep', 'Keep'], ['maybe', 'Maybe'], ['remove', 'Remove']]) {
      const b = el('button', label);
      b.dataset.decide = d;
      b.classList.toggle('on', p.decision === d);
      td.append(b);
    }
    const select = el('select');
    select.dataset.retype = '1';
    select.setAttribute('aria-label', 'Change type');
    for (const t of typesLike(p, CATALOG)) {
      const o = el('option', pieceName(t));
      o.value = t;
      o.selected = t === p.type;
      select.append(o);
    }
    td.append(select);
    tr.append(td);
    return tr;
  });
  table.replaceChildren(head, ...rows);
}

function setDecision(id, decision) {
  const latest = store.roomScans[store.roomScans.length - 1];
  if (!latest) return;
  latest.review = { ...(latest.review ?? {}), [id]: decision };
  saveStore();
  renderRoomScan();
}

$('room-review').addEventListener('click', (e) => {
  const decision = e.target?.dataset?.decide;
  const id = e.target?.closest?.('tr')?.dataset.id;
  if (decision && id) setDecision(id, decision);
});
$('room-review').addEventListener('change', (e) => {
  if (!e.target?.dataset?.retype) return;
  const id = e.target.closest('tr')?.dataset.id;
  if (id) setDecision(id, { type: e.target.value });
});

function renderRoomScan() {
  const out = latestDesign();
  renderReview(out);
  const problems = $('room-problems');
  problems.replaceChildren();
  $('btn-design').disabled = !out?.design;
  if ($('btn-save-app')) $('btn-save-app').disabled = !out?.design;
  $('btn-room-csv').disabled = !out?.design;
  $('btn-sketch').disabled = !out?.design;
  // the sketch is built by planSvg from numbers and escaped names only
  $('room-sketch').innerHTML = out ? out.sketch : '';
  const empty = () => {
    fillTable($('room-openings'), null, []);
    fillTable($('room-furniture'), null, []);
  };
  if (!out) {
    $('room-summary').textContent = 'No room scans yet.';
    empty();
    return;
  }
  const count = store.roomScans.length;
  const which = count > 1 ? `Latest of ${count} scans` : 'Scan';
  out.problems.forEach((p) => problems.append(el('li', p)));
  const d = out.design;
  if (!d) {
    $('room-summary').textContent = `${which} did not give a room.`;
    empty();
    return;
  }
  const openingsText = d.openings.length === 1 ? '1 door/window' : `${d.openings.length} doors/windows`;
  const furnitureText = d.furniture.length === 1 ? '1 piece of furniture' : `${d.furniture.length} pieces of furniture`;
  const sg = d.scan.suggestions.length;
  const kept = out.pieces.filter((p) => p.decision === 'keep').length;
  const suggestionText = out.detections > 0
    ? ` The camera took ${out.detections} picture${out.detections === 1 ? '' : 's'} and found ${out.pieces.length} piece${out.pieces.length === 1 ? '' : 's'}: ${kept} kept, ${sg} left as suggestions.`
    : '';
  $('room-summary').textContent =
    `${which}: ${d.room_width} x ${d.room_length} ft (${d.scan.widthM.toFixed(2)} x ${d.scan.lengthM.toFixed(2)} m)` +
    (d.room_height !== null ? `, ceiling ${d.room_height} ft (${d.scan.ceilingHeightM.toFixed(2)} m)` : ', ceiling not measured') + ', ' +
    `${openingsText}, ${furnitureText}.${suggestionText} ` +
    (d.scan.verdict === 'consistent' ? 'Walls agree with each other.' : 'Check the size before using it.');
  fillTable($('room-openings'), d.openings.length === 0 ? null : [
    ['Type'], ['Wall'], ['Position (ft)', 'num'], ['Width (ft)', 'num'], ['Height (ft)', 'num'], ['Sill (ft)', 'num'],
  ], d.openings.map((o) => [
    [o.type], [o.wall], [fmt(o.position, 2), 'num'], [fmt(o.width, 2), 'num'],
    [fmt(o.height, 2), 'num'], [fmt(o.offset, 2), 'num'],
  ]));
  const notes = Object.fromEntries(d.scan.furniture.map((f) => [f.id, f]));
  fillTable($('room-furniture'), d.furniture.length === 0 ? null : [
    ['Furniture'], ['Where (ft)'], ['Turned (deg)', 'num'], ['Width (ft)', 'num'], ['Depth (ft)', 'num'], ['Measured'],
  ], d.furniture.map((f) => [
    [f.name],
    [f.wallMounted ? `${f.wall} wall, ${fmt(f.position, 2)} along, ${fmt(f.elevation, 2)} up` : `x ${fmt(f.x, 2)}, z ${fmt(f.z, 2)}`],
    [f.wallMounted ? '-' : fmt((f.rotation * 180) / Math.PI, 0), 'num'],
    [fmt(f.width, 2), 'num'], [fmt(f.depth, 2), 'num'],
    [notes[f.id]?.measured.join(', ') ?? ''],
  ]));
}

$('btn-design').addEventListener('click', () => {
  const out = latestDesign();
  if (out?.design) download(`room_design_${stamp()}.json`, JSON.stringify(out.design, null, 2), 'application/json');
});

// ---- saving into the RoomCraft app (only on its scan page) ------------------
//
// The page is served by the RoomCraft frontend, so it shares the app's login
// (the JWT in localStorage) and reaches its backend at /api on the same
// origin. Standalone, there is no Save button and none of this runs.

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

function showSaveStatus(...parts) {
  $('save-status').replaceChildren(...parts);
}

if ($('btn-save-app')) {
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('rc_user') ?? 'null'); } catch { return null; }
  })();
  if ($('app-user')) $('app-user').textContent = user?.name ? `Signed in as ${user.name}` : 'Not signed in';
  if (!localStorage.getItem('rc_token')) {
    showSaveStatus('To save your scan, ', link('/login', 'log in'), ' first. A scan you make now is kept on this phone.');
  }

  $('btn-save-app').addEventListener('click', async () => {
    const out = latestDesign();
    if (!out?.design) return;
    const token = localStorage.getItem('rc_token');
    if (!token) {
      showSaveStatus('Please ', link('/login', 'log in'), ', then come back: your scan is kept on this phone.');
      return;
    }
    const button = $('btn-save-app');
    button.disabled = true;
    showSaveStatus('Saving...');
    try {
      const name = `Scanned room ${new Date().toLocaleDateString()}`;
      const res = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(toRoomCraftBody(out.design, { name })),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        showSaveStatus('Your login has expired. ', link('/login', 'Log in again'), ', then come back and tap Save.');
        return;
      }
      if (!res.ok) throw new Error(body?.message ?? `the server said ${res.status}`);
      showSaveStatus('Saved to My Designs. ', link(`/editor?id=${body.design.id}`, 'Open it in the 3D editor'));
    } catch (e) {
      showSaveStatus(`Could not save: ${e?.message ?? e}`);
    } finally {
      button.disabled = false;
    }
  });
}

// ---- open a scan file ----------------------------------------------------------
//
// A log downloaded earlier ("Download log (JSON)") can be opened again, on
// any device: its room scans replace the ones on this page, and the latest
// is shown. This is how a scan made on the phone is shown on a laptop.

if ($('log-file')) {
  $('log-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.roomScans) || data.roomScans.length === 0) throw new Error('it has no room scans');
      store.roomScans = data.roomScans;
      saveStore();
      renderResults();
      $('log-status').textContent = `Opened ${file.name}: ${data.roomScans.length} room scan${data.roomScans.length === 1 ? '' : 's'}, showing the latest.`;
    } catch (err) {
      $('log-status').textContent = `Could not open ${file.name}: ${err.message}`;
    } finally {
      e.target.value = '';
    }
  });
}

$('btn-room-csv').addEventListener('click', () => {
  const out = latestDesign();
  if (out?.design) download(`room_items_${stamp()}.csv`, designCsv(out.design), 'text/csv');
});

$('btn-sketch').addEventListener('click', () => {
  const out = latestDesign();
  if (out?.design) download(`room_sketch_${stamp()}.svg`, out.sketch, 'image/svg+xml');
});

$('btn-json').addEventListener('click', () => {
  download(`floor_measure_log_${stamp()}.json`, JSON.stringify(store, null, 2), 'application/json');
});

$('btn-csv').addEventListener('click', () => {
  download(`floor_measure_table_${stamp()}.csv`, rowsToCsv(allRows(store.sessions)), 'text/csv');
});

$('btn-clear').addEventListener('click', () => {
  if (!confirm('Delete every saved measurement on this phone? Download the log first if you need it.')) return;
  store.features = null;
  store.sessions = [];
  store.roomScans = [];
  saveStore();
  $('feature-verdict').textContent = '';
  $('feature-table').replaceChildren();
  renderResults();
});

// ---- 3. the AR session ----------------------------------------------------
//
// One overlay and one session serve both modes. Each mode is a controller
// with the same shape, so the session code does not care which is running:
//   status(hit)            text for the status line
//   onTap({floorHit, ray}) false to reject, true to accept, a number to anchor
//   onAnchorMove(i, pos)   the phone moved its estimate of tap i
//   undo(), clear(), flush()

const overlay = $('overlay');
let active = null; // { session, controller, kind } while AR is running

// A tap on an overlay control would otherwise also count as a tap on the
// floor and drop a marker under the button.
$('ov-controls').addEventListener('beforexrselect', (e) => e.preventDefault());

function showMessage(text) {
  $('ov-msg').textContent = text ?? '';
}

// ---- floor taps that come back off the floor ------------------------------
//
// A floor tap far above or below the other floor taps is usually on a bed,
// desk or box (27 Oct: one such point moved a line by 31 cm), or a false
// reading off a glossy floor. The user is warned live before tapping, and on
// tapping chooses: "Use it as is" (kept exactly where the phone put it) or
// Skip. Nothing is ever refused outright and nothing is moved.
//
// History, so neither mistake is made again:
//   27 Oct  "Use it" used to move a high point down to the floor along the
//           aiming line. When the floor there was hidden by furniture, the
//           point landed far past it: rooms came out 23 cm to 2 m too big.
//   1 Nov   high points were then refused, with the phone's automatic floor
//           estimate as the reference. That estimate locked onto a false
//           surface below a glossy floor, every real floor point read "66 cm
//           above", and the scan could not continue.

/**
 * Metres off the floor, or null if within the limit or nothing to compare to.
 *
 * Reference: the user's own floor taps once there are any, because the user
 * can SEE the floor. The phone's automatic estimate is used only before the
 * first floor tap. CHANGED 1 Nov: with the estimate always preferred, a glossy
 * floor gave a false surface below the real one, the estimate locked onto it,
 * and every real floor point read "66 cm above" and was refused - the scan
 * could not go on.
 */
function offFloorStep(taps, floorHit) {
  // only a level surface can be floor; a wall or cupboard face is not compared
  if (!floorHit || floorHit.isFloor === false) return null;
  const y = floorHit.hit[1];
  const step = taps.length > 0
    ? floorStepM(taps, y)
    : Number.isFinite(floorHit.floorEstimate) ? y - floorHit.floorEstimate : null;
  return step === null || Math.abs(step) <= FLOOR_STEP_LIMIT_M ? null : step;
}
let heldTap = null; // an off-floor tap waiting for Use it / Skip

// A ring at least this far below the phone is on the floor, not on furniture
// (a standing user holds the phone 1.1-1.6 m up; bed and desk tops are
// 0.4-0.8 m up). Starting value.
const TRACKING_DROP_M = 1.0;
// Before wall 1, the phone should read the floor this far below it.
const READY_DROP_M = [0.9, 2.0];

function clearHeld() {
  heldTap = null;
  $('ov-confirm').hidden = true;
}

/**
 * Hold a tap that came back off the floor until the user decides. Never a
 * dead end: "Use it as is" always records the point exactly where the phone
 * put it. Nothing is moved any more (moving points down to the floor along
 * the aiming line is what made rooms 23 cm to 2 m too big on 27 Oct).
 * @param commit called with the hit to record, if the user keeps it
 */
function holdOffFloorTap(step, floorHit, ray, commit, hint = '') {
  const cm = Math.round(Math.abs(step) * 100);
  heldTap = { floorHit, commit };
  // How far below the phone the ring is. Standing, the floor is 1 m or more
  // below; a bed or desk top is closer. So a ring that far down is on the
  // floor, and a different height means the phone's TRACKING moved, not that
  // the user tapped furniture. 1 Nov: four "37-107 cm higher/lower" warnings,
  // all with the ring on the floor, were tracking jumps blamed on furniture.
  const drop = floorHit.cam[1] - floorHit.hit[1];
  const tracking = drop >= TRACKING_DROP_M;
  showMessage(tracking
    ? `The floor here reads ${cm} cm ${step > 0 ? 'higher' : 'lower'} than at your earlier taps: the phone's tracking has shifted, not you. `
      + 'Tap "Use it as is" to carry on. Heights are measured per wall, so the ceiling stays right; '
      + 'if sizes look wrong at the end, scan again moving slowly.'
    : step > 0
      ? `This point is ${cm} cm higher than your other floor taps - it may be on a bed, desk or other furniture. If you can see it is the floor, tap "Use it as is".${hint}`
      : `This point is ${cm} cm lower than your other floor taps. If those were on furniture, Undo them; if this is the floor, tap "Use it as is".`);
  // the recommended choice is the highlighted one
  $('ov-use').classList.toggle('primary', tracking);
  $('ov-skip').classList.toggle('primary', !tracking);
  $('ov-use').textContent = tracking ? 'Use it as is (recommended)' : 'Use it as is';
  $('ov-skip').textContent = tracking ? 'Skip' : 'Skip (recommended)';
  $('ov-confirm').hidden = false;
}

$('ov-use').addEventListener('click', () => {
  if (!heldTap) return;
  const { floorHit, commit } = heldTap;
  clearHeld();
  showMessage('');
  commit(floorHit);
});
$('ov-skip').addEventListener('click', () => {
  clearHeld();
  showMessage('');
});

/** A live note in the readout, before the user taps. */
function offFloorNote(step) {
  if (step === null) return '';
  return ` | ${Math.round(Math.abs(step) * 100)} cm ${step > 0 ? 'ABOVE' : 'BELOW'} the floor`;
}

// The instruction always stays on screen; what the ring is doing is added to it.
function floorStatus(hit, prompt) {
  if (!hit) return `${prompt} · move slowly to find the floor`;
  if (!hit.isFloor) return `${prompt} · ring not on the floor`;
  return prompt;
}

$('ov-details').addEventListener('click', () => {
  $('ov-readout').hidden = !$('ov-readout').hidden;
});

let lastReadout = 0;
function showHit(hit) {
  const now = performance.now();
  if (now - lastReadout < 150) return; // the frame loop runs far faster than anyone reads
  lastReadout = now;
  if (!active) return;
  $('ov-status').textContent = active.controller.status(hit);
  if (!hit) {
    $('ov-readout').textContent = '';
    return;
  }
  const range = Math.hypot(hit.hit[0] - hit.cam[0], hit.hit[1] - hit.cam[1], hit.hit[2] - hit.cam[2]);
  const drop = hit.cam[1] - hit.hit[1];
  const horiz = Math.hypot(hit.hit[0] - hit.cam[0], hit.hit[2] - hit.cam[2]);
  const lookDown = (Math.atan2(drop, horiz) * 180) / Math.PI;
  // "below phone" is the sanity check: about 1.2-1.5 m when standing means
  // the ring is on the floor, much less means it is on furniture
  $('ov-readout').textContent =
    `range ${range.toFixed(2)} m | look-down ${lookDown.toFixed(0)} deg | ${drop.toFixed(2)} m below phone` +
    offFloorNote(active.controller.liveStep(hit)) +
    (Number.isFinite(hit.floorEstimate) ? '' : ' | finding the floor: sweep the ring over open floor');
}

// ---- line measuring -------------------------------------------------------

function showLast(measure) {
  const rows = measure ? measure.rows() : [];
  const last = rows[rows.length - 1];
  document.querySelectorAll('#ov-chips button').forEach((b) => {
    b.classList.toggle('on', !!last && last.trueM === Number(b.dataset.m));
  });
  if (!last) {
    $('ov-last').textContent = '';
    return;
  }
  const cm = (last.measuredM * 100).toFixed(1);
  $('ov-last').textContent = last.trueM === null
    ? `Line ${last.segment}: ${cm} cm - now pick the tape length`
    : `Line ${last.segment}: ${cm} cm, tape ${(last.trueM * 100).toFixed(0)} cm, error ${signed(last.errorCm, 1)} cm`;
}

function linesController(session, entry) {
  const measure = createMeasure(session.scene, {
    mode: entry.mode,
    onChange: ({ taps, trueM }) => {
      entry.taps = taps;
      entry.trueM = trueM;
      // after Undo or Clear, anchors for taps that no longer exist must not
      // go on feeding positions into whichever tap takes their index next
      session.forgetAnchorsFrom(taps.length);
      saveStore();
      showLast(measure);
    },
  });
  return {
    measure,
    status: (hit) => floorStatus(hit, measure.prompt()),
    liveStep: (hit) => offFloorStep(measure.state().taps, hit),
    onTap: ({ floorHit, ray }) => {
      if (!floorHit) return false;
      const step = offFloorStep(measure.state().taps, floorHit);
      if (step !== null) {
        holdOffFloorTap(step, floorHit, ray, (h) => measure.addTap(h));
        return false;
      }
      clearHeld();
      showMessage('');
      return measure.addTap(floorHit);
    },
    onAnchorMove: (i, p) => measure.setAnchored(i, p),
    undo: () => { clearHeld(); showMessage(''); measure.undo(); },
    clear: () => { clearHeld(); showMessage(''); measure.clear(); },
    flush: () => measure.flush(),
  };
}

$('ov-chips').addEventListener('click', (e) => {
  const m = Number(e.target?.dataset?.m);
  if (active?.controller.measure && m > 0) active.controller.measure.tagLast(m);
});

// ---- typed tape length ----------------------------------------------------
let typed = '';

function showKeypad(open) {
  $('ov-keypad').hidden = !open;
  typed = '';
  $('kp-display').textContent = open ? 'Length of the last line: _ cm' : '';
}

$('ov-type').addEventListener('click', () => showKeypad($('ov-keypad').hidden));
$('kp-cancel').addEventListener('click', () => showKeypad(false));

$('kp-keys').addEventListener('click', (e) => {
  const key = e.target?.dataset?.k;
  if (!key) return;
  if (key === 'back') typed = typed.slice(0, -1);
  else if (key === '.') typed += typed.includes('.') ? '' : (typed === '' ? '0.' : '.');
  else if (typed.length < 6) typed += key;
  $('kp-display').textContent = `Length of the last line: ${typed || '_'} cm`;
});

$('kp-set').addEventListener('click', () => {
  const cm = parseFloat(typed);
  if (!(cm > 0)) {
    $('kp-display').textContent = 'Enter a length in cm first';
    return;
  }
  if (!active?.controller.measure || !active.controller.measure.tagLast(cm / 100)) {
    $('kp-display').textContent = 'There is no line to tag yet';
    return;
  }
  showKeypad(false);
});

// ---- room scan ------------------------------------------------------------

const ANCHOR_REDRAW_MS = 300;

// ---- the guide picture: which corner is next ---------------------------------
//
// Top left of the AR view: the current wall (or door, window, piece) with its
// corners numbered in the order to tap them. Done corners are ticked, the next
// one pulses. Built from numbers and escaped names only.

const C_DONE = '#1e8e3e', C_SKIP = '#9aa0a6', C_NEXT = '#fbbc04';
const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function guideDot(x, y, n, state) {
  const fill = state === 'done' ? C_DONE : state === 'skipped' ? C_SKIP : state === 'next' ? C_NEXT : 'rgba(0,0,0,0.6)';
  const label = state === 'done' ? '✓' : state === 'skipped' ? '-' : String(n);
  return `<circle cx="${x}" cy="${y}" r="9" fill="${fill}" stroke="#fff" stroke-width="1.5"${state === 'next' ? ' class="next"' : ''}/>`
    + `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${state === 'next' ? '#000' : '#fff'}">${label}</text>`;
}

function guideCaption(text) {
  return `<text x="60" y="92" text-anchor="middle" font-size="11" fill="#fff">${escXml(text)}</text>`;
}

/** One wall, corners 1 bottom-left, 2 top-left, 3 top-right, 4 bottom-right. */
function wallGuide(n, state, next) {
  const at = { bl: [14, 72], tl: [14, 14], tr: [106, 14], br: [106, 72] };
  const num = { bl: 1, tl: 2, tr: 3, br: 4 };
  return `<svg viewBox="0 0 120 96" role="img" aria-label="Wall ${n} of 4: corners in order bottom-left, top-left, top-right, bottom-right">`
    + '<rect x="14" y="14" width="92" height="58" fill="rgba(255,255,255,0.18)" stroke="#fff" stroke-width="1.5"/>'
    + '<path d="M14 62 L14 24 M24 14 L96 14 M106 24 L106 62" fill="none" stroke="#fbbc04" stroke-width="1.5" stroke-dasharray="4 3"/>'
    + Object.entries(at).map(([k, [x, y]]) => guideDot(x, y, num[k], k === next ? 'next' : state[k])).join('')
    + guideCaption(`Wall ${n} of 4`) + '</svg>';
}

/** A door, window or wall piece: corner 1 bottom-left, then 2 top-right. */
function cornersGuide(label, done, low) {
  const top = low ? 20 : 12, bottom = low ? 72 : 52;
  return `<svg viewBox="0 0 120 96" role="img" aria-label="${escXml(label)}: tap its bottom-left corner, then its top-right corner">`
    + '<rect x="4" y="4" width="112" height="68" fill="rgba(255,255,255,0.1)" stroke="#fff" stroke-width="1"/>'
    + `<rect x="36" y="${top}" width="48" height="${bottom - top}" fill="rgba(255,255,255,0.28)" stroke="#fff" stroke-width="1.5"/>`
    + guideDot(36, bottom, 1, done >= 1 ? 'done' : 'next')
    + guideDot(84, top, 2, done >= 2 ? 'done' : done === 1 ? 'next' : null)
    + guideCaption(label) + '</svg>';
}

/** A piece marked by one tap anywhere on it. */
function oneTapGuide(label) {
  return `<svg viewBox="0 0 120 96" role="img" aria-label="${escXml(label)}: one tap anywhere on it">`
    + '<rect x="24" y="14" width="72" height="50" rx="4" fill="rgba(255,255,255,0.28)" stroke="#fff" stroke-width="1.5"/>'
    + guideDot(60, 39, 1, 'next')
    + guideCaption(`${label}: 1 tap`) + '</svg>';
}

function guideFor(scan) {
  if (scan.phase() === 'walls') return wallGuide(scan.wallNumber(), scan.cornerState(), scan.cornerStep());
  const kind = scan.pendingKind();
  const type = scan.pendingType();
  const done = scan.pendingPoints().length;
  const name = CATALOG[type]?.name ?? type;
  if (kind === 'opening') return cornersGuide(type === 'door' ? 'Door' : 'Window', done, type === 'door');
  if (kind === 'wall') return cornersGuide(name, done, false);
  if (kind === 'standing') return cornersGuide(name, done, true);
  if (kind === 'one') return oneTapGuide(name);
  return '';
}

function showRoomControls(scan, ui = {}) {
  const walls = scan.phase() === 'walls';
  const step = scan.cornerStep();
  const closure = scan.closure();
  const show = (id, on) => { $(id).hidden = !on; };
  show('rs-skip', walls && (step === 'tl' || step === 'tr'));
  show('rs-redo', walls && Object.values(scan.cornerState()).some(Boolean));
  show('rs-next', walls && scan.wallNumber() < 4);
  $('rs-next').disabled = !scan.canFinishWall();
  // after wall 4: Close room is offered once the room closes, never before
  show('rs-close', Boolean(closure) && !ui.closeCollapsed);
  if (closure) {
    $('rs-close-msg').textContent = closure.message;
    $('rs-close').classList.toggle('open-gap', !closure.closed);
    show('rs-close-room', closure.closed);
    show('rs-close-anyway', !closure.closed);
  }
  show('rs-close-show', Boolean(closure) && Boolean(ui.closeCollapsed));
  for (const [id, type] of [['rs-door', 'door'], ['rs-window', 'window']]) {
    show(id, !walls);
    $(id).classList.toggle('on', scan.pendingKind() === 'opening' && scan.pendingType() === type);
  }
  const { fit, ceiling } = scan.result();
  show('rs-furniture', !walls);
  $('rs-furniture').classList.toggle('on', ['one', 'standing', 'wall'].includes(scan.pendingKind()));
  // a fallback for when every top corner was skipped
  show('rs-ceiling', !walls && !ceiling);
  $('rs-ceiling').classList.toggle('on', scan.pendingKind() === 'ceiling');
  show('rs-done', scan.canFinishItem());
  show('rs-finish', !walls);
  if (walls) showPicker(false);
  $('rs-dims').textContent = fit.ok
    ? `Room ${fit.widthM.toFixed(2)} x ${fit.lengthM.toFixed(2)} m` +
      ` (${(fit.widthM / 0.3048).toFixed(1)} x ${(fit.lengthM / 0.3048).toFixed(1)} ft)` +
      (ceiling ? `, ceiling ${ceiling.heightM.toFixed(2)} m` : '') +
      (fit.quality.verdict === 'consistent' ? '' : ' - check: ' + fit.quality.reasons.join('; '))
    : '';
  // built from numbers and escaped names only
  $('rs-guide').innerHTML = guideFor(scan);
}

// ---- furniture type picker, with common sizes and a camera guess -----------

const CATEGORIES = [...new Set(catalogFile.types.map((t) => t.category))];
let pickerCategory = CATEGORIES[0];
let sizesFor = null; // the type whose sizes are showing

function renderPicker() {
  const cats = $('pk-cats');
  cats.replaceChildren(...CATEGORIES.map((c) => {
    const b = el('button', c);
    b.dataset.cat = c;
    b.classList.toggle('on', c === pickerCategory);
    return b;
  }));
  $('pk-types').replaceChildren(...catalogFile.types
    .filter((t) => t.category === pickerCategory)
    .map((t) => {
      const b = el('button', t.name + (SIZE_PRESETS[t.id] ? ' ▸' : ''));
      b.dataset.type = t.id;
      return b;
    }));
}

function showSizes(type) {
  const list = SIZE_PRESETS[type];
  const box = $('pk-sizes');
  sizesFor = list ? type : null;
  box.hidden = !list;
  if (!list) {
    box.replaceChildren();
    return false;
  }
  const button = (text, key) => {
    const b = el('button', text);
    b.dataset.size = key;
    return b;
  };
  box.replaceChildren(
    el('span', `${CATALOG[type].name} size:`),
    ...list.map((p, i) => button(`${p.name} (${p.width} x ${p.depth} ft)`, String(i))),
    button('Standard', 'std'),
  );
  return true;
}

function showPicker(open) {
  $('ov-picker').hidden = !open;
  showSizes(null);
  $('pk-note').textContent = '';
  if (open) renderPicker();
}

$('pk-cats').addEventListener('click', (e) => {
  const cat = e.target?.dataset?.cat;
  if (!cat) return;
  pickerCategory = cat;
  showSizes(null);
  renderPicker();
});
$('pk-types').addEventListener('click', (e) => {
  const type = e.target?.dataset?.type;
  if (!type) return;
  if (showSizes(type)) return; // choose a size first
  showPicker(false);
  active?.controller.startFurniture?.(CATALOG[type]);
});
$('pk-sizes').addEventListener('click', (e) => {
  const key = e.target?.dataset?.size;
  if (key === undefined || !sizesFor) return;
  const type = sizesFor;
  const size = key === 'std' ? null : SIZE_PRESETS[type][Number(key)];
  showPicker(false);
  active?.controller.startFurniture?.(CATALOG[type], size);
});
$('pk-cancel').addEventListener('click', () => showPicker(false));
$('pk-guess').addEventListener('click', () => active?.controller.guess?.());

function markGuess(type, how) {
  pickerCategory = CATALOG[type].category;
  showSizes(null);
  renderPicker();
  $('pk-types').querySelector(`[data-type="${type}"]`)?.classList.add('guess');
  $('pk-note').textContent = `${how}: ${CATALOG[type].name}. Tap it to confirm, or pick another.`;
}

let guessing = false;

/**
 * "Guess from camera": one picture; the detected piece nearest the centre of
 * the view pre-selects its type in the picker. The phone's detector answers
 * at once, Gemini about 10 s later. It never measures or places anything.
 */
async function guessType(session) {
  if (guessing) return;
  guessing = true;
  const note = (t) => { $('pk-note').textContent = t; };
  try {
    note('Looking...');
    const frame = await session.captureFrame();
    const nearest = (items) => {
      let best = null, bestD = Infinity;
      for (const it of items) {
        if (!it.type) continue;
        const d = Math.hypot(it.box.x + it.box.w / 2 - frame.width / 2, it.box.y + it.box.h / 2 - frame.height / 2);
        if (d < bestD) { best = it; bestD = d; }
      }
      return best;
    };
    let quick = null;
    try {
      const phone = await detectObjects(frame.image);
      quick = nearest(phone.items.map((d) => ({ ...d, type: catalogTypesFor(d.label)[0] ?? null })));
    } catch {
      // the phone's detector is only a quick first guess
    }
    if (quick) markGuess(quick.type, 'Quick guess');
    note(`${quick ? `Quick guess: ${CATALOG[quick.type].name}. ` : ''}Asking Gemini (about 10 s)...`);
    const g = await geminiDetect({ jpeg: jpegBase64(frame.image), width: frame.width, height: frame.height });
    const best = nearest(g.items.map((d) => ({ ...d, type: CATALOG[d.label] ? d.label : null })));
    if (best) markGuess(best.type, 'Looks like');
    else note(quick ? `Gemini is not sure. Quick guess: ${CATALOG[quick.type].name}.` : 'Could not tell what this is. Pick the type below.');
  } catch (e) {
    note(`Guess did not work (${e?.message ?? e}). Pick the type below.`);
  } finally {
    guessing = false;
  }
}

/** Taps on the floor itself: not the ones made on a wall's surface, which sit up the wall. */
function floorTapsOf(scan) {
  return scan.saved().taps.filter((t) => !t.surfaceNormal);
}

// A surface counts as a wall when its normal is within 20 degrees of level.
const WALL_MAX_NORMAL_Y = Math.sin(20 * Math.PI / 180);
function isWallSurface(hit) {
  return Boolean(hit?.normal) && Math.abs(hit.normal[1]) < WALL_MAX_NORMAL_Y;
}

// ---- the room scan in AR: walls by corners, then furniture, doors, windows --

/**
 * Before the first tap: is the tracking settled? Standing with the phone at
 * chest height, the floor should read about 1-1.6 m below it. On 1 Nov the
 * first walls were tapped while it read 0.7 m, and the floor later moved by
 * 1.15 m. Returns a "getting ready" line, or null when ready. Never blocks.
 */
function readiness(hit) {
  if (!hit || !Number.isFinite(hit.floorEstimate)) {
    return 'Getting ready: sweep the floor slowly, phone at chest height';
  }
  const drop = hit.cam[1] - hit.floorEstimate;
  if (drop < READY_DROP_M[0] || drop > READY_DROP_M[1]) {
    return `Getting ready: keep sweeping (floor reads ${drop.toFixed(1)} m below)`;
  }
  return null;
}

// "Your progress shows here", pointing at the corner diagram, when a room
// scan starts; it goes after a few seconds or at the first tap.
const COACH_MS = 6000;
let coachTimer = null;
function showCoach(on) {
  const el = $('rs-coach');
  if (!el) return;
  clearTimeout(coachTimer);
  el.hidden = !on;
  if (on) coachTimer = setTimeout(() => { el.hidden = true; }, COACH_MS);
}

function roomController(session, entry) {
  const scan = createRoomScan(CATALOG);
  const view = createRoomScanView(session.scene, CATALOG);
  let lastDraw = 0;
  const ui = { closeCollapsed: false };
  const message = showMessage;

  function changed() {
    const saved = scan.saved();
    entry.taps = saved.taps;
    entry.openings = saved.openings;
    entry.furniture = saved.furniture;
    entry.ceiling = saved.ceiling;
    session.forgetAnchorsFrom(scan.tapCount());
    saveStore();
    view.update(scan);
    showRoomControls(scan, ui);
    if (scan.tapCount() > 0) showCoach(false);
    lastDraw = performance.now();
  }
  changed();
  showCoach(true);

  /**
   * A floor tap; held for a decision if it is off the floor.
   * @param add records the tap and says what happened; returns its index or false
   */
  function floorTap(floorHit, ray, add) {
    if (!floorHit) {
      message(scan.phase() === 'walls'
        ? 'Green ring on the floor corner. Hidden? Aim at the wall (blue ring).'
        : 'Green ring on the floor at its corner.');
      return false;
    }
    // No off-floor question any more: a corner tap that lands on a bed or
    // desk is kept, and the wall is placed from its top corners instead
    // (room_scan.js, cornerCeiling). 1 Nov: the question came up at 6 of 8
    // corners in a hostel room and only slowed the scan down.
    clearHeld();
    const index = add(floorHit);
    if (index === false) return false;
    changed();
    return index;
  }

  /** What to say once a wall's last corner is in. */
  function wallDoneMessage() {
    const n = scan.wallNumber();
    const { lengthM, heightM, onFurniture } = scan.wallSummary();
    if (onFurniture > 0) {
      const head = `✓ Wall ${n} (floor corner hidden: measured from the top corners).`;
      return n < 4 ? `${head} Next wall, turn right.` : head;
    }
    const size = [
      lengthM !== null ? `about ${lengthM.toFixed(2)} m wide` : null,
      heightM !== null ? `${heightM.toFixed(2)} m high` : null,
    ].filter(Boolean).join(', ');
    const s = scan.cornerState();
    const noHeight = heightM === null && (s.tl === 'done' || s.tr === 'done')
      ? ' No ceiling height: Redo wall to retry, or carry on.'
      : '';
    const head = `✓ Wall ${n}${size ? `: ${size}` : ''}.${noHeight}`;
    return n < 4 ? `${head} Next wall, turn right.` : head;
  }

  function afterCorner() {
    if (scan.cornerStep() !== null) {
      message('');
      return;
    }
    ui.closeCollapsed = false;
    message(wallDoneMessage());
  }

  function bottomCorner(h) {
    const r = scan.addBottomCorner(h);
    if (!r.ok) {
      message(r.message);
      return false;
    }
    afterCorner();
    return r.index;
  }

  return {
    scan,
    status: (hit) => {
      if (scan.phase() === 'walls') {
        const step = scan.cornerStep();
        if (step === 'bl' && scan.wallNumber() === 1 && scan.tapCount() === 0) {
          const ready = readiness(hit);
          if (ready) return ready;
        }
        if (step === 'bl' || step === 'br') {
          if (isWallSurface(hit)) return `${scan.prompt()} · blue ring: on the wall`;
          return floorStatus(hit, scan.prompt());
        }
        if (step === null && scan.wallNumber() === 4) {
          const c = scan.closure();
          return c?.closed ? 'Room closed. Tap Close room, or keep capturing.' : 'Wall 4 done, but the room does not close yet. See below.';
        }
        return scan.prompt();
      }
      return scan.wantsFloorTap() ? floorStatus(hit, scan.prompt()) : scan.prompt();
    },
    liveStep: (hit) => (scan.phase() === 'walls' && scan.wantsFloorTap() ? offFloorStep(floorTapsOf(scan), hit) : null),
    onTap({ floorHit, ray, hit }) {
      if (scan.phase() === 'walls') {
        const step = scan.cornerStep();
        if (step === null) {
          message(scan.wallNumber() === 4
            ? 'All four walls are in. Close the room below, or Redo wall / Undo to fix one.'
            : 'This wall is done. Tap Next wall, or Redo wall to do it again.');
          return false;
        }
        if (step === 'tl' || step === 'tr') {
          const r = scan.addTopCorner(ray);
          message(r.ok ? '' : r.message);
          if (r.ok) changed();
          return r.ok;
        }
        if (floorHit) return floorTap(floorHit, ray, bottomCorner);
        // the floor at this corner is hidden: a tap on the wall itself
        if (isWallSurface(hit)) {
          clearHeld();
          const r = scan.addBottomCorner(hit, { onWall: true });
          if (!r.ok) {
            message(r.message);
            return false;
          }
          afterCorner();
          changed();
          return r.index;
        }
        return floorTap(null, ray, () => false);
      }
      if (scan.pendingKind() === 'ceiling') {
        const r = scan.addCeilingPoint(ray);
        message(r.ok
          ? `Ceiling ${r.heightM.toFixed(2)} m (${(r.heightM / 0.3048).toFixed(1)} ft).`
          : r.message);
        if (r.ok) changed();
        return r.ok;
      }
      const kind = scan.pendingKind();
      const name = CATALOG[scan.pendingType()]?.name ?? 'It';
      if (kind === 'standing' && !scan.wantsFloorTap()) {
        // a tall piece's top-right corner, aimed at
        const r = scan.addStandingCorner(ray);
        message(r.ok ? `✓ ${name} added` : r.message);
        if (r.ok) changed();
        return r.ok;
      }
      if (kind === 'one' || kind === 'standing') {
        // only the tap's position on the plan is used (its top is fine), so
        // there is no off-floor check
        if (!floorHit) {
          message(kind === 'one'
            ? `Put the ring on the ${name.toLowerCase()} (its top) or the floor right at it, and tap.`
            : 'Put the GREEN ring on the floor at its bottom-left front corner, and tap.');
          return false;
        }
        clearHeld();
        const index = scan.addFurnitureTap(floorHit);
        if (index === false) return false;
        message(kind === 'one' ? `✓ ${name} added` : '');
        changed();
        return index;
      }
      const r = scan.addOpeningCorner(ray);
      message(r.ok ? '' : r.message);
      if (r.ok) changed();
      return r.ok;
    },
    skip() {
      if (scan.skipCorner()) {
        afterCorner();
        changed();
      }
    },
    redoWall() {
      clearHeld();
      scan.redoWall();
      message(`Wall ${scan.wallNumber()} cleared. Start again at its bottom-left corner.`);
      changed();
    },
    next() {
      if (scan.wallNumber() >= 4) return; // wall 4 ends with Close room
      const r = scan.nextWall();
      message(r.ok
        ? `Wall ${scan.wallNumber()}: turn right, start at corner 1.`
        : r.message);
      changed();
    },
    closeRoom(force) {
      const r = scan.closeRoom({ force });
      message(r.ok
        ? 'Room done ✓ Now add doors, windows and furniture, then Finish.'
        : r.message);
      changed();
    },
    keepCapturing() {
      ui.closeCollapsed = true;
      message('Keep going: Redo wall or Undo to fix a wall. Tap Close room when you are happy.');
      changed();
    },
    showClose() {
      ui.closeCollapsed = false;
      changed();
    },
    startFurniture(catalogEntry, size = null) {
      if (!catalogEntry) return;
      scan.startFurniture(catalogEntry, size);
      message('');
      changed();
    },
    finishItem() {
      scan.finishItem();
      changed();
    },
    guess: () => guessType(session),
    onAnchorMove(i, p) {
      scan.setAnchored(i, p);
      if (performance.now() - lastDraw > ANCHOR_REDRAW_MS) changed();
    },
    startCeiling() {
      scan.startCeiling();
      message('');
      changed();
    },
    startOpening(type) {
      scan.startOpening(type);
      message('');
      changed();
    },
    undo() {
      clearHeld();
      scan.undo();
      ui.closeCollapsed = false;
      message('');
      changed();
    },
    clear() { clearHeld(); scan.clear(); message(''); changed(); },
    flush: changed,
  };
}

$('rs-skip').addEventListener('click', () => active?.controller.skip?.());
$('rs-redo').addEventListener('click', () => active?.controller.redoWall?.());
$('rs-next').addEventListener('click', () => active?.controller.next?.());
$('rs-close-room').addEventListener('click', () => active?.controller.closeRoom?.(false));
$('rs-close-anyway').addEventListener('click', () => active?.controller.closeRoom?.(true));
$('rs-keep').addEventListener('click', () => active?.controller.keepCapturing?.());
$('rs-close-show').addEventListener('click', () => active?.controller.showClose?.());
$('rs-door').addEventListener('click', () => active?.controller.startOpening?.('door'));
$('rs-window').addEventListener('click', () => active?.controller.startOpening?.('window'));
$('rs-furniture').addEventListener('click', () => showPicker($('ov-picker').hidden));
$('rs-ceiling').addEventListener('click', () => active?.controller.startCeiling?.());
$('rs-done').addEventListener('click', () => active?.controller.finishItem?.());
$('rs-finish').addEventListener('click', () => active?.session.end());

// ---- shared controls and session lifecycle --------------------------------

$('ov-undo').addEventListener('click', () => active?.controller.undo());
$('ov-clear').addEventListener('click', () => active?.controller.clear());
$('ov-end').addEventListener('click', () => active?.session.end());

function finish() {
  showCoach(false);
  // anchored positions are saved in batches while AR runs; take the last ones
  active?.controller.flush();
  overlay.classList.remove('active');
  // a session that recorded nothing is not worth keeping
  store.sessions = store.sessions.filter((s) => s.taps.length > 0);
  store.roomScans = store.roomScans.filter((s) => s.taps.length > 0);
  saveStore();
  active = null;
  renderResults();
}

$('btn-start').addEventListener('click', async () => {
  $('start-error').textContent = '';
  const mode = document.querySelector('input[name="mode"]:checked')?.value ?? 'room';
  const room = mode === 'room';
  const entry = room
    ? { startedAt: new Date().toISOString(), kind: 'room', enabledFeatures: null, taps: [], openings: [] }
    : { startedAt: new Date().toISOString(), mode, enabledFeatures: null, taps: [], trueM: {} };
  (room ? store.roomScans : store.sessions).push(entry);
  overlay.dataset.mode = room ? 'room' : 'lines';
  overlay.classList.add('active');
  $('ov-status').textContent = 'Starting...';
  $('ov-readout').textContent = '';
  // the numbers help a tape check; in a room scan they sit behind "details"
  $('ov-readout').hidden = room;
  $('ov-details').hidden = !room;
  $('rs-guide').innerHTML = '';
  $('ov-last').textContent = '';
  showMessage('');
  clearHeld();
  showKeypad(false);
  try {
    const session = await startSession({
      overlayRoot: overlay,
      onHit: showHit,
      onTap: (tap) => (active ? active.controller.onTap(tap) : false),
      onAnchorMove: (index, position) => active?.controller.onAnchorMove(index, position),
      onEnd: finish,
    });
    entry.enabledFeatures = session.enabledFeatures;
    const controller = room ? roomController(session, entry) : linesController(session, entry);
    active = { session, controller };
  } catch (e) {
    $('start-error').textContent = `Could not start AR: ${e?.message ?? e}`;
    finish();
  }
});

// ---- start ----------------------------------------------------------------

// the how-to card is for the room scan; the line modes have their own steps
for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', () => { $('measure').dataset.mode = radio.value; });
}

renderEnvironment();
renderFeatures();
renderResults();
