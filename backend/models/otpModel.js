import { query } from '../config/db.js'
import bcrypt from 'bcryptjs'

const OTP_HASH_ROUNDS = 10

// ─────────────────────────────────────────────────────────────
// OTPs are bcrypt-hashed before storage.
// This means even a full DB leak can't be used to hijack accounts
// via a valid-but-stolen OTP.
// ─────────────────────────────────────────────────────────────

export const createOtp = async ({ email, otpCode, purpose, expiresAt }) => {
  const otpHash = await bcrypt.hash(otpCode, OTP_HASH_ROUNDS)
  const result  = await query(
    `INSERT INTO otps (email, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, purpose, expires_at`,
    [email, otpHash, purpose, expiresAt],
  )
  return result.rows[0]
}

export const getLatestOtp = async (email, purpose) => {
  const result = await query(
    `SELECT * FROM otps
     WHERE email = $1 AND purpose = $2
       AND is_used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, purpose],
  )
  return result.rows[0] || null
}

// Use this in controllers — never compare otp_code directly (it's a hash)
export const verifyAndGetOtp = async (email, purpose, rawOtp) => {
  const record = await getLatestOtp(email, purpose)
  if (!record) return null
  const isMatch = await bcrypt.compare(rawOtp, record.otp_code)
  if (!isMatch) return null
  return record
}

export const markOtpUsed = async (id) => {
  const result = await query(
    `UPDATE otps SET is_used = TRUE WHERE id = $1 RETURNING id`,
    [id],
  )
  return result.rows[0] || null
}

export const invalidatePreviousOtps = async (email, purpose) => {
  await query(
    `UPDATE otps SET is_used = TRUE
     WHERE email = $1 AND purpose = $2 AND is_used = FALSE`,
    [email, purpose],
  )
}

export const deleteExpiredOtps = async () => {
  await query(`DELETE FROM otps WHERE expires_at < NOW()`)
}
