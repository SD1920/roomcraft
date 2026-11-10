// routes/assistantRoutes.js
import { Router } from 'express'
import { planRoom, chatRoom } from '../controllers/assistantController.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { assistantLimiter } from '../middleware/rateLimiter.js'

const router = Router()

// signed-in users only: every call spends the Gemini key's quota
router.use(requireAuth, assistantLimiter)

// POST /api/assistant/plan → a typed description becomes a room spec
router.post('/plan', planRoom)

// POST /api/assistant/chat → suggestions for the open room, with one-tap actions
router.post('/chat', chatRoom)

export default router
