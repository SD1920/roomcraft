// src/components/ProtectedRoute.jsx
// Wrap any route that requires login:
//   <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { isLoggedIn } = useAuth()
  const location       = useLocation()

  if (!isLoggedIn) {
    // Preserve where they were trying to go — redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
