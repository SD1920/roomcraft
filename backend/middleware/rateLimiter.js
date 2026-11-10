import rateLimit from 'express-rate-limit'

const byIp         = (req) => req.ip || req.socket?.remoteAddress || 'unknown'
const byIpAndEmail = (req) => {
  const email = (req.body?.email || '').toLowerCase().trim()
  return `${byIp(req)}::${email}`
}

const make = (opts) =>
  rateLimit({ standardHeaders: true, legacyHeaders: false, ...opts })

export const otpSendLimiter = make({
  windowMs: 15 * 60 * 1000, max: 5,
  keyGenerator: byIp,
  message: { message: 'Too many OTP requests. Try again in a few minutes.' },
})

export const otpVerifyLimiter = make({
  windowMs: 15 * 60 * 1000, max: 10,
  keyGenerator: byIpAndEmail,
  message: { message: 'Too many verification attempts. Please wait before trying again.' },
})

export const loginLimiter = make({
  windowMs: 15 * 60 * 1000, max: 10,
  keyGenerator: byIpAndEmail,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
})

export const forgotPasswordLimiter = make({
  windowMs: 15 * 60 * 1000, max: 5,
  keyGenerator: byIpAndEmail,
  message: { message: 'Too many password reset requests. Please try again later.' },
})

export const avatarUploadLimiter = make({
  windowMs: 60 * 60 * 1000, max: 10,
  keyGenerator: byIp,
  message: { message: 'Too many avatar uploads. Please try again later.' },
})

export const detectLimiter = make({
  windowMs: 15 * 60 * 1000, max: 30,
  message: { message: 'Too many camera guesses. Please wait a few minutes.' },
})

export const globalLimiter = make({
  windowMs: 15 * 60 * 1000, max: 200,
  keyGenerator: byIp,
  message: { message: 'Too many requests. Please slow down.' },
  skip: (req) => req.path === '/health',
})

// AI assistant: each call uses the Gemini key's quota
export const assistantLimiter = make({
  windowMs: 60 * 1000, max: 12,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : byIp(req)),
  message: { message: 'Too many AI requests. Please wait a minute.' },
})
