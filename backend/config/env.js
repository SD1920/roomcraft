import 'dotenv/config'

const required = ['DATABASE_URL', 'JWT_SECRET']

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`FATAL: Missing required environment variable: ${key}`)
  }
}

export const env = {
  DATABASE_URL:    process.env.DATABASE_URL,
  JWT_SECRET:      process.env.JWT_SECRET,
  JWT_EXPIRES_IN:  process.env.JWT_EXPIRES_IN  || '7d',
  RESEND_API_KEY:  process.env.RESEND_API_KEY || '',
  // live demo: sign-up needs no email code, and the 'Try the demo' login is on
  DEMO_MODE:       process.env.DEMO_MODE === 'true',
  PORT:            parseInt(process.env.PORT)   || 5000,
  NODE_ENV:        process.env.NODE_ENV         || 'development',
  CLIENT_URL:      process.env.CLIENT_URL       || 'http://localhost:5173',
  MAX_AVATAR_SIZE: parseInt(process.env.MAX_AVATAR_SIZE) || 300 * 1024,   // photos are stored in the database
  isDev:           process.env.NODE_ENV !== 'production',
}
