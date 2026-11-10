import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
  throw new Error(
    'FATAL: JWT_SECRET is missing or too short (need ≥ 32 chars). ' +
    'Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"',
  )
}

const ALGORITHM = 'HS256'

export const signToken = (payload) =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: ALGORITHM,
  })

export const verifyToken = (token) =>
  jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] })
