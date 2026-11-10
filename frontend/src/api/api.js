// src/api/api.js
// Axios instance used across all frontend pages.
// Automatically attaches the JWT from localStorage to every request.
// On 401, clears storage and redirects to /login.

import axios from 'axios'

const api = axios.create({
  // empty: same origin, through the dev server's /api proxy (vite.config.js),
  // which is what lets a phone on Wi-Fi reach the backend
  baseURL: import.meta.env.VITE_API_URL ?? '',
  timeout: 15_000,
})

// Attach token from localStorage before every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rc_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Global 401 handler — token expired or invalid
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('rc_token')
      localStorage.removeItem('rc_user')
      // Hard redirect so AuthContext state also resets
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api
