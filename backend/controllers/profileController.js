import bcrypt from 'bcryptjs'
import path   from 'path'
import fs     from 'fs'
import { query }           from '../config/db.js'
import {
  findUserById,
  updateUserProfile,
  updateUserAvatar,
  updateUserPassword,
} from '../models/userModel.js'

// ── GET /api/profile ──────────────────────────────────────────
export const getProfile = async (req, res) => {
  try {
    const user = await findUserById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    return res.status(200).json({ user })
  } catch (err) {
    console.error('[getProfile]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── PUT /api/profile ──────────────────────────────────────────
// Accepts: { name?, profession? }
export const updateProfile = async (req, res) => {
  try {
    const { name, profession } = req.body

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0)
        return res.status(400).json({ message: 'Name cannot be empty.' })
      if (name.trim().length > 100)
        return res.status(400).json({ message: 'Name must be 100 characters or fewer.' })
    }
    if (profession !== undefined && typeof profession === 'string' && profession.length > 150)
      return res.status(400).json({ message: 'Profession must be 150 characters or fewer.' })

    const updated = await updateUserProfile(req.user.id, {
      name:       name?.trim(),
      profession: profession !== undefined ? (profession.trim() || null) : undefined,
    })

    if (!updated) return res.status(400).json({ message: 'Nothing to update.' })
    return res.status(200).json({ message: 'Profile updated.', user: updated })
  } catch (err) {
    console.error('[updateProfile]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── PUT /api/profile/password ──────────────────────────────────
// Accepts: { currentPassword, newPassword }
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Current and new passwords are required.' })

    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    )
      return res.status(400).json({
        message: 'New password must be at least 8 characters and include an uppercase letter and a number.',
      })

    // Need the full row (password_hash) — findUserById omits it for security
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id])
    const user = rows[0]
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const match = await bcrypt.compare(currentPassword, user.password_hash)
    if (!match) return res.status(401).json({ message: 'Current password is incorrect.' })

    if (currentPassword === newPassword)
      return res.status(400).json({ message: 'New password must differ from the current one.' })

    const hash = await bcrypt.hash(newPassword, 10)
    await updateUserPassword(user.email, hash)

    return res.status(200).json({ message: 'Password changed successfully.' })
  } catch (err) {
    console.error('[changePassword]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── POST /api/profile/avatar ──────────────────────────────────
// Multer runs before this controller (routes/profileRoutes.js)
export const uploadAvatar = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: 'No image file provided.' })

    // stored in the database as a data URL (no permanent disk on the hosting)
    const avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`

    const updated = await updateUserAvatar(req.user.id, avatarUrl)
    return res.status(200).json({ message: 'Avatar updated.', avatar_url: updated.avatar_url })
  } catch (err) {
    console.error('[uploadAvatar]', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}
