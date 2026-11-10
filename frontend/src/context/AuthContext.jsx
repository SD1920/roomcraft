// src/context/AuthContext.jsx
// Global auth state — token + user, persisted in localStorage.
// Wrap your entire app in <AuthProvider> (see App.jsx).
// Consume anywhere with: const { user, login, logout } = useAuth()

import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

const TOKEN_KEY = 'rc_token'
const USER_KEY  = 'rc_user'

const readLS = (key) => {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || null)
  const [user,  setUser]  = useState(() => readLS(USER_KEY))

  // Called after successful login OR after OTP verification (register flow)
  const login = (newToken, newUser) => {
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY, JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }

  // Merge partial update into existing user (e.g. after profile save)
  const updateUser = (partial) => {
    const merged = { ...user, ...partial }
    localStorage.setItem(USER_KEY, JSON.stringify(merged))
    setUser(merged)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout, updateUser, isLoggedIn: !!token }}>
      {children}
    </AuthContext.Provider>
  )
}

// Convenience hook — throws if used outside AuthProvider
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
