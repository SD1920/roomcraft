// src/pages/Register.jsx — UPDATED
// Calls /api/auth/register → navigates to /verify-register-otp with email in state

import { useState }                from 'react'
import { Link, useNavigate }       from 'react-router-dom'
import api from '../api/api'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [form,    setForm]    = useState({ name: '', email: '', password: '' })
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

    // Basic client-side check (backend validates too)
    if (form.name.trim().length < 2)
      return setError('Name must be at least 2 characters.')
    if (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[0-9]/.test(form.password))
      return setError('Password must be at least 8 characters and include an uppercase letter and a number.')

    setLoading(true)
    try {
      const res = await api.post('/api/auth/register', {
        name:     form.name.trim(),
        email:    form.email.trim(),
        password: form.password,
      })
      // live demo: no email code, the account is ready straight away
      if (res.data?.token) {
        login(res.data.token, res.data.user)
        navigate('/onboarding', { replace: true })
        return
      }
      // Navigate to OTP page, pass email so the user knows where the code was sent
      navigate('/verify-register-otp', { state: { email: form.email.trim() } })
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <Link to="/" className="text-xl font-bold tracking-tight">roomcraft</Link>
          <h1 className="text-2xl font-bold mt-4">Create your account</h1>
          <p className="text-sm opacity-70 mt-1">Start designing your room in minutes.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              placeholder="Your name"
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

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
            <label className="text-sm font-medium">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                name="password"
                value={form.password}
                onChange={handleChange}
                required
                placeholder="Min 8 chars, 1 uppercase, 1 number"
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
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-sm text-center opacity-70 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">Log in</Link>
        </p>

      </div>
    </div>
  )
}
