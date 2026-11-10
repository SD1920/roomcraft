import express        from 'express'
import cors           from 'cors'
import path           from 'path'
import { fileURLToPath } from 'url'
import { env }        from './config/env.js'
import { globalLimiter, detectLimiter } from './middleware/rateLimiter.js'
import { ensureSchema } from './config/db.js'
import { handleDetect } from '../frontend/server/gemini_detect.js'

import authRoutes        from './routes/authRoutes.js'
import otpRoutes         from './routes/otpRoutes.js'
import profileRoutes     from './routes/profileRoutes.js'
import onboardingRoutes  from './routes/onboardingRoutes.js'
import designRoutes from './routes/designRoutes.js'
import assistantRoutes from './routes/assistantRoutes.js'
              

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app       = express()

// behind Vercel's proxy: the real client IP is in X-Forwarded-For (rate limits)
app.set('trust proxy', 1)

// ── CORS ──────────────────────────────────────────────────────
// Allow only the configured frontend origin in production.
// In development, also allow localhost:5173 (Vite default).
const allowedOrigins = new Set([
  env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:3000',
])

// The deployed site serves the app and the API from one address, so a
// request from the page's own host is always allowed.
const sameHost = (origin, host) => { try { return new URL(origin).host === host } catch { return false } }
app.use(cors((req, cb) => {
  const origin = req.header('Origin')
  // Allow requests with no origin (curl, Postman, mobile apps)
  if (!origin || allowedOrigins.has(origin) || sameHost(origin, req.headers.host)) return cb(null, { origin: true, credentials: true })
  cb(new Error(`CORS: Origin ${origin} is not allowed`))
}))

// ── Scanner "Guess from camera": one camera frame -> Gemini (key stays here)
// Before the 1 MB JSON limit below: a camera frame can be a few MB.
app.post('/api/detect', detectLimiter, express.json({ limit: '4mb' }), async (req, res) => {
  try {
    res.json(await handleDetect(req.body, { apiKey: process.env.GEMINI_API_KEY }))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))       // JSON body cap
app.use(express.urlencoded({ extended: false }))

// ── Static files — serve uploaded avatars ─────────────────────
// In production, replace this with S3/Cloudinary and remove this line.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ── Global rate limiter ────────────────────────────────────────
app.use(globalLimiter)

// ── Health check (Render.com / Railway ping) ───────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

// ── Make sure the tables exist (fresh database) ────────────────
app.use('/api', (_req, _res, next) => { ensureSchema().then(() => next(), next) })

// ── API routes ─────────────────────────────────────────────────
app.use('/api/auth',        authRoutes)
app.use('/api/otp',         otpRoutes)
app.use('/api/profile',     profileRoutes)
app.use('/api/onboarding',  onboardingRoutes)
app.use('/api/designs', designRoutes)
app.use('/api/assistant', assistantRoutes)
// ── 404 handler ────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }))

// ── Global error handler ───────────────────────────────────────
// Catches anything thrown with next(err) or unhandled sync errors.
// Never expose stack traces in production.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err)

  // CORS errors from the CORS middleware above
  if (err.message?.startsWith('CORS'))
    return res.status(403).json({ message: err.message })

  // Multer errors bubble up here too
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ message: 'File too large.' })

  const status  = err.status || err.statusCode || 500
  const message = env.isDev ? err.message : 'Something went wrong.'
  return res.status(status).json({ message })
})

export default app
