// models/designModel.js
import { query } from '../config/db.js'

// ── Create ────────────────────────────────────────────────────
export const createDesign = async (userId, data) => {
  const result = await query(
    `INSERT INTO designs
       (user_id, name, room_type, room_width, room_length,
        style, furniture, openings, wall_colors, floor_type, connections, thumbnail, wall_height)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      userId,
      data.name        || 'Untitled Design',
      data.room_type   || null,
      data.room_width  || null,
      data.room_length || null,
      data.style       || null,
      JSON.stringify(data.furniture   || []),
      JSON.stringify(data.openings    || []),
      JSON.stringify(data.wall_colors || {}),
      data.floor_type  || 'lightWood',
      JSON.stringify(data.connections || []),
      data.thumbnail   || null,
      data.wall_height || 8,
    ],
  )
  return result.rows[0]
}

// ── Read all (list) ───────────────────────────────────────────
export const getUserDesigns = async (userId) => {
  const result = await query(
    `SELECT id, name, room_type, room_width, room_length, wall_height,
            style, floor_type, thumbnail, created_at, updated_at
     FROM designs
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  )
  return result.rows
}

// ── Read one (full, including furniture + openings) ───────────
export const getDesignById = async (id, userId) => {
  const result = await query(
    `SELECT * FROM designs WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return result.rows[0] || null
}

// ── Update ────────────────────────────────────────────────────
export const updateDesign = async (id, userId, data) => {
  // Build SET clause from whatever fields are provided
  const fields = []
  const values = []
  let   idx    = 1

  const add = (col, val) => { fields.push(`${col} = $${idx++}`); values.push(val) }

  if (data.name        !== undefined) add('name',        data.name)
  if (data.room_type   !== undefined) add('room_type',   data.room_type)
  if (data.room_width  !== undefined) add('room_width',  data.room_width)
  if (data.room_length !== undefined) add('room_length', data.room_length)
  if (data.wall_height !== undefined) add('wall_height', data.wall_height)
  if (data.style       !== undefined) add('style',       data.style)
  if (data.furniture   !== undefined) add('furniture',   JSON.stringify(data.furniture))
  if (data.openings    !== undefined) add('openings',    JSON.stringify(data.openings))
  if (data.wall_colors !== undefined) add('wall_colors', JSON.stringify(data.wall_colors))
  if (data.floor_type  !== undefined) add('floor_type',  data.floor_type)
  if (data.connections !== undefined) add('connections', JSON.stringify(data.connections))
  if (data.thumbnail   !== undefined) add('thumbnail',   data.thumbnail)

  if (fields.length === 0) return null

  values.push(id, userId)
  const result = await query(
    `UPDATE designs
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx} AND user_id = $${idx + 1}
     RETURNING *`,
    values,
  )
  return result.rows[0] || null
}

// ── Delete ────────────────────────────────────────────────────
export const deleteDesign = async (id, userId) => {
  const result = await query(
    `DELETE FROM designs WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  )
  return result.rows[0] || null
}
