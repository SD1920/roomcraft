// src/pages/Login.jsx — UPDATED
// Calls /api/auth/login → stores JWT in AuthContext
// → if onboarding_complete === false → /onboarding
// → else → /dashboard (or the page they were trying to reach)

import { useState }                      from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api          from '../api/api'
import { useAuth }  from '../context/AuthContext'
import DemoButton, { DEMO_MODE } from '../components/DemoButton'

export default function Login() {
  const navigate     = useNavigate()
  const location     = useLocation()
  const { login }    = useAuth()

  // If user was redirected here from a protected route, go back there after login
  const from = location.state?.from?.pathname || '/dashboard'

  // Check for success message passed from ResetPassword page
  const successMessage = location.state?.successMessage || ''

  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [showPw,  setShowPw]  = useState(false)

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res  = await api.post('/api/auth/login', {
        email:    form.email.trim(),
        password: form.password,
      })
      const { token, user } = res.data

      // Store in AuthContext + localStorage
      login(token, user)

      // New users who haven't done onboarding yet → send to onboarding first
      if (!user.onboarding_complete) {
        navigate('/onboarding', { replace: true })
      } else {
        navigate(from, { replace: true })
      }
    } catch (err) {
      const msg    = err.response?.data?.message || 'Something went wrong. Please try again.'
      const action = err.response?.data?.action

      // Backend tells us they need to verify their email still
      if (action === 'verify-email') {
        navigate('/verify-register-otp', {
          state: { email: form.email.trim() },
        })
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <Link to="/" className="text-xl font-bold tracking-tight">roomcraft</Link>
          <h1 className="text-2xl font-bold mt-4">Welcome back</h1>
          <p className="text-sm opacity-70 mt-1">Log in to pick up where you left off.</p>
        </div>

        {/* Success message from password reset */}
        {successMessage && (
          <div className="mb-4 rounded-lg border border-green-400/40 bg-green-500/10 px-4 py-2.5">
            <p className="text-xs text-green-600 dark:text-green-400">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
              placeholder="you@example.com"
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Password</label>
              {!DEMO_MODE && (
                <Link
                  to="/forgot-password"
                  className="text-xs text-accent hover:underline"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                name="password"
                value={form.password}
                onChange={handleChange}
                required
                placeholder="Your password"
                className="w-full px-4 py-2.5 pr-11 rounded-lg border border-border bg-surface text-text
                           focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lg opacity-50 hover:opacity-80"
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-2.5">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 px-4 py-3 rounded-lg bg-accent text-white font-medium
                       hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        {DEMO_MODE && (
          <div className="mt-5 flex flex-col items-stretch gap-2">
            <p className="text-xs text-center opacity-60">or look around first</p>
            <DemoButton className="w-full" />
          </div>
        )}

        <p className="text-sm text-center opacity-70 mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-accent font-medium hover:underline">Sign up</Link>
        </p>

      </div>
    </div>
  )
}
