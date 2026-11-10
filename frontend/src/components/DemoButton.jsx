// "Try the demo": a fresh, private sample account with a few saved designs, so a
// visitor can use the whole app without signing up. Only on the live demo site
// (VITE_DEMO_MODE=true in .env.production; the backend needs DEMO_MODE=true).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/api'
import { useAuth } from '../context/AuthContext'

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

export default function DemoButton({ className = '' }) {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/api/auth/demo')
      login(res.data.token, res.data.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start the demo. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <button type="button" onClick={start} disabled={busy}
        className={`px-6 py-3 rounded-lg border-2 border-accent text-accent font-medium hover:bg-accent/10 transition disabled:opacity-50 ${className}`}>
        {busy ? 'Starting the demo…' : '✨ Try the demo, no sign-up'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  )
}
