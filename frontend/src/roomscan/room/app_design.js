// A room scan in the team app's design format.
//
// The app (interior-designer-frontend + roomcraft backend) stores a design as
//   { name, room_type, room_width, room_length, style, furniture, openings,
//     wall_colors, floor_type }
// with every length in FEET, the room centred on the origin, and openings as
//   { id, type: 'door' | 'window', wall: 'front'|'back'|'left'|'right',
//     position, width, height, offset }
// where position runs along the wall from its centre and offset is the sill
// height (0 for a door). See src/utils/layout.js and src/data/roomPresets.js
// in that codebase.
//
// The object returned here is a valid body for the app's POST /api/designs.
// The extra `scan` block carries how the room was measured and how far to
// trust it; the backend ignores fields it does not know.

export const M_TO_FT = 1 / 0.3048;

// room_width and room_length are DECIMAL(6,2) in the app's database
const ft2 = (m) => Math.round(m * M_TO_FT * 100) / 100;

// The app's editor refuses rooms under 6 ft a side.
export const APP_MIN_SIDE_FT = 6;

/**
 * @param result the output of scanResult() in scan/room_scan.js
 * @param options.name design name; the app requires one
 * @param options.roomType one of the app's room type ids, or null
 * @param options.catalog map of type id -> catalog entry, for furniture names
 * @param options.suggestions detector suggestions (mergeDetections), metres;
 *   carried in the scan block, NOT added as furniture, because nobody has
 *   confirmed them
 * @returns {{design: object | null, problems: string[]}}
 *   design is null when the scan did not produce a room at all
 */
export function toAppDesign(result, { name = 'Scanned room', roomType = null, catalog = null, suggestions = [] } = {}) {
  const { fit } = result;
  if (!fit.ok) return { design: null, problems: [fit.error] };

  const problems = [];
  const width = ft2(fit.widthM);
  const length = ft2(fit.lengthM);
  if (width < APP_MIN_SIDE_FT || length < APP_MIN_SIDE_FT) {
    problems.push(`The app needs at least ${APP_MIN_SIDE_FT} ft a side; this room measured ${width} x ${length} ft.`);
  }

  const counts = { door: 0, window: 0 };
  const openings = [];
  const openingNotes = [];
  result.openings.forEach((o, i) => {
    if (!o.opening) {
      problems.push(`Opening ${i + 1} was dropped: ${o.problems.join(', ')}.`);
      return;
    }
    counts[o.opening.type] += 1;
    const label = `${o.opening.type} ${counts[o.opening.type]} on the ${o.opening.wall} wall`;
    if (o.problems.length > 0) problems.push(`Check ${label}: ${o.problems.join(', ')}.`);
    openings.push({
      id: `scan-${o.opening.type}-${counts[o.opening.type]}`,
      type: o.opening.type,
      wall: o.opening.wall,
      position: ft2(o.opening.position),
      width: ft2(o.opening.width),
      height: ft2(o.opening.height),
      offset: ft2(o.opening.offset),
    });
    openingNotes.push({ id: openings[openings.length - 1].id, source: o.detected ? 'camera' : 'taps' });
  });

  if (fit.quality.verdict !== 'consistent') {
    problems.push(`Check the room size: ${fit.quality.reasons.join('; ')}.`);
  }

  // Furniture in the app's item shape (createFurniture / createWallFurniture
  // in roomPresets.js). Which sizes were measured and which are the catalog's
  // standard goes in the scan block, not on the items, so the items are
  // exactly what the app itself would create.
  const typeCounts = {};
  const furniture = [];
  const furnitureNotes = [];
  (result.furniture ?? []).forEach((f, i) => {
    if (!f.item) {
      problems.push(`Furniture ${i + 1} (${f.type}) was dropped: ${f.problems.join(', ')}.`);
      return;
    }
    const entry = catalog?.[f.item.type];
    typeCounts[f.item.type] = (typeCounts[f.item.type] ?? 0) + 1;
    const id = `scan-${f.item.type}-${typeCounts[f.item.type]}`;
    if (f.problems.length > 0) problems.push(`Check ${entry?.name ?? f.item.type} (${id}): ${f.problems.join(', ')}.`);
    const base = {
      id,
      type: f.item.type,
      // a size preset shows in the name: "Bed (Queen)"
      name: (entry?.name ?? f.item.type) + (f.sizeName ? ` (${f.sizeName})` : ''),
      category: entry?.category ?? null,
      width: ft2(f.item.width),
      depth: ft2(f.item.depth),
      height: ft2(f.item.height),
    };
    furniture.push(f.item.wallMounted
      ? {
        ...base,
        wallMounted: true,
        wall: f.item.wall,
        position: ft2(f.item.position),
        elevation: ft2(f.item.elevation),
        rotation: 0,
        x: 0,
        z: 0,
      }
      : {
        ...base,
        x: ft2(f.item.x),
        z: ft2(f.item.z),
        rotation: Math.round(f.item.rotation * 10000) / 10000,
        elevation: 0,
      });
    furnitureNotes.push({ id, source: f.detected ? 'camera' : 'taps', measured: f.measured, problems: f.problems });
  });

  // square to the walls and clear of each other, as the app itself places pieces
  const settled = settleFurniture(furniture, { width, length });
  furniture.splice(0, furniture.length, ...settled.furniture);
  for (const n of furnitureNotes) {
    const m = settled.moved.find((s) => s.id === n.id);
    if (m) n.problems = [...n.problems, m.note];
  }

  return {
    design: {
      name,
      room_type: roomType,
      room_width: width,
      room_length: length,
      // not in the app's database yet: it stores width and length only, so
      // this needs a room_height column on the team side; null when not measured
      room_height: result.ceiling ? ft2(result.ceiling.heightM) : null,
      furniture,
      openings,
      scan: {
        method: 'ar-scan',
        verdict: fit.quality.verdict,
        reasons: fit.quality.reasons,
        maxWallAngleDeg: +fit.quality.maxWallAngleDeg.toFixed(2),
        maxResidualCm: +fit.quality.maxResidualCm.toFixed(2),
        floorSpreadCm: +fit.quality.floorSpreadCm.toFixed(2),
        widthM: +fit.widthM.toFixed(3),
        lengthM: +fit.lengthM.toFixed(3),
        // how the ceiling height was found, so a missing one is never mistaken
        // for a measured one
        ceilingMeasured: Boolean(result.ceiling),
        ceilingHeightM: result.ceiling ? +result.ceiling.heightM.toFixed(3) : null,
        ceilingTaps: result.ceiling?.taps ?? 0,
        ceilingSpreadCm: result.ceiling ? +result.ceiling.spreadCm.toFixed(1) : null,
        // per piece: which of its sizes were measured (the rest are the
        // catalog's standard) and anything to check
        furniture: furnitureNotes,
        // per door/window: tapped by hand or found by the camera and kept
        openings: openingNotes,
        // what the detectors think is in the room, in the app's frame and
        // feet; for the app to show as "add this?" ghosts, not as furniture
        suggestions: suggestions.map((sg) => ({
          kind: sg.kind ?? 'floorItem',
          wall: sg.wall ?? null,
          type: sg.type,
          name: sg.name,
          source: sg.source,
          x: ft2(sg.x),
          z: ft2(sg.z),
          confidence: Math.round(sg.score * 100) / 100,
          seen: sg.seen,
        })),
      },
    },
    problems,
  };
}

const CSV_HEAD = ['kind', 'type', 'name', 'wall', 'x_ft', 'z_ft', 'position_ft', 'rotation_deg',
  'width_ft', 'depth_ft', 'height_ft', 'elevation_ft', 'source', 'confidence', 'seen'];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Everything in a design as one table: the room, its doors and windows, the
 * furniture, and the detector's suggestions. Feet, room centre at 0, front
 * wall at -z, as in the design itself.
 */
export function designCsv(design) {
  const rows = [CSV_HEAD];
  const add = (r) => rows.push(CSV_HEAD.map((k) => r[k]));
  add({ kind: 'room', name: design.name, width_ft: design.room_width, depth_ft: design.room_length, height_ft: design.room_height, source: design.scan?.method });
  const sourceOf = Object.fromEntries([...(design.scan?.openings ?? []), ...(design.scan?.furniture ?? [])].map((n) => [n.id, n.source]));
  for (const o of design.openings) {
    add({ kind: o.type, type: o.type, wall: o.wall, position_ft: o.position, width_ft: o.width, height_ft: o.height, elevation_ft: o.offset, source: sourceOf[o.id] ?? 'taps' });
  }
  for (const f of design.furniture) {
    add({
      kind: 'furniture', type: f.type, name: f.name, wall: f.wallMounted ? f.wall : null,
      x_ft: f.wallMounted ? null : f.x, z_ft: f.wallMounted ? null : f.z,
      position_ft: f.wallMounted ? f.position : null,
      rotation_deg: f.wallMounted ? null : Math.round((f.rotation * 180) / Math.PI),
      width_ft: f.width, depth_ft: f.depth, height_ft: f.height, elevation_ft: f.elevation, source: sourceOf[f.id] ?? 'taps',
    });
  }
  for (const s of design.scan?.suggestions ?? []) {
    add({ kind: 'suggestion', type: s.type, name: s.name, wall: s.wall, x_ft: s.x, z_ft: s.z, source: s.source, confidence: s.confidence, seen: s.seen });
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/**
 * The body for the RoomCraft app's POST /api/designs. The app keeps the
 * ceiling in its own `wall_height` column (feet, 8-15, default 8), so the
 * scan's room_height goes there; the scan block is left out (the backend
 * does not store it).
 */
export function toRoomCraftBody(design, { name } = {}) {
  return {
    name: (name ?? design.name ?? 'Scanned room').slice(0, 100),
    room_type: design.room_type ?? null,
    room_width: design.room_width,
    room_length: design.room_length,
    wall_height: design.room_height ?? 8,
    furniture: design.furniture,
    openings: design.openings,
    wall_colors: {},
    floor_type: 'lightWood',
  };
}

// ---- tidy the furniture the way the app places it ----------------------------
//
// Tapped and one-tap pieces can come out at odd angles (a free-standing piece
// faces wherever the phone was) and, with rough positions, overlapping
// (1 Nov hostel scan: a desk inside a bed). Real rooms are square to the
// walls, and the app refuses overlaps when you place things by hand. So:
//   1. every floor piece turns to the nearest 0 / 90 / 180 / 270 degrees
//   2. biggest first, each is kept inside the walls and, if it overlaps a
//      piece already placed, moved to the nearest free spot (then tried
//      turned a quarter); the same box test and gaps as the app's
//      utils/layout.js (WALL_CLEARANCE 0.13 ft, COLLISION_GAP 0.05 ft)
// Wall-mounted pieces are left as they are: the app places those on walls.

export const WALL_CLEARANCE_FT = 0.13;
export const COLLISION_GAP_FT = 0.05;
const QUARTER = Math.PI / 2;
const SEARCH_STEP_FT = 0.25;
const SEARCH_RADIUS_FT = 6;

function halfExtents(f) {
  const c = Math.abs(Math.cos(f.rotation)), s = Math.abs(Math.sin(f.rotation));
  return { hw: (f.width * c + f.depth * s) / 2, hd: (f.width * s + f.depth * c) / 2 };
}

/** Do two floor pieces' footprints overlap, with the app's gap? */
export function footprintsOverlap(a, b, gap = COLLISION_GAP_FT) {
  const A = halfExtents(a), B = halfExtents(b);
  return Math.abs(a.x - b.x) < A.hw + B.hw + gap && Math.abs(a.z - b.z) < A.hd + B.hd + gap;
}

/** The nearest 0 / 90 / 180 / 270 degrees, in (-180, 180]. */
export function squareToWalls(rotation) {
  let r = Math.round((Number(rotation) || 0) / QUARTER) * QUARTER;
  while (r <= -Math.PI + 1e-9) r += 2 * Math.PI;
  while (r > Math.PI + 1e-9) r -= 2 * Math.PI;
  return Math.round(r * 10000) / 10000;
}

// offsets to try around a piece, nearest first
const OFFSETS = (() => {
  const out = [];
  const n = Math.round(SEARCH_RADIUS_FT / SEARCH_STEP_FT);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) out.push([i * SEARCH_STEP_FT, j * SEARCH_STEP_FT]);
  return out.filter(([dx, dz]) => Math.hypot(dx, dz) <= SEARCH_RADIUS_FT).sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
})();

/**
 * @param furniture the design's pieces (feet, the app's shape)
 * @param room {width, length} in feet
 * @returns {{furniture, moved: {id, note}[]}} same order as given
 */
export function settleFurniture(furniture, room) {
  // two decimals, rounded towards the room centre so a piece clamped to a
  // wall never ends up a fraction past the limit
  const r2 = (v) => Math.trunc(v * 100) / 100;
  const inside = (f, x, z) => {
    const { hw, hd } = halfExtents(f);
    const mx = Math.max(0, room.width / 2 - WALL_CLEARANCE_FT - hw);
    const mz = Math.max(0, room.length / 2 - WALL_CLEARANCE_FT - hd);
    return [Math.max(-mx, Math.min(mx, x)), Math.max(-mz, Math.min(mz, z))];
  };
  const placed = [];
  const result = new Map();
  const moved = [];
  const floor = furniture.filter((f) => !f.wallMounted)
    .sort((a, b) => b.width * b.depth - a.width * a.depth);
  for (const f of floor) {
    const square = { ...f, rotation: squareToWalls(f.rotation) };
    let best = null;
    for (const rotation of [square.rotation, squareToWalls(square.rotation + QUARTER)]) {
      const turned = { ...square, rotation };
      for (const [dx, dz] of OFFSETS) {
        const [x, z] = inside(turned, f.x + dx, f.z + dz);
        const cand = { ...turned, x: r2(x), z: r2(z) };
        if (!placed.some((p) => footprintsOverlap(cand, p))) { best = cand; break; }
      }
      if (best) break;
    }
    if (!best) {
      // no free spot near it: keep it inside the walls, where it was
      const [x, z] = inside(square, f.x, f.z);
      best = { ...square, x: r2(x), z: r2(z) };
      moved.push({ id: f.id, note: 'no free floor space found near it; it may overlap another piece' });
    } else {
      const shift = Math.hypot(best.x - f.x, best.z - f.z);
      if (shift > 0.5) moved.push({ id: f.id, note: `moved ${shift.toFixed(1)} ft to clear another piece or a wall` });
      else if (best.rotation !== square.rotation) moved.push({ id: f.id, note: 'turned a quarter to fit' });
    }
    placed.push(best);
    result.set(f.id, best);
  }
  return { furniture: furniture.map((f) => result.get(f.id) ?? f), moved };
}

/**
 * The design's furniture back in metres, in the scan result's shape
 * ({item}), so the sketch draws exactly what the app will get.
 */
export function designFurnitureInMetres(design) {
  const m = (ft) => ft / M_TO_FT;
  return design.furniture.map((f) => ({
    item: f.wallMounted
      ? { ...f, width: m(f.width), depth: m(f.depth), height: m(f.height), position: m(f.position), elevation: m(f.elevation) }
      : { ...f, x: m(f.x), z: m(f.z), width: m(f.width), depth: m(f.depth), height: m(f.height) },
    measured: [],
    problems: [],
  }));
}
