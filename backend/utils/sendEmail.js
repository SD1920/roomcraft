import { Resend } from 'resend'
import { env } from '../config/env.js'

// created only when a key is set: the live demo runs without email (DEMO_MODE)
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

const VALID_EMAIL_RE = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/

const assertSafeEmail = (email) => {
  if (!email || typeof email !== 'string') throw new Error('Invalid recipient email.')
  if (/[\r\n]/.test(email)) throw new Error('Email contains illegal characters.')
  if (!VALID_EMAIL_RE.test(email)) throw new Error('Email format is invalid.')
}

const assertSafeOtp = (otp) => {
  if (!/^\d{5}$/.test(otp)) throw new Error('OTP format is invalid.')
}

export const sendOtpEmail = async ({ to, otp, purpose }) => {
  assertSafeEmail(to)
  assertSafeOtp(otp)

  const isRegister = purpose === 'register'

  const subject = isRegister
    ? 'Your roomcraft verification code'
    : 'Reset your roomcraft password'

  // Plain text fallback — important for deliverability
  const text = isRegister
    ? `Your roomcraft verification OTP is ${otp}. It expires in 10 minutes. Do not share this with anyone.`
    : `Your password reset OTP is ${otp}. It expires in 10 minutes. Do not share this with anyone.`

  // Simple HTML email — no external images, no tracking pixels
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="margin:0 0 8px;font-size:22px;color:#111">
        ${isRegister ? 'Verify your email' : 'Reset your password'}
      </h2>
      <p style="color:#555;margin:0 0 24px">
        ${isRegister
          ? 'Enter this code to complete your roomcraft registration.'
          : 'Enter this code to reset your roomcraft password.'}
      </p>
      <div style="background:#f5f5f5;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#111">${otp}</span>
      </div>
      <p style="color:#888;font-size:13px;margin:0">
        This code expires in <strong>10 minutes</strong>.
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `

  try {
    // Resend reports failures in the result instead of throwing
    if (!resend) throw new Error('No email service configured (RESEND_API_KEY)')
    const { error } = await resend.emails.send({
      from: 'roomcraft <onboarding@resend.dev>',
      to,
      subject,
      text,
      html,
    })
    if (error) throw new Error(error.message || 'Resend refused the email')
  } catch (err) {
    console.error('[sendEmail] Resend error:', err.message)
    // Local development only: Resend's test sender can only email the
    // account owner, so print the code here instead of failing sign-up.
    if (env.isDev) {
      console.log(`[dev] Email could not be sent. The ${purpose} code for ${to} is: ${otp}`)
      return
    }
    throw new Error('Failed to send email. Please try again.')
  }
}
