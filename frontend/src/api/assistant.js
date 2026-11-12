// src/api/assistant.js — the AI room assistant (backend /api/assistant)
import api from './api'
import { assistantCatalog } from '../utils/promptRoom'

// the backend answers within its 45 s budget (many models raced, then quick
// mode); the serverless limit is 60 s
const AI_TIMEOUT_MS = 65_000

const errorText = (err) =>
  err?.response?.data?.message ||
  (err?.code === 'ECONNABORTED' ? 'The AI took too long to answer. Please try again.' : 'Could not reach the AI. Please try again.')

/** A typed description -> a room spec (see backend/controllers/assistantController.js) */
export async function planRoomFromText(prompt, history = []) {
  try {
    const res = await api.post('/api/assistant/plan', { prompt, history, catalog: assistantCatalog() }, { timeout: AI_TIMEOUT_MS })
    return res.data.spec
  } catch (err) {
    throw new Error(errorText(err))
  }
}

/** A message about the open room -> { reply, actions } */
export async function chatAboutRoom(message, history, room) {
  try {
    const res = await api.post('/api/assistant/chat', { message, history, room, catalog: assistantCatalog() }, { timeout: AI_TIMEOUT_MS })
    return res.data
  } catch (err) {
    throw new Error(errorText(err))
  }
}
