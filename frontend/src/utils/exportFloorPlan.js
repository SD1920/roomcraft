// src/utils/exportFloorPlan.js
// Exports the 2D floor plan (main room + connected rooms) as a PDF.
// It renders the real <FloorPlan2D bare /> off-screen, so the PDF looks exactly like the editor's 2D view.
//
//   exportFloorPlanPdf(plan, 'download' | 'share')
//   planFromDesign(design, api)   → builds `plan` from a saved design (used by the Dashboard)
//
// plan = { title, roomType, width, length, furniture, openings, wallColors, connectedRooms, mainLinks }

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FloorPlan2D from '../components/FloorPlan2D'
import { ROOM_TYPES } from '../data/roomPresets'
import { computeLinks, defaultOffset, sizeOf } from './roomLayout'

// ── Saved design → plan ──────────────────────────────────────
const asArray  = (v) => { if (Array.isArray(v)) return v; try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } }
const asObject = (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) return v; try { const p = JSON.parse(v || '{}'); return p && typeof p === 'object' ? p : {} } catch { return {} } }

const normalise = (d) => ({
  ...d,
  name:        d.name || 'Room',
  room_width:  Number(d.room_width)  || 10,
  room_length: Number(d.room_length) || 12,
  wall_colors: asObject(d.wall_colors),
  furniture:   asArray(d.furniture),
  openings:    asArray(d.openings),
})

/** Same placement rules as Editor.jsx: where every connected room sits + the doorways between rooms */
export function layoutConnections(connections, main, openings) {
  const byUid = new Map(connections.map((c) => [c.uid, c]))
  const mainSize = { w: main.width, l: main.length }
  const doorOf = (c) => {
    const parent = c.parentUid ? byUid.get(c.parentUid) : null
    const list = c.parentUid ? (parent ? parent.design.openings : []) : openings
    return (list || []).find((o) => o.id === c.doorId && o.type === 'door') || null
  }
  const offsetOf = (c, depth = 0) => {
    if (c.offset) return c.offset
    const parent = c.parentUid ? byUid.get(c.parentUid) : null
    const pOff  = parent && depth < 12 ? offsetOf(parent, depth + 1) : { x: 0, z: 0 }
    const pSize = parent ? sizeOf(parent.design) : mainSize
    const d = defaultOffset(doorOf(c), { width: pSize.w, length: pSize.l }, sizeOf(c.design))
    return { x: pOff.x + d.x, z: pOff.z + d.z }
  }
  const rooms = connections.map((c) => ({ ...c, door: doorOf(c), offset: offsetOf(c) }))
  const links = computeLinks([
    { uid: 'main', size: mainSize, offset: { x: 0, z: 0 }, openings },
    ...rooms.map((r) => ({ uid: r.uid, size: sizeOf(r.design), offset: r.offset, openings: r.design.openings })),
  ])
  return {
    connectedRooms: rooms.map((r) => ({ ...r, links: links[r.uid] || [] })),
    mainLinks: links.main || [],
  }
}

/** Build a plan from a full design row from the API (`api` is only needed for old id-only connections) */
export async function planFromDesign(design, api) {
  const width  = Number(design.room_width)  || 12
  const length = Number(design.room_length) || 14
  const openings = asArray(design.openings)

  const saved = asArray(design.connections).slice(0, 24)
  const connections = (await Promise.all(saved.map(async (s) => {
    let d = s.design
    if (!d && s.design_id && api) {
      try { d = (await api.get(`/api/designs/${s.design_id}`)).data.design } catch { return null }
    }
    if (!d) return null
    const ok = s.offset && Number.isFinite(Number(s.offset.x)) && Number.isFinite(Number(s.offset.z))
    return {
      uid: s.uid || `${s.design_id ?? 'room'}-${s.door_id}`,
      parentUid: s.parent_uid || null,
      doorId: s.door_id || null,
      offset: ok ? { x: Number(s.offset.x), z: Number(s.offset.z) } : undefined,
      design: normalise(d),
    }
  }))).filter(Boolean)

  const { connectedRooms, mainLinks } = layoutConnections(connections, { width, length }, openings)
  return {
    title: design.name || 'Floor plan',
    roomType: design.room_type || '',
    width, length,
    furniture: asArray(design.furniture),
    openings,
    wallColors: asObject(design.wall_colors),
    connectedRooms, mainLinks,
  }
}

// ── Plan → SVG → PNG ─────────────────────────────────────────
function renderPlanSvg(plan) {
  const html = renderToStaticMarkup(createElement(FloorPlan2D, {
    width: plan.width, length: plan.length, roomType: plan.roomType,
    furniture: plan.furniture, openings: plan.openings, wallColors: plan.wallColors,
    connectedRooms: plan.connectedRooms || [], mainLinks: plan.mainLinks || [],
    locked: true, bare: true,
  }))
  const svgText = html.slice(html.indexOf('<svg'), html.lastIndexOf('</svg>') + 6)
  const doc = new DOMParser().parseFromString(
    svgText.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'), 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.nodeName !== 'svg') throw new Error('Could not draw the floor plan.')
  svg.querySelector('rect[x="-5000"]')?.remove() // the invisible pan surface
  return svg
}

async function svgToPng(svg, maxPx = 2600) {
  const [, , vw, vh] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number)
  const ratio = vw / vh
  const w = ratio >= 1 ? maxPx : Math.round(maxPx * ratio)
  const h = Math.round(w / ratio)
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not render the floor plan.')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#f7f5f0'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/png'), ratio }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── PDF ──────────────────────────────────────────────────────
const slug = (s) => (s || 'floor-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'floor-plan'

async function buildPdf(plan) {
  const [{ jsPDF }, { dataUrl, ratio }] = await Promise.all([import('jspdf'), svgToPng(renderPlanSvg(plan))])

  const landscape = ratio >= 1
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const PW = pdf.internal.pageSize.getWidth()
  const PH = pdf.internal.pageSize.getHeight()
  const M = 12, HEAD = 20, FOOT = 10

  const roomName = ROOM_TYPES?.find((r) => r.id === plan.roomType)?.name
  const rooms = 1 + (plan.connectedRooms?.length || 0)
  const items = (plan.furniture?.length || 0) +
    (plan.connectedRooms || []).reduce((n, r) => n + (r.design.furniture?.length || 0), 0)
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(30, 30, 30)
  pdf.text(String(plan.title || 'Floor plan'), M, M + 5, { maxWidth: PW - M * 2 })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110, 110, 110)
  pdf.text([roomName, `${plan.width} x ${plan.length} ft`, rooms > 1 ? `${rooms} rooms` : null].filter(Boolean).join('  |  '), M, M + 11)

  // plan, centred in the space between header and footer
  const bw = PW - M * 2
  const bh = PH - M - HEAD - FOOT - M / 2
  const iw = Math.min(bw, bh * ratio)
  const ih = iw / ratio
  const ix = M + (bw - iw) / 2
  const iy = M + HEAD + (bh - ih) / 2
  pdf.setDrawColor(220, 220, 215); pdf.setLineWidth(0.2)
  pdf.rect(ix, iy, iw, ih)
  pdf.addImage(dataUrl, 'PNG', ix, iy, iw, ih, undefined, 'FAST')

  pdf.setFontSize(8); pdf.setTextColor(140, 140, 140)
  pdf.text(`${items} item${items !== 1 ? 's' : ''}  |  Generated ${date}`, M, PH - M + 2)
  pdf.text('roomcraft', PW - M, PH - M + 2, { align: 'right' })

  return { blob: pdf.output('blob'), filename: `${slug(plan.title)}-floor-plan.pdf` }
}

const download = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * mode 'download' → saves the PDF.
 * mode 'share'    → opens the device share sheet (WhatsApp, Drive, mail…); falls back to download.
 * Resolves to 'downloaded' | 'shared' | 'cancelled' | 'fallback'.
 */
export async function exportFloorPlanPdf(plan, mode = 'download') {
  const { blob, filename } = await buildPdf(plan)
  if (mode === 'share') {
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: plan.title }); return 'shared' }
      catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
    }
    download(blob, filename)
    return 'fallback'
  }
  download(blob, filename)
  return 'downloaded'
}
