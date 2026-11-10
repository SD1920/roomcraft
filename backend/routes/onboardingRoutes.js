import { Router }             from 'express'
import { completeOnboarding } from '../controllers/onboardingController.js'
import { requireAuth }        from '../middleware/authMiddleware.js'

const router = Router()

// POST /api/onboarding
// Protected — JWT required. Called from Onboarding.jsx on final step.
router.post('/', requireAuth, completeOnboarding)

export default router
