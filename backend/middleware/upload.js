import multer from 'multer'
import { env } from '../config/env.js'


// ── Disk storage ──────────────────────────────────────────────
// File name: userId_timestamp.ext — prevents name collisions and
// also makes it easy to find all avatars for a given user.
// Kept in memory and saved in the database as a data URL: the hosting has no
// permanent disk. The page shrinks photos to 256 px before uploading.
const storage = multer.memoryStorage()

// ── File filter — images only ──────────────────────────────────
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only JPEG, PNG, WebP and GIF images are allowed.'))
  }
}

// ── Export configured multer instance ────────────────────────
export const avatarUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.MAX_AVATAR_SIZE },
})

// ── Error handler middleware for multer errors ────────────────
// Call this after your upload route to catch size/type errors cleanly.
export const handleUploadError = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `Avatar must be under ${env.MAX_AVATAR_SIZE / 1024 / 1024} MB.` })
    }
    return res.status(400).json({ message: err.message })
  }
  next(err)
}
