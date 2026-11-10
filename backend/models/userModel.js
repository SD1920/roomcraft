import { query } from '../config/db.js'

// ── Create ────────────────────────────────────────────────────

export const createUser = async ({ name, email, passwordHash }) => {
  const result = await query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, is_verified, onboarding_complete, created_at`,
    [name, email, passwordHash],
  )
  return result.rows[0]
}

// ── Read ──────────────────────────────────────────────────────

export const findUserByEmail = async (email) => {
  const result = await query(
    `SELECT * FROM users WHERE email = $1`,
    [email],
  )
  return result.rows[0] || null
}

export const findUserById = async (id) => {
  const result = await query(
    `SELECT id, name, email, profession, avatar_url,
            is_verified, onboarding_complete, created_at
     FROM users WHERE id = $1`,
    [id],
  )
  return result.rows[0] || null
}

// ── Update ────────────────────────────────────────────────────

export const markUserVerified = async (email) => {
  const result = await query(
    `UPDATE users
     SET is_verified = TRUE, updated_at = NOW()
     WHERE email = $1
     RETURNING id, name, email, is_verified, onboarding_complete`,
    [email],
  )
  return result.rows[0] || null
}

export const markOnboardingComplete = async (userId) => {
  const result = await query(
    `UPDATE users
     SET onboarding_complete = TRUE, updated_at = NOW()
     WHERE id = $1
     RETURNING id, onboarding_complete`,
    [userId],
  )
  return result.rows[0] || null
}

export const updateUserPassword = async (email, passwordHash) => {
  const result = await query(
    `UPDATE users
     SET password_hash = $1, updated_at = NOW()
     WHERE email = $2
     RETURNING id, email`,
    [passwordHash, email],
  )
  return result.rows[0] || null
}

// Name + profession — both optional, update only what is provided
export const updateUserProfile = async (userId, { name, profession }) => {
  // Build SET clause dynamically so we don't clear fields that weren't sent
  const fields  = []
  const values  = []
  let   idx     = 1

  if (name !== undefined) {
    fields.push(`name = $${idx++}`)
    values.push(name)
  }
  if (profession !== undefined) {
    fields.push(`profession = $${idx++}`)
    values.push(profession)
  }

  if (fields.length === 0) return null   // nothing to update

  values.push(userId)
  const result = await query(
    `UPDATE users
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx}
     RETURNING id, name, email, profession, avatar_url, onboarding_complete`,
    values,
  )
  return result.rows[0] || null
}

export const updateUserAvatar = async (userId, avatarUrl) => {
  const result = await query(
    `UPDATE users
     SET avatar_url = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, avatar_url`,
    [avatarUrl, userId],
  )
  return result.rows[0] || null
}
