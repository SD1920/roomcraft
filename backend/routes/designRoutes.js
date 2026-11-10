// routes/designRoutes.js
import { Router }     from 'express'
import {
  saveDesign,
  getDesigns,
  getDesign,
  editDesign,
  removeDesign,
} from '../controllers/designController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

const router = Router()

// All design routes require a valid JWT
router.use(requireAuth)

// POST   /api/designs          → save a new design
router.post('/',     saveDesign)

// GET    /api/designs          → list all user's designs (lightweight)
router.get('/',      getDesigns)

// GET    /api/designs/:id      → get one design with full furniture + openings
router.get('/:id',   getDesign)

// PUT    /api/designs/:id      → update a design (any fields)
router.put('/:id',   editDesign)

// DELETE /api/designs/:id      → delete a design permanently
router.delete('/:id', removeDesign)

export default router
