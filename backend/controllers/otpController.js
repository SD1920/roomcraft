import { verifyAndGetOtp, markOtpUsed } from '../models/otpModel.js'
import { markUserVerified }            from '../models/userModel.js'
import { signToken }                   from '../utils/jwt.js'

// ── POST /api/otp/verify-register ─────────────────────────────
// Accepts: { email, otp }
// Marks the user verified and returns a JWT so the user is
// immediately logged in — no extra login step needed.
export const verifyRegisterOtp = async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp)
      return res.status(400).json({ message: 'Email and OTP are required.' })

    const otpRecord = await verifyAndGetOtp(email, 'register', otp)
    if (!otpRecord)
      return res.status(400).json({ message: 'Invalid or expired OTP.' })

    await markOtpUsed(otpRecord.id)
    const user = await markUserVerified(email)

    // Issue JWT immediately — user goes straight to onboarding
    const token = signToken({ id: user.id, email: user.email })

    return res.status(200).json({
      message: 'Email verified successfully.',
      token,
      user: {
        id:                  user.id,
        name:                user.name,
        email:               user.email,
        onboarding_complete: user.onboarding_complete,
      },
    })
  } catch (err) {
    console.error('[verifyRegisterOtp]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ── POST /api/otp/verify-reset ─────────────────────────────────
// Accepts: { email, otp }
// Only validates the OTP — does NOT consume it yet.
// Consumption happens inside resetPassword after the new password is set.
export const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body
    if (!email || !otp)
      return res.status(400).json({ message: 'Email and OTP are required.' })

    const otpRecord = await verifyAndGetOtp(email, 'reset_password', otp)
    if (!otpRecord)
      return res.status(400).json({ message: 'Invalid or expired OTP.' })

    // OTP intentionally not marked as used here.
    // The actual consumption happens in authController.resetPassword
    // which re-verifies and marks it used atomically.
    return res.status(200).json({ message: 'OTP verified. You may now reset your password.' })
  } catch (err) {
    console.error('[verifyResetOtp]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ── POST /api/otp/resend ──────────────────────────────────────
// Accepts: { email, purpose }  ('register' | 'reset_password')
// Invalidates old OTPs and sends a fresh one.
import { invalidatePreviousOtps, createOtp } from '../models/otpModel.js'
import { findUserByEmail }                   from '../models/userModel.js'
import { generateOtp, getOtpExpiry }         from '../utils/generateOtp.js'
import { sendOtpEmail }                      from '../utils/sendEmail.js'

export const resendOtp = async (req, res) => {
  try {
    const { email, purpose } = req.body
    if (!email || !['register', 'reset_password'].includes(purpose))
      return res.status(400).json({ message: 'Email and a valid purpose are required.' })

    const user = await findUserByEmail(email)
    if (!user)
      return res.status(200).json({ message: 'If that email exists, a new OTP has been sent.' })

    // Don't resend register OTPs to already-verified users
    if (purpose === 'register' && user.is_verified)
      return res.status(400).json({ message: 'Email is already verified.' })

    await invalidatePreviousOtps(email, purpose)
    const otp    = generateOtp()
    const expiry = getOtpExpiry(10)
    await createOtp({ email, otpCode: otp, purpose, expiresAt: expiry })
    await sendOtpEmail({ to: email, otp, purpose })

    return res.status(200).json({ message: 'A new OTP has been sent to your email.' })
  } catch (err) {
    console.error('[resendOtp]', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}
