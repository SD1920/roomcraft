// controllers/designController.js
import {
  createDesign,
  getUserDesigns,
  getDesignById,
  updateDesign,
  deleteDesign,
} from '../models/designModel.js'

// Connected rooms are saved INSIDE the design as full copies:
//   [{ uid, parent_uid (nullable), door_id (nullable), wall, offset: { x, z }, design: { name, room_type, room_width, room_length, style,
//                                    floor_type, wall_colors, furniture, openings } }]
// Older id-only entries ({ design_id, door_id, wall }) are still accepted.
const WALLS = ['front', 'back', 'left', 'right']
// Wall height in feet: anything outside 8–15 (or not a number) is pulled back into range
const MIN_WALL_HEIGHT = 8
const MAX_WALL_HEIGHT = 15
const cleanWallHeight = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return MIN_WALL_HEIGHT
  return Math.min(MAX_WALL_HEIGHT, Math.max(MIN_WALL_HEIGHT, Math.round(n * 10000) / 10000))
}
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
const cleanConnections = (input) => {
  if (!Array.isArray(input)) return []
  return input.slice(0, 30).map((c) => {
    if (!c || typeof c !== 'object') return null
    const door_id = typeof c.door_id === 'string' ? c.door_id.slice(0, 100) : null   // may be null: a free-standing room
    const ox = Number(c.offset?.x)
    const oz = Number(c.offset?.z)
    const base = {
      offset: Number.isFinite(ox) && Number.isFinite(oz)
        ? { x: Math.max(-500, Math.min(500, ox)), z: Math.max(-500, Math.min(500, oz)) }
        : null,
      uid:  typeof c.uid === 'string' ? c.uid.slice(0, 120) : null,
      parent_uid: typeof c.parent_uid === 'string' ? c.parent_uid.slice(0, 120) : null,   // room this one was attached through (null = main room)
      door_id,
      wall: WALLS.includes(c.wall) ? c.wall : null,
    }
    const dz = c.design
    if (isPlainObject(dz)) {
      const src = parseInt(dz.source_design_id)
      return {
        ...base,
        design: {
          source_design_id: Number.isInteger(src) ? src : null,
          name:        String(dz.name || 'Room').slice(0, 100),
          room_type:   typeof dz.room_type === 'string' ? dz.room_type.slice(0, 60) : null,
          room_width:  Number(dz.room_width)  || 10,
          room_length: Number(dz.room_length) || 12,
          wall_height: cleanWallHeight(dz.wall_height),
          style:       typeof dz.style === 'string' ? dz.style.slice(0, 40) : null,
          floor_type:  typeof dz.floor_type === 'string' ? dz.floor_type.slice(0, 40) : 'lightWood',
          wall_colors: isPlainObject(dz.wall_colors) ? dz.wall_colors : {},
          furniture:   Array.isArray(dz.furniture) ? dz.furniture.slice(0, 300) : [],
          openings:    Array.isArray(dz.openings)  ? dz.openings.slice(0, 100)  : [],
        },
      }
    }
    const id = parseInt(c.design_id)
    return Number.isInteger(id) ? { ...base, design_id: id } : null
  }).filter(Boolean)
}

// ── POST /api/designs ─────────────────────────────────────────
// Body: { name, room_type, room_width, room_length, style,
//         furniture, openings, wall_colors, floor_type, connections?, thumbnail? }
export const saveDesign = async (req, res) => {
  try {
    const { name, room_type, room_width, room_length, wall_height,
            style, furniture, openings, wall_colors,
            floor_type, connections, thumbnail } = req.body

    if (!name || !name.trim())
      return res.status(400).json({ message: 'Design name is required.' })
    if (name.trim().length > 100)
      return res.status(400).json({ message: 'Name must be 100 characters or fewer.' })

    const design = await createDesign(req.user.id, {
      name: name.trim(),
      room_type, room_width, room_length,
      wall_height: cleanWallHeight(wall_height),
      style, furniture, openings, wall_colors, floor_type, thumbnail,
      connections: cleanConnections(connections),
    })

    return res.status(201).json({ message: 'Design saved.', design })
  } catch (err) {
    console.error('[saveDesign]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── GET /api/designs ──────────────────────────────────────────
// Returns list (no furniture/openings — those are heavy, fetch on demand)
export const getDesigns = async (req, res) => {
  try {
    const designs = await getUserDesigns(req.user.id)
    return res.status(200).json({ designs })
  } catch (err) {
    console.error('[getDesigns]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── GET /api/designs/:id ──────────────────────────────────────
// Returns full design including furniture + openings as parsed JSON
export const getDesign = async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id))
      return res.status(400).json({ message: 'Invalid design ID.' })

    const design = await getDesignById(id, req.user.id)
    if (!design)
      return res.status(404).json({ message: 'Design not found.' })

    // pg returns JSONB columns as already-parsed objects — no need to JSON.parse
    return res.status(200).json({ design })
  } catch (err) {
    console.error('[getDesign]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── PUT /api/designs/:id ──────────────────────────────────────
// Updates any subset of fields (full or partial)
export const editDesign = async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id))
      return res.status(400).json({ message: 'Invalid design ID.' })

    if (req.body.name !== undefined) {
      if (!req.body.name.trim())
        return res.status(400).json({ message: 'Design name cannot be empty.' })
      req.body.name = req.body.name.trim()
    }

    if (req.body.wall_height !== undefined) {
      req.body.wall_height = cleanWallHeight(req.body.wall_height)
    }

    if (req.body.connections !== undefined) {
      req.body.connections = cleanConnections(req.body.connections)
    }

    const updated = await updateDesign(id, req.user.id, req.body)
    if (!updated)
      return res.status(404).json({ message: 'Design not found or nothing to update.' })

    return res.status(200).json({ message: 'Design updated.', design: updated })
  } catch (err) {
    console.error('[editDesign]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── DELETE /api/designs/:id ───────────────────────────────────
export const removeDesign = async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id))
      return res.status(400).json({ message: 'Invalid design ID.' })

    const deleted = await deleteDesign(id, req.user.id)
    if (!deleted)
      return res.status(404).json({ message: 'Design not found.' })

    return res.status(200).json({ message: 'Design deleted.' })
  } catch (err) {
    console.error('[removeDesign]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}
