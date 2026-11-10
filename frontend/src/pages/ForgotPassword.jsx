// src/pages/ForgotPassword.jsx
// User enters their email → backend sends OTP → navigate to VerifyResetOtp

import { useState }              from 'react'
import { Link, useNavigate }     from 'react-router-dom'
import api                       from '../api/api'

export default function ForgotPassword() {
  const navigate       = useNavigate()
  const [email,    setEmail]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email) { setError('Please enter your email address.'); return }
    setError('')
    setLoading(true)
    try {
      await api.post('/api/auth/forgot-password', { email })
      // Always navigate even if the email doesn't exist (backend returns 200 either way
      // to prevent user enumeration — we just show the OTP screen)
      navigate('/verify-reset-otp', { state: { email } })
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
          <h1 className="text-2xl font-bold mt-4">Forgot password?</h1>
          <p className="text-sm opacity-70 mt-1">
            Enter your email and we'll send you a reset code.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
              required
              placeholder="you@example.com"
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         focus:outline-none focus:ring-2 focus:ring-accent"
            />
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
            {loading ? 'Sending code…' : 'Send reset code'}
          </button>
        </form>

        <p className="text-sm text-center opacity-70 mt-6">
          Remembered it?{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">
            Back to login
          </Link>
        </p>

      </div>
    </div>
  )
}
