import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { env } from '../config/env.js'
import { query } from '../config/db.js'
import { createDesign } from '../models/designModel.js'
import {
  createUser,
  findUserByEmail,
  markUserVerified,
  updateUserPassword,
} from '../models/userModel.js'
import {
  createOtp,
  invalidatePreviousOtps,
  verifyAndGetOtp,
  markOtpUsed,
} from '../models/otpModel.js'
import { generateOtp, getOtpExpiry } from '../utils/generateOtp.js'
import { sendOtpEmail } from '../utils/sendEmail.js'
import { signToken } from '../utils/jwt.js'

// ── Validation helpers ────────────────────────────────────────

const isStrongPassword = (pw) =>
  typeof pw === 'string' &&
  pw.length >= 8 &&
  /[A-Z]/.test(pw) &&
  /[0-9]/.test(pw)

// ── POST /api/auth/register ───────────────────────────────────
// Accepts: { name, email, password }
// Creates (or refreshes) the user, sends OTP, does NOT issue JWT yet.
// JWT is issued at login AFTER OTP verification.
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required.' })
    if (name.length > 100)
      return res.status(400).json({ message: 'Name must be 100 characters or fewer.' })
    if (email.length > 255)
      return res.status(400).json({ message: 'Email must be 255 characters or fewer.' })
    if (!isStrongPassword(password))
      return res.status(400).json({
        message: 'Password must be at least 8 characters and include an uppercase letter and a number.',
      })

    const existing = await findUserByEmail(email)
    if (existing?.is_verified)
      return res.status(409).json({ message: 'An account with this email already exists.' })

    const passwordHash = await bcrypt.hash(password, 10)

    if (existing && !existing.is_verified) {
      // User tried to register before but never verified — refresh their password
      await updateUserPassword(email, passwordHash)
    } else {
      await createUser({ name, email, passwordHash })
    }

    // live demo: no email is sent; the account is active straight away
    if (env.DEMO_MODE) {
      const user  = await markUserVerified(email)
      const token = signToken({ id: user.id, email: user.email })
      return res.status(201).json({
        message: 'Account created.',
        token,
        user: { id: user.id, name: user.name, email: user.email, onboarding_complete: user.onboarding_complete },
      })
    }

    await invalidatePreviousOtps(email, 'register')
    const otp      = generateOtp()
    const expiry   = getOtpExpiry(10)
    await createOtp({ email, otpCode: otp, purpose: 'register', expiresAt: expiry })
    await sendOtpEmail({ to: email, otp, purpose: 'register' })

    return res.status(201).json({
      message: 'OTP sent to your email. Please verify to complete registration.',
      email,
    })
  } catch (err) {
    console.error('[registerUser]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ── POST /api/auth/demo ───────────────────────────────────────
// Live demo only: a fresh, private sample account with a few saved designs,
// so a visitor can try everything without signing up. Demo accounts older
// than two days are removed (their designs go with them).
const DEMO_DESIGNS = JSON.parse(readFileSync(new URL('../data/demo_designs.json', import.meta.url), 'utf8'))
const DEMO_DOMAIN = 'demo.roomcraft.app'
export const demoLogin = async (_req, res) => {
  if (!env.DEMO_MODE) return res.status(404).json({ message: 'Route not found.' })
  try {
    await query(`DELETE FROM users WHERE email LIKE $1 AND created_at < NOW() - INTERVAL '2 days'`, [`demo-%@${DEMO_DOMAIN}`])
    const email = `demo-${crypto.randomBytes(6).toString('hex')}@${DEMO_DOMAIN}`
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('base64'), 10)   // never used
    const created = await createUser({ name: 'Demo User', email, passwordHash })
    await query('UPDATE users SET is_verified = TRUE, onboarding_complete = TRUE WHERE id = $1', [created.id])
    for (const d of DEMO_DESIGNS) await createDesign(created.id, d)
    const token = signToken({ id: created.id, email })
    return res.status(200).json({
      message: 'Demo account ready.',
      token,
      user: { id: created.id, name: 'Demo User', email, profession: null, avatar_url: null, onboarding_complete: true },
    })
  } catch (err) {
    console.error('[demoLogin]', err)
    return res.status(500).json({ message: 'Could not start the demo. Please try again.' })
  }
}

// ── POST /api/auth/login ──────────────────────────────────────
// Accepts: { email, password }
// Returns: { token, user }
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' })

    const user = await findUserByEmail(email)

    // Always run bcrypt even on missing user to prevent timing-based enumeration
    if (!user) {
      await bcrypt.compare(password, '$2b$10$invalidhashpaddingtowastecycles00000000000000000000000')
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    if (!user.is_verified)
      return res.status(403).json({
        message: 'Please verify your email before logging in.',
        action: 'verify-email',
        email: user.email,
      })

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match)
      return res.status(401).json({ message: 'Invalid email or password.' })

    const token = signToken({ id: user.id, email: user.email })

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id:                  user.id,
        name:                user.name,
        email:               user.email,
        profession:          user.profession,
        avatar_url:          user.avatar_url,
        onboarding_complete: user.onboarding_complete,
      },
    })
  } catch (err) {
    console.error('[loginUser]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ── POST /api/auth/forgot-password ───────────────────────────
// Accepts: { email }
// Always returns the same message to prevent user enumeration
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email)
      return res.status(400).json({ message: 'Email is required.' })

    const user = await findUserByEmail(email)
    if (!user)
      return res.status(200).json({ message: 'If that email is registered, an OTP has been sent.' })

    if (!user.is_verified)
      return res.status(200).json({ message: 'If that email is registered, an OTP has been sent.' })

    await invalidatePreviousOtps(email, 'reset_password')
    const otp    = generateOtp()
    const expiry = getOtpExpiry(10)
    await createOtp({ email, otpCode: otp, purpose: 'reset_password', expiresAt: expiry })
    await sendOtpEmail({ to: email, otp, purpose: 'reset_password' })

    return res.status(200).json({ message: 'If that email is registered, an OTP has been sent.' })
  } catch (err) {
    console.error('[forgotPassword]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ── POST /api/auth/reset-password ─────────────────────────────
// Accepts: { email, otp, newPassword }
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body
    if (!email || !otp || !newPassword)
      return res.status(400).json({ message: 'Email, OTP and new password are required.' })
    if (!isStrongPassword(newPassword))
      return res.status(400).json({
        message: 'Password must be at least 8 characters and include an uppercase letter and a number.',
      })

    const otpRecord = await verifyAndGetOtp(email, 'reset_password', otp)
    if (!otpRecord)
      return res.status(400).json({ message: 'Invalid or expired OTP.' })

    await markOtpUsed(otpRecord.id)
    const hash = await bcrypt.hash(newPassword, 10)
    await updateUserPassword(email, hash)

    return res.status(200).json({ message: 'Password reset successfully. You can now log in.' })
  } catch (err) {
    console.error('[resetPassword]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}
