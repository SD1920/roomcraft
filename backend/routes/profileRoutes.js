import { Router } from 'express'
import {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
} from '../controllers/profileController.js'
import { requireAuth }                    from '../middleware/authMiddleware.js'
import { avatarUpload, handleUploadError } from '../middleware/upload.js'
import { avatarUploadLimiter }            from '../middleware/rateLimiter.js'

const router = Router()

// All profile routes require a valid JWT
router.use(requireAuth)

// GET  /api/profile          → get logged-in user's profile
router.get('/', getProfile)

// PUT  /api/profile          → update name and/or profession
router.put('/', updateProfile)

// PUT  /api/profile/password → change password (requires current password)
router.put('/password', changePassword)

// POST /api/profile/avatar   → upload a new profile picture
// Order: rate limiter → multer → controller → multer error handler
router.post(
  '/avatar',
  avatarUploadLimiter,
  avatarUpload.single('avatar'),   // field name must match frontend FormData key
  uploadAvatar,
  handleUploadError,
)

export default router
