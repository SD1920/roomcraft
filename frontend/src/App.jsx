// src/App.jsx — UPDATED
// Wraps everything in AuthProvider.
// Adds 4 new auth routes and protects dashboard/editor/profile.

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider }     from './context/AuthContext'
import ProtectedRoute       from './components/ProtectedRoute'

// Public pages
import Landing              from './pages/Landing'
import Register             from './pages/Register'
import Login                from './pages/Login'
import VerifyRegisterOtp    from './pages/VerifyRegisterOtp'
import ForgotPassword       from './pages/ForgotPassword'
import VerifyResetOtp       from './pages/VerifyResetOtp'
import ResetPassword        from './pages/ResetPassword'

// Protected pages
import Onboarding           from './pages/Onboarding'
import Dashboard            from './pages/Dashboard'
import Editor               from './pages/Editor'
import Profile              from './pages/Profile'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>

          {/* ── Public ──────────────────────────────────── */}
          <Route path="/"                     element={<Landing />} />
          <Route path="/register"             element={<Register />} />
          <Route path="/login"                element={<Login />} />
          <Route path="/verify-register-otp"  element={<VerifyRegisterOtp />} />
          <Route path="/forgot-password"      element={<ForgotPassword />} />
          <Route path="/verify-reset-otp"     element={<VerifyResetOtp />} />
          <Route path="/reset-password"       element={<ResetPassword />} />

          {/* ── Protected ────────────────────────────────
              ProtectedRoute redirects to /login if no JWT.
              After login the user is sent back here.       */}
          <Route path="/onboarding" element={
            <ProtectedRoute><Onboarding /></ProtectedRoute>
          } />
          <Route path="/dashboard" element={
            <ProtectedRoute><Dashboard /></ProtectedRoute>
          } />
          <Route path="/editor" element={
            <ProtectedRoute><Editor /></ProtectedRoute>
          } />
          <Route path="/profile" element={
            <ProtectedRoute><Profile /></ProtectedRoute>
          } />

          {/* ── 404 ──────────────────────────────────────── */}
          <Route path="*" element={
            <div className="min-h-screen bg-bg text-text flex items-center justify-center">
              <div className="text-center">
                <p className="text-4xl font-bold mb-3">404</p>
                <p className="opacity-60 mb-6">Page not found.</p>
                <a href="/" className="text-accent font-medium hover:underline">Go home</a>
              </div>
            </div>
          } />

        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
