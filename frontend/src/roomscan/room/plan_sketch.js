// A top-down sketch of a scanned room, as an SVG string.
//
// Seen from above with the FRONT wall at the top and the right wall on the
// right: x runs right, z runs down the page. That is a true top view (no
// mirroring), matching the room frame of the team app.
//
// Shows the walls with their lengths, doors and windows on their walls,
// confirmed furniture as footprints with a tick on the side each piece faces,
// and detector suggestions as dashed circles. A plan view is the quickest way
// to see whether a scan is right: a piece in the wrong corner, or a wall that
// is too long, is obvious at a glance.

import { facingOf } from '../scan/furniture.js';

const FT = 0.3048;
const SIZE = 560;   // drawing area, px
const PAD = 70;     // room for wall labels and lengths

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => v.toFixed(1);
const len = (m) => `${m.toFixed(2)} m (${(m / FT).toFixed(1)} ft)`;

/**
 * @param fit the room's fit (metres)
 * @param openings scanResult openings: [{opening: {type, wall, position, width}}]
 * @param furniture scanResult furniture: [{item}]
 * @param suggestions from mergeDetections: [{type, name, source, x, z, seen}]
 * @param catalog map of type id -> entry, for names and facing
 * @returns {string} an SVG document, or a short SVG saying there is no room
 */
export function planSvg({ fit, openings = [], furniture = [], suggestions = [], catalog = {}, ceiling = null }) {
  if (!fit?.ok) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60" viewBox="0 0 400 60">`
      + `<text x="10" y="35" font-family="sans-serif" font-size="14">No room yet: tap all four walls.</text></svg>`;
  }
  const W = fit.widthM, L = fit.lengthM;
  const s = SIZE / Math.max(W, L);
  const w = W * s, h = L * s;
  const X = (x) => PAD + (x + W / 2) * s;
  const Y = (z) => PAD + (z + L / 2) * s;
  const out = [];
  const total = { w: w + PAD * 2, h: h + PAD * 2 + 40 };
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(total.w)}" height="${n(total.h)}" viewBox="0 0 ${n(total.w)} ${n(total.h)}" font-family="sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  out.push(`<rect x="${n(PAD)}" y="${n(PAD)}" width="${n(w)}" height="${n(h)}" fill="#f7f6f2" stroke="#222" stroke-width="4"/>`);

  // walls: names and lengths
  out.push(`<text x="${n(PAD + w / 2)}" y="${n(PAD - 30)}" text-anchor="middle" font-size="13" font-weight="bold">FRONT</text>`);
  out.push(`<text x="${n(PAD + w / 2)}" y="${n(PAD - 12)}" text-anchor="middle" font-size="12">${len(W)}</text>`);
  out.push(`<text x="${n(PAD + w / 2)}" y="${n(PAD + h + 24)}" text-anchor="middle" font-size="13" font-weight="bold">BACK</text>`);
  out.push(`<text x="${n(PAD - 12)}" y="${n(PAD + h / 2)}" text-anchor="middle" font-size="13" font-weight="bold" transform="rotate(-90 ${n(PAD - 12)} ${n(PAD + h / 2)})">LEFT  ${len(L)}</text>`);
  out.push(`<text x="${n(PAD + w + 18)}" y="${n(PAD + h / 2)}" text-anchor="middle" font-size="13" font-weight="bold" transform="rotate(90 ${n(PAD + w + 18)} ${n(PAD + h / 2)})">RIGHT</text>`);

  // doors and windows: a coloured band along their wall
  for (const o of openings) {
    const op = o.opening;
    if (!op) continue;
    const a = op.position - op.width / 2, b = op.position + op.width / 2;
    const colour = op.type === 'door' ? '#1f6feb' : '#00a3c4';
    let x1, y1, x2, y2;
    if (op.wall === 'front') { x1 = X(a); x2 = X(b); y1 = y2 = Y(-L / 2); }
    else if (op.wall === 'back') { x1 = X(a); x2 = X(b); y1 = y2 = Y(L / 2); }
    else if (op.wall === 'left') { y1 = Y(a); y2 = Y(b); x1 = x2 = X(-W / 2); }
    else { y1 = Y(a); y2 = Y(b); x1 = x2 = X(W / 2); }
    out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${colour}" stroke-width="9"/>`);
    const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
    const off = op.wall === 'front' ? 16 : op.wall === 'back' ? -10 : 0;
    const offX = op.wall === 'left' ? 8 : op.wall === 'right' ? -8 : 0;
    const anchor = op.wall === 'left' ? 'start' : op.wall === 'right' ? 'end' : 'middle';
    out.push(`<text x="${n(lx + offX)}" y="${n(ly + off)}" text-anchor="${anchor}" font-size="11" fill="${colour}">${esc(op.type)} ${(op.width / FT).toFixed(1)} ft</text>`);
  }

  // confirmed furniture: footprint and a tick on its front side
  for (const f of furniture) {
    const it = f.item;
    if (!it || it.wallMounted) continue;
    const c = Math.cos(it.rotation), si = Math.sin(it.rotation);
    const hw = it.width / 2, hd = it.depth / 2;
    const at = (lx, lz) => [X(it.x + lx * c + lz * si), Y(it.z - lx * si + lz * c)];
    const pts = [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)].map(([px, py]) => `${n(px)},${n(py)}`).join(' ');
    out.push(`<polygon points="${pts}" fill="#ffd9f3" stroke="#c2188f" stroke-width="2"/>`);
    const entry = catalog[it.type];
    if (entry) {
      const [fx, fz] = facingOf(entry, it.rotation);
      out.push(`<line x1="${n(X(it.x))}" y1="${n(Y(it.z))}" x2="${n(X(it.x + fx * (hd + 0.15)))}" y2="${n(Y(it.z + fz * (hd + 0.15)))}" stroke="#c2188f" stroke-width="2"/>`);
    }
    out.push(`<text x="${n(X(it.x))}" y="${n(Y(it.z) - 4)}" text-anchor="middle" font-size="11" fill="#7a0e5a">${esc(entry?.name ?? it.type)}</text>`);
  }
  for (const f of furniture) {
    const it = f.item;
    if (!it?.wallMounted) continue;
    const label = `${esc(catalog[it.type]?.name ?? it.type)} (on wall)`;
    const pos = { front: [X(it.position), Y(-L / 2) + 26], back: [X(it.position), Y(L / 2) - 18], left: [X(-W / 2) + 10, Y(it.position)], right: [X(W / 2) - 10, Y(it.position)] }[it.wall];
    out.push(`<text x="${n(pos[0])}" y="${n(pos[1])}" text-anchor="${it.wall === 'right' ? 'end' : it.wall === 'left' ? 'start' : 'middle'}" font-size="11" fill="#7a0e5a">${label}</text>`);
  }

  // detector suggestions, not yet confirmed
  for (const sg of suggestions) {
    out.push(`<circle cx="${n(X(sg.x))}" cy="${n(Y(sg.z))}" r="${n(0.25 * s)}" fill="none" stroke="#e67e00" stroke-width="2" stroke-dasharray="5 4"/>`);
    out.push(`<text x="${n(X(sg.x))}" y="${n(Y(sg.z) + 4)}" text-anchor="middle" font-size="11" fill="#a35a00">${esc(sg.name)}?</text>`);
    out.push(`<text x="${n(X(sg.x))}" y="${n(Y(sg.z) + 17)}" text-anchor="middle" font-size="9" fill="#a35a00">${esc(sg.source)}, seen ${sg.seen}x</text>`);
  }

  if (ceiling) {
    out.push(`<text x="${n(PAD + w)}" y="${n(PAD + h + 24)}" text-anchor="end" font-size="12">ceiling ${len(ceiling.heightM)}</text>`);
  }
  const ly = PAD + h + 52;
  out.push(`<text x="${n(PAD)}" y="${n(ly)}" font-size="11" fill="#444">Top view, front wall at the top. Blue: door. Cyan: window. Pink: furniture you marked (tick = its front). Orange dashed: detector suggestion.</text>`);
  out.push('</svg>');
  return out.join('');
}
