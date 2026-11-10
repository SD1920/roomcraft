import jwt from 'jsonwebtoken'
import { verifyToken } from '../utils/jwt.js'

const extractPayload = (decoded) => ({ id: decoded.id, email: decoded.email })

const handleJwtError = (err, res) => {
  if (err instanceof jwt.TokenExpiredError)
    return res.status(401).json({ message: 'Session expired. Please log in again.' })
  if (err instanceof jwt.JsonWebTokenError)
    return res.status(401).json({ message: 'Invalid token.' })
  return res.status(401).json({ message: 'Authentication failed.' })
}

// Protects routes — requires "Authorization: Bearer <token>"
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer '))
    return res.status(401).json({ message: 'No token provided.' })

  const token = authHeader.split(' ')[1]
  if (!token || token.split('.').length !== 3)
    return res.status(401).json({ message: 'Malformed token.' })

  try {
    req.user = extractPayload(verifyToken(token))
    next()
  } catch (err) {
    return handleJwtError(err, res)
  }
}

// For routes usable by both guests and logged-in users
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]
    if (token && token.split('.').length === 3) {
      try {
        req.user = extractPayload(verifyToken(token))
      } catch {
        // Invalid token → treat as guest, don't block
      }
    }
  }
  next()
}
