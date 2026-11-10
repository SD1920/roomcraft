import { Router } from 'express'
import {
  verifyRegisterOtp,
  verifyResetOtp,
  resendOtp,
} from '../controllers/otpController.js'
import { otpVerifyLimiter, otpSendLimiter } from '../middleware/rateLimiter.js'

const router = Router()

// POST /api/otp/verify-register
router.post('/verify-register', otpVerifyLimiter, verifyRegisterOtp)

// POST /api/otp/verify-reset
router.post('/verify-reset', otpVerifyLimiter, verifyResetOtp)

// POST /api/otp/resend
router.post('/resend', otpSendLimiter, resendOtp)

export default router
