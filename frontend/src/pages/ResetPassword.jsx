// src/pages/ResetPassword.jsx
// Gets { email, otp } from location.state (passed by VerifyResetOtp).
// Calls /api/auth/reset-password → on success navigate to /login.

import { useState }                      from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../api/api'

export default function ResetPassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const { email, otp } = location.state || {}

  const [form,    setForm]    = useState({ newPassword: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [show,    setShow]    = useState({ new: false, confirm: false })

  if (!email || !otp) {
    return (
      <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
        <div className="text-center">
          <p className="opacity-70 mb-4">Session expired. Please start the reset flow again.</p>
          <Link to="/forgot-password" className="text-accent font-medium hover:underline">
            Forgot password
          </Link>
        </div>
      </div>
    )
  }

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (form.newPassword.length < 8)
      return setError('Password must be at least 8 characters.')
    if (!/[A-Z]/.test(form.newPassword))
      return setError('Password must include at least one uppercase letter.')
    if (!/[0-9]/.test(form.newPassword))
      return setError('Password must include at least one number.')
    if (form.newPassword !== form.confirm)
      return setError('Passwords do not match.')

    setLoading(true)
    try {
      await api.post('/api/auth/reset-password', {
        email,
        otp,
        newPassword: form.newPassword,
      })
      navigate('/login', {
        replace: true,
        state: { successMessage: 'Password reset successfully. You can now log in.' },
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const toggleShow = (field) => setShow((prev) => ({ ...prev, [field]: !prev[field] }))

  const strength = (() => {
    const p = form.newPassword
    if (!p) return null
    let score = 0
    if (p.length >= 8)   score++
    if (/[A-Z]/.test(p)) score++
    if (/[0-9]/.test(p)) score++
    if (/[^A-Za-z0-9]/.test(p)) score++
    if (score <= 1) return { label: 'Weak',   color: 'bg-red-500',    w: 'w-1/4' }
    if (score === 2) return { label: 'Fair',   color: 'bg-yellow-400', w: 'w-2/4' }
    if (score === 3) return { label: 'Good',   color: 'bg-blue-500',   w: 'w-3/4' }
    return               { label: 'Strong', color: 'bg-green-500',  w: 'w-full' }
  })()

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <Link to="/" className="text-xl font-bold tracking-tight">roomcraft</Link>
          <h1 className="text-2xl font-bold mt-4">Set new password</h1>
          <p className="text-sm opacity-70 mt-1">
            Choose a strong password for <span className="font-medium">{email}</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* New password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">New password</label>
            <div className="relative">
              <input
                type={show.new ? 'text' : 'password'}
                name="newPassword"
                value={form.newPassword}
                onChange={handleChange}
                required
                placeholder="At least 8 chars, 1 uppercase, 1 number"
                className="w-full px-4 py-2.5 pr-11 rounded-lg border border-border bg-surface text-text
                           focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => toggleShow('new')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lg opacity-50 hover:opacity-80"
              >
                {show.new ? '🙈' : '👁'}
              </button>
            </div>
            {/* Strength bar */}
            {strength && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${strength.color} ${strength.w}`} />
                </div>
                <span className="text-[11px] opacity-60">{strength.label}</span>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Confirm password</label>
            <div className="relative">
              <input
                type={show.confirm ? 'text' : 'password'}
                name="confirm"
                value={form.confirm}
                onChange={handleChange}
                required
                placeholder="Repeat your new password"
                className="w-full px-4 py-2.5 pr-11 rounded-lg border border-border bg-surface text-text
                           focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => toggleShow('confirm')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-lg opacity-50 hover:opacity-80"
              >
                {show.confirm ? '🙈' : '👁'}
              </button>
            </div>
            {/* Match indicator */}
            {form.confirm && (
              <p className={`text-[11px] mt-0.5 ${form.newPassword === form.confirm ? 'text-green-500' : 'text-red-500'}`}>
                {form.newPassword === form.confirm ? '✓ Passwords match' : '✗ Passwords do not match'}
              </p>
            )}
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
            {loading ? 'Updating…' : 'Reset password'}
          </button>
        </form>

      </div>
    </div>
  )
}
