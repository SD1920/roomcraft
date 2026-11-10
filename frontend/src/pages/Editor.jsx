// src/pages/Editor.jsx — updated with save/load + multi-room connect
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useSearchParams }            from 'react-router-dom'
import { useTheme }          from '../hooks/useTheme'
import { useAuth }           from '../context/AuthContext'
import api                   from '../api/api'
import RoomViewer            from '../components/RoomViewer'
import SaveDesignModal       from '../components/SaveDesignModal'
import ConnectRoomModal      from '../components/ConnectRoomModal'
import Tutorial              from '../components/Tutorial'
import AiChatPanel           from '../components/AiChatPanel'
import { addPieceToRoom, buildRoomFromSpec, summariseRoom } from '../utils/promptRoom'
import { exportFloorPlanPdf } from '../utils/exportFloorPlan'
import {
  computeLinks, defaultOffset, findFreeSpot, findFreeSpotRects, isFree, otherRects, resolveRoomMove, roomRect, sizeOf,
  rotateDesignQuarter,
} from '../utils/roomLayout'
import {
  clampAlong, clampFloorPosition, clampOpeningPosition, getWallLength, isInsideRoom, isWallMounted, itemsCollide,
} from '../utils/layout'

import {
  furnitureDefinitions,
  FURNITURE_CATEGORIES,
  generateRoom,
  createFurnitureInFreeSpot,
  stylePresets,
  ROOM_TYPES,
} from '../data/roomPresets'

const CATEGORY_ICONS = {
  Bedroom: '🛏', Living: '🛋', Study: '📚',
  Dining: '🍽', Kitchen: '🍳', Bathroom: '🚿', Decor: '🖼',
}

// ── Copy a saved design into the current design ──────────────
// A connected room is a full COPY: after connecting, it is part of this design and no longer
// linked to the original (editing either one doesn't affect the other).
const asArray  = (v) => { if (Array.isArray(v)) return v; try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } }
const asObject = (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) return v; try { const p = JSON.parse(v || '{}'); return p && typeof p === 'object' ? p : {} } catch { return {} } }
const MIN_WALL_H = 8
const MAX_WALL_H = 15
const clampWallH = (v) => Math.min(MAX_WALL_H, Math.max(MIN_WALL_H, parseFloat(v) || MIN_WALL_H))

// true on phones / narrow windows (below Tailwind's `md`)
function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint - 1}px)`
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setMobile(e.matches)
    setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return mobile
}

const PANEL_MIN = 260
const PANEL_MAX = 560

// A number box that only applies its value when you press Enter or click away,
// so typing "20" never passes through "2" and squashes the room on the way.
function CommitInput({ value, onCommit, ...rest }) {
  const shown = String(Number(value))
  const [draft, setDraft] = useState(shown)
  useEffect(() => { setDraft(shown) }, [shown])
  const commit = () => {
    if (Number(draft) === Number(value)) { setDraft(shown); return }
    if (onCommit(Number(draft))) setDraft(shown)   // onCommit returns an error text → put the old value back
  }
  return (
    <input
      type="number" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      {...rest}
    />
  )
}

function copyDesign(d) {
  return JSON.parse(JSON.stringify({
    source_design_id: d.id ?? d.source_design_id ?? null,
    name:        d.name || 'Room',
    room_type:   d.room_type || null,
    room_width:  Number(d.room_width)  || 10,
    room_length: Number(d.room_length) || 12,
    wall_height: clampWallH(d.wall_height),
    style:       d.style || null,
    floor_type:  d.floor_type || 'lightWood',
    wall_colors: asObject(d.wall_colors),
    furniture:   asArray(d.furniture),
    openings:    asArray(d.openings),
  }))
}

export default function Editor() {
  const { theme, toggleTheme } = useTheme()
  const { user }               = useAuth()
  const [searchParams]         = useSearchParams()
  const loadId                 = searchParams.get('id')   // ?id=123 from Dashboard

  // ── Left panel: resizable + collapsible on desktop, slide-in drawer on phones ──
  const isMobile = useIsMobile()
  const [panelOpen, setPanelOpen] = useState(() => !(typeof window !== 'undefined' && window.innerWidth < 768 && loadId))
  const [panelWidth, setPanelWidth] = useState(() => {
    try { const v = Number(localStorage.getItem('rc_panel_w')); return v >= PANEL_MIN && v <= PANEL_MAX ? v : 320 } catch { return 320 }
  })
  const startPanelResize = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidth
    let w = startW
    const move = (ev) => { w = Math.max(PANEL_MIN, Math.min(PANEL_MAX, startW + ev.clientX - startX)); setPanelWidth(w) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { localStorage.setItem('rc_panel_w', String(w)) } catch { /* ignore */ }
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Room form ─────────────────────────────────────────────
  const [roomData, setRoomData] = useState({
    roomType: '', width: '', length: '', height: '', style: '',
  })

  // ── Generated state ───────────────────────────────────────
  const [furniture,     setFurniture]     = useState([])
  const [openings,      setOpenings]      = useState([])
  const [appliedStyle,  setAppliedStyle]  = useState('minimal')
  const [designVersion, setDesignVersion] = useState(0)
  const [error,         setError]         = useState('')
  const [notice,        setNotice]        = useState('')
  const [genInfo,       setGenInfo]       = useState(null)

  // ── Save state ────────────────────────────────────────────
  const [savedDesignId,  setSavedDesignId]  = useState(null)   // null = unsaved
  const [savedDesignName,setSavedDesignName]= useState('')
  const [showSaveModal,  setShowSaveModal]  = useState(false)
  const [saveToast,      setSaveToast]      = useState('')

  // ── PDF export ────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exportMenuPos,  setExportMenuPos]  = useState({ left: 8, bottom: 60 })
  const [exporting,      setExporting]      = useState(false)
  const [exportMsg,      setExportMsg]      = useState('')

  // RoomViewer exposes wallColors + floorType via callbacks
  const [wallColors,  setWallColors]  = useState({ front:'#f5f5f0', back:'#f5f5f0', left:'#f5f5f0', right:'#f5f5f0' })
  const [floorType,   setFloorType]   = useState('lightWood')
  const [loadedLook,  setLoadedLook]  = useState(null) // saved wall colours + floor, handed to RoomViewer on load

  // ── Multi-room (connected rooms) ──────────────────────────
  // Each entry is a full editable COPY: { uid, doorId, design: { name, room_width, furniture, openings, … } }.
  // Wall + offset are derived from the live door, so moving a door (or resizing the room) moves its neighbour too.
  const [connections,      setConnections]       = useState([])
  const [selectedRoomUid,  setSelectedRoomUid]   = useState(null)   // null = main room
  const [aiOpen,           setAiOpen]            = useState(false)  // the AI assistant panel
  const [connectingDoor,    setConnectingDoor]    = useState(null)
  const [showConnectModal,  setShowConnectModal]  = useState(false)
  const [showTutorial,      setShowTutorial]      = useState(false)

  const mainRoom = useMemo(
    () => ({ width: parseFloat(roomData.width) || 12, length: parseFloat(roomData.length) || 14, height: clampWallH(roomData.height) }),
    [roomData.width, roomData.length, roomData.height],
  )

  // Each connected room has its OWN position (offset) and was attached through a door of a parent
  // room (the main room, or another connected room). `door` is that door — it may be gone, and the
  // room then simply stays where it is. `links` are the doorways cut into this room's walls wherever
  // a door of a neighbouring room touches it, so every passage is open both ways.
  // Rooms (and the links array) keep their identity when nothing about them changed, so the 3D view
  // only re-renders the room you are actually editing.
  const roomCache  = useRef(new Map())
  const linksCache = useRef([])
  const { connectedRooms, mainLinks } = useMemo(() => {
    const byUid = new Map(connections.map((c) => [c.uid, c]))
    const mainSize = { w: mainRoom.width, l: mainRoom.length }
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
    const rooms = connections.map((c) => ({
      uid: c.uid, parentUid: c.parentUid || null, design: c.design, doorId: c.doorId,
      door: doorOf(c), offset: offsetOf(c),
    }))
    const links = computeLinks([
      { uid: 'main', size: mainSize, offset: { x: 0, z: 0 }, openings },
      ...rooms.map((r) => ({ uid: r.uid, size: sizeOf(r.design), offset: r.offset, openings: r.design.openings })),
    ])
    const next = rooms.map((r) => {
      const room = { ...r, links: links[r.uid] || [] }
      const old = roomCache.current.get(r.uid)
      const same = old && old.design === room.design && old.offset === room.offset && old.door === room.door &&
        old.parentUid === room.parentUid && JSON.stringify(old.links) === JSON.stringify(room.links)
      return same ? old : room
    })
    roomCache.current = new Map(next.map((r) => [r.uid, r]))
    const ml = links.main || []
    if (JSON.stringify(ml) !== JSON.stringify(linksCache.current)) linksCache.current = ml
    return { connectedRooms: next, mainLinks: linksCache.current }
  }, [connections, openings, mainRoom])

  // Shape sent to the backend: the full copy of each connected room, saved inside this design
  const connectionsPayload = connectedRooms.map((cr) => ({
    uid: cr.uid, parent_uid: cr.parentUid || null, door_id: cr.doorId || null, wall: cr.door?.wall || null, offset: cr.offset, design: cr.design,
  }))

  const activeConn = connectedRooms.find((cr) => cr.uid === selectedRoomUid) || null

  const updateConnectedRoom = useCallback((uid, patch) => {
    setConnections((prev) => prev.map((c) => (c.uid === uid ? { ...c, design: { ...c.design, ...patch } } : c)))
  }, [])

  // Resize a connected room (width / length in ft). Keeps everything inside the new walls and never
  // lets it overlap another room: it grows/shrinks around its centre, or sideways if a neighbour is in the way.
  // Returns an error text (nothing changes) or null.
  const resizeConnectedRoom = (uid, { width, length }) => {
    const cr = connectedRooms.find((c) => c.uid === uid)
    if (!cr) return 'Room not found.'
    const d = cr.design
    const w = width  ?? (Number(d.room_width)  || 10)
    const l = length ?? (Number(d.room_length) || 12)
    if (!(w >= 6 && w <= 60 && l >= 6 && l <= 60)) { setError('Width and length must be between 6 and 60 ft.'); return 'size' }

    const size   = { w, l }
    const room   = { width: w, length: l }
    const others = otherRects(mainRoom, connectedRooms, uid)
    const old    = sizeOf(d)

    // Where can the resized room sit? Same centre first, then slid by half the change (keeps one edge in place)
    const dx = (w - old.w) / 2
    const dz = (l - old.l) / 2
    const spots = []
    for (const sx of [0, 1, -1]) for (const sz of [0, 1, -1]) {
      spots.push({ x: cr.offset.x + sx * dx, z: cr.offset.z + sz * dz, cost: Math.abs(sx * dx) + Math.abs(sz * dz) })
    }
    const pos = spots.filter((p) => isFree(size, p, others)).sort((a, b) => a.cost - b.cost)[0]
    if (!pos) { setError('Not enough space: it would overlap another room. Move the room first, or pick a smaller size.'); return 'space' }

    // Furniture: pull floor pieces back inside, refuse if a piece is simply too big for the room
    const nextFurniture = []
    for (const f of d.furniture || []) {
      if (isWallMounted(f)) {
        if ((Number(f.width) || 1) > getWallLength(f.wall, room) - 0.5) { setError(`“${f.name}” is wider than the new ${f.wall} wall.`); return 'fit' }
        nextFurniture.push({ ...f, position: clampAlong(f.wall, f.position, Number(f.width) || 1, room) })
      } else {
        const p = clampFloorPosition(f, Number(f.x) || 0, Number(f.z) || 0, Number(f.rotation) || 0, room)
        const moved = { ...f, x: p.x, z: p.z }
        if (!isInsideRoom(moved, room)) { setError(`“${f.name}” doesn't fit in a ${w} × ${l} ft room.`); return 'fit' }
        nextFurniture.push(moved)
      }
    }

    // Doors / windows: keep them on their wall
    const nextOpenings = []
    for (const o of d.openings || []) {
      if ((Number(o.width) || 3) > getWallLength(o.wall, room)) { setError(`A ${o.type} is wider than the new ${o.wall} wall.`); return 'fit' }
      nextOpenings.push({ ...o, position: clampOpeningPosition(o, room) })
    }

    const floor = nextFurniture.filter((f) => !isWallMounted(f))
    let overlaps = 0
    floor.forEach((a, i) => floor.slice(i + 1).forEach((b) => { if (itemsCollide(a, b, room)) overlaps++ }))

    setError('')
    setNotice(overlaps ? `${overlaps} piece${overlaps > 1 ? 's' : ''} now overlap: drag them apart.` : '')
    updateConnectedRoom(uid, { room_width: w, room_length: l, furniture: nextFurniture, openings: nextOpenings })
    moveConnectedRoom(uid, { x: pos.x, z: pos.z })   // always store the position, so the room doesn't jump when its size changes
    return null
  }

  const moveConnectedRoom = useCallback((uid, offset) => {
    setConnections((prev) => prev.map((c) => (c.uid === uid ? { ...c, offset: { x: offset.x, z: offset.z } } : c)))
  }, [])

  // Turn a connected room 90° clockwise, with everything in it. It keeps its centre if that is free,
  // else moves to the nearest free spot; then it can be docked with the arrows or its ✥ handle.
  const rotateConnectedRoom = (uid) => {
    const cr = connectedRooms.find((c) => c.uid === uid)
    if (!cr) return
    const next   = rotateDesignQuarter(cr.design)
    const size   = sizeOf(next)
    const others = otherRects(mainRoom, connectedRooms, uid)
    const pos    = findFreeSpot({ size, desired: cr.offset, others })
    if (!isFree(size, pos, others)) { setError('No space to turn this room here: move it away from the others first.'); return }
    setError('')
    setConnections((prev) => prev.map((c) => (c.uid === uid ? { ...c, design: next, offset: { x: pos.x, z: pos.z } } : c)))
  }

  // Turn the MAIN room 90° clockwise. Connected rooms hang off its doors, so the whole plan turns
  // around the main room's centre and every room stays docked where it was.
  const rotateMainRoom = () => {
    const turned = rotateDesignQuarter({
      room_width: mainRoom.width, room_length: mainRoom.length, furniture, openings, wall_colors: wallColors,
    })
    setRoomData((d) => ({ ...d, width: String(turned.room_width), length: String(turned.room_length) }))
    setFurniture(turned.furniture)
    setOpenings(turned.openings)
    setConnections((prev) => prev.map((c) => ({
      ...c,
      design: rotateDesignQuarter(c.design),
      ...(c.offset ? { offset: { x: -c.offset.z, z: c.offset.x } } : {}),
    })))
    // the 3D view takes wall colours from the "loaded look"; a new version makes it apply them
    setLoadedLook({ wallColors: { ...wallColors, ...turned.wall_colors }, floorType })
    setDesignVersion((v) => v + 1)
    setError('')
  }

  // ── AI assistant (components/AiChatPanel.jsx) ─────────────
  // What the assistant sees of the open (main) room, and how its one-tap
  // suggestions are applied. Every change returns an undo.
  const aiRoomSummary = () => summariseRoom({
    roomType: roomData.roomType, width: mainRoom.width, length: mainRoom.length, height: mainRoom.height,
    style: appliedStyle, floorType, wallColors, furniture, openings,
  })

  const applyAiAction = (a) => {
    const prevFurniture = furniture
    const prevLook = { wallColors: { ...wallColors }, floorType }
    // the 3D view takes colours and floor from the "loaded look"; a new version makes it apply them
    const setLook = (look) => { setLoadedLook(look); setDesignVersion((v) => v + 1) }
    switch (a.kind) {
      case 'set_wall_color': {
        const next = a.wall === 'all'
          ? { front: a.color, back: a.color, left: a.color, right: a.color }
          : { ...wallColors, [a.wall]: a.color }
        setLook({ wallColors: next, floorType })
        return { ok: true, undo: () => setLook(prevLook) }
      }
      case 'set_floor':
        setLook({ wallColors, floorType: a.floor_type })
        return { ok: true, undo: () => setLook(prevLook) }
      case 'add_furniture': {
        const list = [...furniture]
        const added = []
        for (let i = 0; i < (a.piece.count || 1); i++) {
          const item = addPieceToRoom(a.piece, { room: mainRoom, openings, furniture: list, style: appliedStyle })
          if (!item) break
          list.push(item)
          added.push(item.id)
        }
        if (!added.length) return { ok: false, message: 'No free space for it in this room.' }
        setFurniture(list)
        return {
          ok: true,
          message: added.length < (a.piece.count || 1) ? `Only ${added.length} fitted.` : '',
          undo: () => setFurniture((f) => f.filter((x) => !added.includes(x.id))),
        }
      }
      case 'remove_furniture': {
        if (!furniture.some((f) => f.id === a.remove_id)) return { ok: false, message: 'That piece is no longer in the room.' }
        setFurniture(furniture.filter((f) => f.id !== a.remove_id))
        return { ok: true, undo: () => setFurniture(prevFurniture) }
      }
      case 'furnish_room': {
        // keeps the room's size, doors and windows: a scanned room keeps its real ones
        const d = buildRoomFromSpec(
          { style: a.style || appliedStyle, furniture: a.furniture },
          { room_width: mainRoom.width, room_length: mainRoom.length, wall_height: mainRoom.height, openings },
        )
        setFurniture(d.furniture)
        return {
          ok: true,
          message: d.notes.skipped.length ? `No space for: ${d.notes.skipped.join(', ')}` : '',
          undo: () => setFurniture(prevFurniture),
        }
      }
      default:
        return { ok: false, message: 'Unknown suggestion.' }
    }
  }

  // Arrow buttons in the Rooms panel: slide the selected room by `step` feet (never into another room)
  const nudgeRoom = (dx, dz, step = 1) => {
    if (!activeConn) return
    const next = resolveRoomMove({
      size: sizeOf(activeConn.design),
      from: activeConn.offset,
      to: { x: activeConn.offset.x + dx * step, z: activeConn.offset.z + dz * step },
      others: otherRects(mainRoom, connectedRooms, activeConn.uid),
    })
    moveConnectedRoom(activeConn.uid, next)
  }

  // ── Furniture panel ───────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState('Bedroom')

  // ── Load design from URL ?id=xxx ──────────────────────────
  useEffect(() => {
    if (!loadId) return
    const load = async () => {
      try {
        const res    = await api.get(`/api/designs/${loadId}`)
        const design = res.data.design
        setRoomData({
          roomType: design.room_type   || '',
          width:    String(design.room_width  || ''),
          length:   String(design.room_length || ''),
          height:   String(Number(design.wall_height) || 8),
          style:    design.style       || '',
        })
        setFurniture(
          Array.isArray(design.furniture) ? design.furniture
            : (typeof design.furniture === 'string' ? JSON.parse(design.furniture) : [])
        )
        setOpenings(
          Array.isArray(design.openings) ? design.openings
            : (typeof design.openings === 'string' ? JSON.parse(design.openings) : [])
        )
        const wc = typeof design.wall_colors === 'string'
          ? JSON.parse(design.wall_colors) : (design.wall_colors || {})
        const loadedWalls = { front:'#f5f5f0', back:'#f5f5f0', left:'#f5f5f0', right:'#f5f5f0', ...wc }
        setWallColors(loadedWalls)
        setFloorType(design.floor_type || 'lightWood')
        setLoadedLook({ wallColors: loadedWalls, floorType: design.floor_type || 'lightWood' })
        setConnections([])
        setSelectedRoomUid(null)
        setAppliedStyle(design.style || 'minimal')
        setSavedDesignId(design.id)
        setSavedDesignName(design.name)
        setDesignVersion((v) => v + 1)

        // Restore connected rooms (saved as full copies; old id-only saves are re-fetched once)
        let saved = design.connections
        if (typeof saved === 'string') { try { saved = JSON.parse(saved) } catch { saved = [] } }
        if (!Array.isArray(saved)) saved = []
        const restored = await Promise.all(saved.map(async (s) => {
          const uid = s.uid || `${s.design_id ?? 'room'}-${s.door_id}`
          const off = s.offset && Number.isFinite(Number(s.offset.x)) && Number.isFinite(Number(s.offset.z))
            ? { x: Number(s.offset.x), z: Number(s.offset.z) } : undefined
          if (s.design) return { uid, parentUid: s.parent_uid || null, doorId: s.door_id || null, offset: off, design: copyDesign(s.design) }
          if (s.design_id) {
            try {
              const r = await api.get(`/api/designs/${s.design_id}`)
              return { uid, parentUid: s.parent_uid || null, doorId: s.door_id || null, offset: off, design: copyDesign(r.data.design) }
            } catch { return null }
          }
          return null
        }))
        setConnections(restored.filter(Boolean))
      } catch (err) {
        setError('Failed to load design.')
        console.error(err)
      }
    }
    load()
  }, [loadId])

  // ── Generate ──────────────────────────────────────────────
  const handleGenerate = (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const width  = parseFloat(roomData.width)
    const length = parseFloat(roomData.length)
    if (!roomData.roomType) return setError('Please select a room type.')
    if (!width || !length || width < 6 || length < 6) return setError('Please enter valid dimensions (min 6 ft).')
    if (roomData.height !== '' && (!(parseFloat(roomData.height) >= MIN_WALL_H) || parseFloat(roomData.height) > MAX_WALL_H)) {
      return setError(`Wall height must be between ${MIN_WALL_H} and ${MAX_WALL_H} ft.`)
    }
    if (!roomData.style) return setError('Please select a style.')
    const result = generateRoom({ roomType: roomData.roomType, width, length, style: roomData.style })
    setFurniture(result.furniture)
    setOpenings(result.openings)
    setAppliedStyle(roomData.style)
    setDesignVersion((v) => v + 1)
    setGenInfo({ skipped: result.skipped || [] })
    // Clear saved ID — new generation is a new design
    setSavedDesignId(null)
    setSavedDesignName('')
    setLoadedLook(null)
    setConnections([])
    setSelectedRoomUid(null)
    if (isMobile) setPanelOpen(false)   // show the room, not the form
  }

  // ── Add furniture ─────────────────────────────────────────
  const handleAddFurniture = (type) => {
    const def = furnitureDefinitions[type]
    if (!def) return

    // Adds to whichever room is selected in the Rooms list (main room by default)
    if (activeConn) {
      const d    = activeConn.design
      const room = { width: Number(d.room_width) || 10, length: Number(d.room_length) || 12 }
      const item = createFurnitureInFreeSpot(type, d.furniture, d.openings, room, d.style || appliedStyle)
      if (!item) { setNotice(`No free space for ${def.name}.`); return }
      setNotice('')
      updateConnectedRoom(activeConn.uid, { furniture: [...d.furniture, item] })
      return
    }

    const room = {
      width:  parseFloat(roomData.width)  || 12,
      length: parseFloat(roomData.length) || 14,
    }
    const item = createFurnitureInFreeSpot(type, furniture, openings, room, appliedStyle)
    if (!item) { setNotice(`No free space for ${def.name}.`); return }
    setNotice('')
    setFurniture((prev) => [...prev, item])
  }

  const handleDeleteFurniture = (id) => {
    if (activeConn) {
      updateConnectedRoom(activeConn.uid, { furniture: activeConn.design.furniture.filter((f) => f.id !== id) })
    } else {
      setFurniture((prev) => prev.filter((f) => f.id !== id))
    }
  }
  const handleFurnitureUpdate  = useCallback((updated) => setFurniture(updated), [])

  // ── Save design ───────────────────────────────────────────
  const handleSaved = (design) => {
    setSavedDesignId(design.id)
    setSavedDesignName(design.name)
    setShowSaveModal(false)
    setSaveToast(`✓ "${design.name}" saved`)
    setTimeout(() => setSaveToast(''), 3000)
  }

  // Default name suggestion for the save modal
  const defaultDesignName = (() => {
    const rt = roomData.roomType?.replace('-', ' ')
    if (!rt) return `My Design`
    const label = rt.charAt(0).toUpperCase() + rt.slice(1)
    return savedDesignName || `My ${label}`
  })()

  // ── Export 2D floor plan as PDF (download or share) ───────
  const handleExport = async (mode) => {
    setShowExportMenu(false)
    const hasContent = furniture.length > 0 || openings.length > 0 || connectedRooms.length > 0
    if (!hasContent) {
      setExportMsg('Generate a room first')
      setTimeout(() => setExportMsg(''), 3000)
      return
    }
    setExporting(true)
    setExportMsg('')
    try {
      const result = await exportFloorPlanPdf({
        title:      savedDesignName || defaultDesignName,
        roomType:   roomData.roomType,
        width:      mainRoom.width,
        length:     mainRoom.length,
        furniture, openings, wallColors,
        connectedRooms, mainLinks,
      }, mode)
      setExportMsg(
        result === 'shared'    ? '✓ Shared'
        : result === 'fallback' ? '✓ PDF downloaded (sharing not supported here)'
        : result === 'cancelled' ? ''
        : '✓ PDF downloaded')
    } catch (err) {
      console.error(err)
      setExportMsg('Export failed')
    } finally {
      setExporting(false)
      setTimeout(() => setExportMsg(''), 3500)
    }
  }

  // ── Multi-room connect ────────────────────────────────────
  const handleDoorConnect = (door) => {
    setConnectingDoor(door)
    setShowConnectModal(true)
  }

  const handleConnectRoom = async (design, door) => {
    // The door may belong to the main room or to any connected room (door.roomUid)
    const parentUid = door.roomUid || null
    const parent    = parentUid ? connectedRooms.find((cr) => cr.uid === parentUid) : null
    const pSize     = parent ? sizeOf(parent.design) : { w: mainRoom.width, l: mainRoom.length }
    const pOff      = parent ? parent.offset : { x: 0, z: 0 }

    // 1. Copy the chosen design AND the rooms that were connected to it, as one group
    const main  = copyDesign(design)
    const group = [{ key: null, parentKey: null, doorId: null, rel: { x: 0, z: 0 }, design: main }]
    let saved = design.connections
    if (typeof saved === 'string') { try { saved = JSON.parse(saved) } catch { saved = [] } }
    if (!Array.isArray(saved)) saved = []
    const loaded = await Promise.all(saved.slice(0, 12).map(async (s) => {
      let d = s.design
      if (!d && s.design_id) {
        try { d = (await api.get(`/api/designs/${s.design_id}`)).data.design } catch { return null }
      }
      return d ? { s, design: copyDesign(d) } : null
    }))
    loaded.filter(Boolean).forEach(({ s, design: d }) => {
      const parentG = group.find((g) => g.key === (s.parent_uid || null)) || group[0]
      let rel = s.offset && Number.isFinite(Number(s.offset.x)) && Number.isFinite(Number(s.offset.z))
        ? { x: Number(s.offset.x), z: Number(s.offset.z) } : null
      if (!rel) {
        const pd = (parentG.design.openings || []).find((o) => o.id === s.door_id && o.type === 'door')
        const ps = sizeOf(parentG.design)
        const dd = defaultOffset(pd, { width: ps.w, length: ps.l }, sizeOf(d))
        rel = { x: parentG.rel.x + dd.x, z: parentG.rel.z + dd.z }
      }
      group.push({ key: s.uid || `${s.design_id}-${s.door_id}`, parentKey: parentG.key, doorId: s.door_id || null, rel, design: d })
    })

    // 2. Put the whole group where it fits (starting next to the door that was clicked)
    const d0 = defaultOffset(door, { width: pSize.w, length: pSize.l }, sizeOf(main))
    const replaced = (cr) => cr.parentUid === parentUid && cr.doorId === door.id   // reconnecting a door replaces its room
    const anchor = findFreeSpotRects({
      rels: group.map((g) => { const s = sizeOf(g.design); return roomRect(s.w, s.l, g.rel) }),
      desired: { x: pOff.x + d0.x, z: pOff.z + d0.z },
      others: otherRects(mainRoom, connectedRooms.filter((cr) => !replaced(cr)), null),
    })

    const stamp = Date.now()
    const uidOf = new Map(group.map((g, i) => [g.key, `room-${stamp}-${i}`]))
    const entries = group.map((g) => ({
      uid:       uidOf.get(g.key),
      parentUid: g.key === null ? parentUid : uidOf.get(g.parentKey),
      doorId:    g.key === null ? door.id : g.doorId,
      offset:    { x: anchor.x + g.rel.x, z: anchor.z + g.rel.z },
      design:    g.design,
    }))
    setConnections((prev) => [
      ...prev.filter((c) => !(c.parentUid === parentUid && c.doorId === door.id)),
      ...entries,
    ])
    setSelectedRoomUid(entries[0].uid)
    setShowConnectModal(false)
    setConnectingDoor(null)
  }

  // Delete the room selected in the Rooms list (main room can't be deleted)
  const handleDeleteSelectedRoom = () => {
    if (!activeConn) return
    if (!window.confirm(`Delete "${activeConn.design.name}" and everything in it from this design?`)) return
    setConnections((prev) => prev.filter((c) => c.uid !== activeConn.uid))
    setSelectedRoomUid(null)
  }

  // ── Category items ────────────────────────────────────────
  const activeFurniture = activeConn ? activeConn.design.furniture : furniture
  const categoryItems = (FURNITURE_CATEGORIES[activeCategory] || []).filter((t) => furnitureDefinitions[t])
  const styleInfo     = stylePresets[roomData.style]
  const totalItems    = furniture.length

  // ──────────────────────────────────────────────────────────
  return (
    // Pinned to the visible screen: the page itself never scrolls, so the top bar
    // and the bottom Save bar always stay in view. (h-screen is 100vh, which on a
    // phone includes the hidden address bar, so the page scrolled a little and
    // the top bar slid away.)
    <div className="fixed inset-0 h-dvh bg-bg text-text flex flex-col overflow-hidden overscroll-none">

      {/* Save modal */}
      {showSaveModal && (
        <SaveDesignModal
          initialName={defaultDesignName}
          savedDesignId={savedDesignId}
          roomData={roomData}
          furniture={furniture}
          openings={openings}
          wallColors={wallColors}
          floorType={floorType}
          connections={connectionsPayload}
          onSaved={handleSaved}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      {/* Connect room modal */}
      {showConnectModal && connectingDoor && (
        <ConnectRoomModal
          door={connectingDoor}
          currentDesignId={savedDesignId}
          onConnect={handleConnectRoom}
          onClose={() => { setShowConnectModal(false); setConnectingDoor(null) }}
        />
      )}

      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}

      {/* NAVBAR */}
      <nav className="flex items-center justify-between px-4 py-2.5 sm:px-6 sm:py-4 border-b border-border shrink-0">
        <Link to="/dashboard" className="text-lg font-bold tracking-tight">roomcraft</Link>
        <div className="flex items-center gap-3">
          {savedDesignName && (
            <span className="text-xs opacity-50 max-w-[120px] truncate hidden sm:block">
              {savedDesignName}
            </span>
          )}
          <button
            onClick={() => setShowTutorial(true)}
            title="Take a quick tour of the editor"
            className="text-sm w-8 h-8 rounded-full border border-border hover:bg-surface transition font-semibold"
          >
            ?
          </button>
          <button
            onClick={toggleTheme}
            className="text-sm px-3 py-1.5 rounded-full border border-border hover:bg-surface transition"
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
          <Link to="/dashboard" className="text-sm font-medium hover:text-accent transition">
            Dashboard
          </Link>
        </div>
      </nav>

      {/* MAIN */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* phones: dim the room behind the open panel; tap to close */}
        {isMobile && panelOpen && (
          <div className="absolute inset-0 z-30 bg-black/50" onClick={() => setPanelOpen(false)} />
        )}

        {/* LEFT PANEL */}
        <aside
          className={`border-r border-border bg-bg overflow-y-auto flex flex-col shrink-0 ${
            isMobile ? 'absolute inset-y-0 left-0 z-40 shadow-2xl transition-transform duration-200' : ''
          }`}
          style={isMobile
            ? { width: 'min(88vw, 360px)', transform: panelOpen ? 'translateX(0)' : 'translateX(-105%)', pointerEvents: panelOpen ? 'auto' : 'none' }
            : { width: panelWidth, display: panelOpen ? undefined : 'none' }}
        >
          {isMobile && (
            <div className="sticky top-0 z-10 bg-bg flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <span className="text-sm font-semibold">Room panel</span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-surface transition"
              >
                ✕ Close
              </button>
            </div>
          )}

          {/* Room Setup */}
          <div className="p-5 border-b border-border">
            <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50 mb-4">Room Setup</h2>
            <form onSubmit={handleGenerate} className="flex flex-col gap-3">

              {/* Scan room */}
              <button
                type="button" data-tutorial="scan-room"
                onClick={() => { window.location.href = '/scan.html' }}
                title="Measure your real room with your phone's camera"
                className="w-full py-2.5 rounded-lg border-2 border-dashed border-accent/50
                           text-accent text-sm font-medium flex items-center justify-center gap-2
                           hover:bg-accent/10 hover:border-accent transition"
              >
                <span>📷</span> Scan my room with the phone
              </button>

              <div className="flex items-center gap-2 text-xs opacity-40">
                <div className="flex-1 border-t border-border" />
                <span>or fill manually</span>
                <div className="flex-1 border-t border-border" />
              </div>

              {/* Room type */}
              <div className="flex flex-col gap-1.5" data-tutorial="room-type">
                <label className="text-xs font-medium opacity-70">Room type</label>
                <select
                  name="roomType" value={roomData.roomType}
                  onChange={(e) => { setRoomData({ ...roomData, roomType: e.target.value }); setError('') }}
                  className="px-3 py-2.5 rounded-lg border border-border bg-surface text-text text-sm
                             focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Select room type</option>
                  {(ROOM_TYPES || [
                    { id: 'bedroom',     name: 'Bedroom'     },
                    { id: 'living-room', name: 'Living Room' },
                    { id: 'study',       name: 'Study Room'  },
                    { id: 'dining',      name: 'Dining Room' },
                    { id: 'kitchen',     name: 'Kitchen'     },
                    { id: 'bathroom',    name: 'Bathroom'    },
                  ]).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Dimensions — show / edit whichever room is selected (main room, or a connected room) */}
              {activeConn && (
                <p className="text-[11px] opacity-60 -mb-1">
                  Editing <span className="font-medium text-text">{activeConn.design.name}</span> · Enter to apply size
                </p>
              )}
              <div className="grid grid-cols-3 gap-2" data-tutorial="dimensions">
                {['width', 'length', 'height'].map((field) => {
                  const sel = activeConn?.design
                  const common = {
                    placeholder: field === 'width' ? '10' : field === 'length' ? '12' : '8',
                    // any number of decimals (the browser's default step of 1 refuses 10.5)
                    step: 'any',
                    inputMode: 'decimal',
                    className: `px-3 py-2.5 rounded-lg border border-border bg-surface text-sm
                                focus:outline-none focus:ring-2 focus:ring-accent`,
                  }
                  return (
                    <div key={field} className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium opacity-70 capitalize" title={field === 'height' ? 'Wall height: 8–15 ft' : undefined}>
                        {field} (ft)
                      </label>
                      {sel && field !== 'height' ? (
                        <CommitInput
                          key={`${activeConn.uid}-${field}`}
                          value={sel[`room_${field}`]}
                          min={6} max={60} step="any"
                          onCommit={(n) => resizeConnectedRoom(activeConn.uid, { [field]: n })}
                          {...common}
                        />
                      ) : (
                        <input
                          type="number"
                          value={sel ? (sel.wall_height ?? 8) : roomData[field]}
                          min={field === 'height' ? MIN_WALL_H : undefined}
                          max={field === 'height' ? MAX_WALL_H : undefined}
                          step="any" inputMode="decimal"
                          onChange={(e) => {
                            if (sel) updateConnectedRoom(activeConn.uid, { wall_height: e.target.value })
                            else setRoomData({ ...roomData, [field]: e.target.value })
                            setError('')
                          }}
                          {...common}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Style */}
              <div className="flex flex-col gap-1.5" data-tutorial="style">
                <label className="text-xs font-medium opacity-70">Style</label>
                <select
                  name="style" value={roomData.style}
                  onChange={(e) => { setRoomData({ ...roomData, style: e.target.value }); setError('') }}
                  className="px-3 py-2.5 rounded-lg border border-border bg-surface text-text text-sm
                             focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Select style</option>
                  {Object.entries(stylePresets || {
                    minimal: { name: 'Minimal' }, modern: { name: 'Modern' },
                    cozy: { name: 'Cozy' }, industrial: { name: 'Industrial' },
                  }).map(([id, s]) => (
                    <option key={id} value={id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2">
                  <p className="text-xs text-red-500">{error}</p>
                </div>
              )}

              <button
                type="submit" data-tutorial="generate"
                className="py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition"
              >
                Generate Room
              </button>
            </form>
          </div>

          {/* Rooms: pick one to edit / add furniture to / delete */}
          {connectedRooms.length > 0 && (
            <div className="p-5 border-b border-border">
              <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50 mb-3">Rooms</h2>
              <div className="flex flex-col gap-1.5">
                {[{ uid: null, name: 'Main room', sub: roomData.roomType?.replace('-', ' ') || '' },
                  ...connectedRooms.map((cr) => ({ uid: cr.uid, name: cr.design.name, sub: cr.door ? `via ${cr.door.wall} door` : 'free-standing' })),
                ].map((rm) => {
                  const isSel = rm.uid === null ? !activeConn : activeConn?.uid === rm.uid
                  return (
                    <button
                      key={rm.uid ?? 'main'}
                      type="button"
                      onClick={() => setSelectedRoomUid(rm.uid)}
                      className={`text-left px-3 py-2 rounded-lg border transition ${
                        isSel ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:border-accent/40'
                      }`}
                    >
                      <p className="text-sm truncate">{rm.name}</p>
                      {rm.sub && <p className="text-[11px] opacity-50 capitalize">{rm.sub}</p>}
                    </button>
                  )
                })}
              </div>
              {activeConn && (
                <div className="mt-3">
                  <button type="button" onClick={() => rotateConnectedRoom(activeConn.uid)}
                    className="mb-3 w-full text-xs px-3 py-2 rounded-lg border border-border bg-surface hover:border-accent/40">
                    ⟳ Turn room 90°
                  </button>
                  <p className="text-[11px] opacity-50 mb-1.5">Move room (or drag ✥ on the plan)</p>
                  <div className="grid grid-cols-3 gap-1 w-[108px]">
                    <span />
                    <button type="button" onClick={() => nudgeRoom(0, -1)} className="py-1 rounded border border-border bg-surface hover:border-accent/40 text-sm">↑</button>
                    <span />
                    <button type="button" onClick={() => nudgeRoom(-1, 0)} className="py-1 rounded border border-border bg-surface hover:border-accent/40 text-sm">←</button>
                    <button type="button" onClick={() => nudgeRoom(0, 1)} className="py-1 rounded border border-border bg-surface hover:border-accent/40 text-sm">↓</button>
                    <button type="button" onClick={() => nudgeRoom(1, 0)} className="py-1 rounded border border-border bg-surface hover:border-accent/40 text-sm">→</button>
                  </div>
                </div>
              )}
              {!activeConn && (
                <button type="button" onClick={rotateMainRoom}
                  className="mt-3 w-full text-xs px-3 py-2 rounded-lg border border-border bg-surface hover:border-accent/40"
                  title="Connected rooms turn with it and stay docked">
                  ⟳ Turn main room 90°
                </button>
              )}
              <button
                type="button"
                onClick={handleDeleteSelectedRoom}
                disabled={!activeConn}
                className="mt-3 w-full text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-500
                           hover:bg-red-500/20 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                🗑 Delete selected room
              </button>
            </div>
          )}

          {/* Skipped items notice */}
          {genInfo?.skipped?.length > 0 && (
            <div className="px-5 py-3 border-b border-border">
              <p className="text-xs opacity-60">
                📐 Didn't fit: <span className="font-medium">
                  {[...new Set(genInfo.skipped.map((s) => s.name || s))].join(', ')}
                </span>
              </p>
            </div>
          )}

          {/* In Room list */}
          {activeFurniture.length > 0 && (
            <div className="p-5 border-b border-border" data-tutorial="in-room-list">
              <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50 mb-3">
                In {activeConn ? activeConn.design.name : 'Room'}
              </h2>
              <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                {activeFurniture.map((item) => (
                  <div key={item.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-surface">
                    <span className="text-sm truncate">{item.name}</span>
                    <button
                      onClick={() => handleDeleteFurniture(item.id)}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10
                                 text-red-500 hover:bg-red-500/20 transition shrink-0 ml-2"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Furniture */}
          <div className="p-5 flex flex-col gap-3 flex-1" data-tutorial="add-furniture">
            <h2 className="text-xs font-semibold uppercase tracking-widest opacity-50">
              Add Furniture{activeConn ? ` to ${activeConn.design.name}` : ''}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-lg">{CATEGORY_ICONS[activeCategory]}</span>
              <select
                value={activeCategory}
                onChange={(e) => setActiveCategory(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-text text-sm
                           focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {Object.keys(FURNITURE_CATEGORIES).map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {categoryItems.map((type) => {
                const def = furnitureDefinitions[type]
                return (
                  <button key={type} type="button"
                    onClick={() => handleAddFurniture(type)}
                    className="text-left border border-border rounded-xl px-3 py-2.5 bg-surface
                               hover:bg-accent/10 hover:border-accent/40 transition group"
                  >
                    <span className="block text-sm font-medium group-hover:text-accent transition">
                      + {def.name}
                    </span>
                    {def.wallMounted && (
                      <span className="block text-[11px] opacity-50 mt-0.5">Hangs on wall</span>
                    )}
                  </button>
                )
              })}
            </div>
            {notice && <p className="text-[11px] text-red-500">{notice}</p>}
          </div>
        </aside>

        {/* desktop: drag to resize the panel, double-click to hide it */}
        {!isMobile && panelOpen && (
          <div
            onPointerDown={startPanelResize}
            onDoubleClick={() => setPanelOpen(false)}
            title="Drag to resize · double-click to hide"
            className="w-1.5 shrink-0 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors"
          />
        )}

        {/* 3D VIEWER + BOTTOM BAR */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            data-tutorial="room-panel"
            title={panelOpen ? 'Hide panel' : 'Show panel'}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 px-2 py-4 rounded-r-lg
                       bg-black/70 hover:bg-black/90 text-white text-sm shadow-lg"
          >
            {isMobile ? '☰' : panelOpen ? '‹' : '›'}
          </button>
          <div className="flex-1 overflow-hidden">
            <RoomViewer
              width={parseFloat(roomData.width)   || 12}
              length={parseFloat(roomData.length)  || 14}
              height={mainRoom.height}
              style={appliedStyle}
              designVersion={designVersion}
              furniture={furniture}
              openings={openings}
              connectedRooms={connectedRooms}
              onFurnitureUpdate={handleFurnitureUpdate}
              onOpeningsUpdate={setOpenings}
              onWallColorsChange={setWallColors}
              onFloorTypeChange={setFloorType}
              onDoorConnect={handleDoorConnect}
              initialLook={loadedLook}
              activeRoomUid={selectedRoomUid}
              onActiveRoomChange={setSelectedRoomUid}
              onConnectedRoomChange={updateConnectedRoom}
              mainLinks={mainLinks}
              onMoveRoom={moveConnectedRoom}
              onDeleteRoom={handleDeleteSelectedRoom}
              onRotateRoom={activeConn ? () => rotateConnectedRoom(activeConn.uid) : rotateMainRoom}
              onAskAi={() => setAiOpen(true)}
            />
          </div>

          {/* BOTTOM BAR */}
          <div className="border-t border-border px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="text-sm font-medium">
              {totalItems} item{totalItems !== 1 ? 's' : ''}
              {connectedRooms.length > 0 && (
                <span className="opacity-50 ml-2">
                  + {connectedRooms.length} connected room{connectedRooms.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              {/* Save toast */}
              {saveToast && (
                <span className="text-xs text-green-500 font-medium">{saveToast}</span>
              )}

              {exportMsg && (
                <span className={`text-xs font-medium ${exportMsg.startsWith('✓') ? 'text-green-500' : 'text-red-500'}`}>
                  {exportMsg}
                </span>
              )}

              {/* Export 2D plan as PDF */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    // open the menu above the button, kept fully on screen (works on narrow phones too)
                    const r = e.currentTarget.getBoundingClientRect()
                    setExportMenuPos({
                      left:   Math.max(8, Math.min(r.left, window.innerWidth - 184)),
                      bottom: window.innerHeight - r.top + 8,
                    })
                    setShowExportMenu((v) => !v)
                  }}
                  disabled={exporting}
                  title="Export the 2D floor plan as PDF"
                  className="px-3 py-2 rounded-lg border border-border text-xs font-medium
                             hover:bg-surface transition disabled:opacity-40"
                >
                  {exporting ? 'Exporting…' : '📄 Export ▾'}
                </button>
                {showExportMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                    <div className="fixed z-50 w-44 rounded-xl border border-border bg-bg shadow-xl py-1 text-sm"
                         style={{ left: exportMenuPos.left, bottom: exportMenuPos.bottom }}>
                      <button type="button" onClick={() => handleExport('download')}
                              className="w-full text-left px-3 py-2 hover:bg-surface transition">
                        ⬇ Download PDF
                      </button>
                      <button type="button" onClick={() => handleExport('share')}
                              className="w-full text-left px-3 py-2 hover:bg-surface transition">
                        📤 Share PDF
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Quick update if already saved */}
              {savedDesignId && (
                <button
                  type="button"
                  onClick={() => setShowSaveModal(true)}
                  className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-text
                             hover:bg-surface transition"
                >
                  Update
                </button>
              )}

              <button
                type="button"
                data-tutorial="save"
                onClick={() => setShowSaveModal(true)}
                className="px-5 py-2 rounded-lg bg-accent text-white text-sm font-medium
                           hover:opacity-90 transition"
              >
                💾 {savedDesignId ? 'Save as new' : 'Save Design'}
              </button>
            </div>
          </div>
        </div>

        {/* on a wide screen the chat is a column beside the room (the room view
            narrows, nothing is covered); on a phone it is a bottom sheet */}
        <AiChatPanel designId={savedDesignId} getRoom={aiRoomSummary} onApply={applyAiAction} open={aiOpen} onOpenChange={setAiOpen} />
      </div>
    </div>
  )
}
