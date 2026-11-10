import { Router } from 'express'
import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  demoLogin,
} from '../controllers/authController.js'
import {
  loginLimiter,
  forgotPasswordLimiter,
  otpSendLimiter,
} from '../middleware/rateLimiter.js'

const router = Router()

// POST /api/auth/register
// otpSendLimiter applied because register triggers an OTP email
router.post('/register', otpSendLimiter, registerUser)

// POST /api/auth/login
router.post('/login', loginLimiter, loginUser)

router.post('/demo', loginLimiter, demoLogin)

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword)

// POST /api/auth/reset-password
router.post('/reset-password', resetPassword)

export default router
