// src/pages/VerifyResetOtp.jsx
// Gets email from location.state (passed by ForgotPassword).
// On success → navigate to /reset-password with { email, otp } in state.

import { useState }               from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api        from '../api/api'
import OtpInput   from '../components/OtpInput'

export default function VerifyResetOtp() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const email     = location.state?.email || ''

  const [otp,       setOtp]       = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [resent,    setResent]    = useState(false)
  const [resending, setResending] = useState(false)

  if (!email) {
    return (
      <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
        <div className="text-center">
          <p className="opacity-70 mb-4">Session expired. Please start again.</p>
          <Link to="/forgot-password" className="text-accent font-medium hover:underline">
            Forgot password
          </Link>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (otp.length < 5) { setError('Please enter the 5-digit OTP.'); return }
    setError('')
    setLoading(true)
    try {
      await api.post('/api/otp/verify-reset', { email, otp })
      // Pass email + otp to reset page — needed to call /api/auth/reset-password
      navigate('/reset-password', { state: { email, otp }, replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired OTP. Please try again.')
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setError('')
    setResent(false)
    try {
      await api.post('/api/otp/resend', { email, purpose: 'reset_password' })
      setResent(true)
      setOtp('')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resend. Please try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <Link to="/" className="text-xl font-bold tracking-tight">roomcraft</Link>
          <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center
                          justify-center text-2xl mx-auto mt-5 mb-4">
            🔐
          </div>
          <h1 className="text-2xl font-bold">Enter reset code</h1>
          <p className="text-sm opacity-70 mt-2">
            We sent a 5-digit code to
          </p>
          <p className="text-sm font-semibold mt-0.5">{email}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">

          <OtpInput value={otp} onChange={setOtp} disabled={loading} />

          {error && (
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-2.5 text-center">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          {resent && (
            <div className="rounded-lg border border-green-400/40 bg-green-500/10 px-4 py-2.5 text-center">
              <p className="text-xs text-green-600 dark:text-green-400">New code sent to your email.</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || otp.length < 5}
            className="px-4 py-3 rounded-lg bg-accent text-white font-medium
                       hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying…' : 'Verify code'}
          </button>
        </form>

        <div className="text-center mt-6">
          <p className="text-sm opacity-70">
            Didn't receive it?{' '}
            <button
              onClick={handleResend}
              disabled={resending}
              className="text-accent font-medium hover:underline disabled:opacity-50"
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          </p>
          <p className="text-xs opacity-50 mt-2">OTP expires in 10 minutes</p>
        </div>

        <p className="text-sm text-center opacity-60 mt-4">
          <Link to="/forgot-password" className="text-accent font-medium hover:underline">
            ← Back
          </Link>
        </p>

      </div>
    </div>
  )
}
