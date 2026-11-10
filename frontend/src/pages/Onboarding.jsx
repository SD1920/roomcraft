// src/pages/Onboarding.jsx — UPDATED
// Calls /api/onboarding on final step → updates user context → navigate to /dashboard

import { useState }          from 'react'
import { useNavigate }       from 'react-router-dom'
import api          from '../api/api'
import { useAuth }  from '../context/AuthContext'

export default function Onboarding() {
  const navigate         = useNavigate()
  const { updateUser }   = useAuth()

  const [step,    setStep]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [answers, setAnswers] = useState({
    source:        '',
    firstTime:     '',
    wantsToShape:  '',
  })

  const canProceed = () => {
    if (step === 1) return answers.source !== ''
    if (step === 2) return answers.firstTime !== ''
    if (step === 3) return answers.wantsToShape !== ''
    return false
  }

  const handleNext = async () => {
    if (step < 3) {
      setStep(step + 1)
      return
    }

    // Final step — submit to backend
    setError('')
    setLoading(true)
    try {
      await api.post('/api/onboarding', {
        source:       answers.source,
        firstTime:    answers.firstTime,
        wantsToShape: answers.wantsToShape,
      })
      // Mark onboarding complete in local user context so
      // Login won't redirect here again on next session
      updateUser({ onboarding_complete: true })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const OptionButton = ({ value, current, field, label }) => (
    <button
      type="button"
      onClick={() => { setAnswers({ ...answers, [field]: value }); setError('') }}
      className={`px-4 py-3 rounded-lg border text-left transition ${
        current === value
          ? 'border-accent bg-surface text-text'
          : 'border-border hover:bg-surface text-text'
      }`}
    >
      {label || value}
    </button>
  )

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center px-6">
      <div className="w-full max-w-md">

        {/* Progress dots */}
        <div className="flex gap-2 justify-center mb-8">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-all ${
                n === step ? 'w-8 bg-accent' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <h1 className="text-xl font-bold text-center">Where did you hear about us?</h1>
            <div className="flex flex-col gap-2">
              {['Instagram', 'A friend', 'College/campus', 'LinkedIn', 'Other'].map((opt) => (
                <OptionButton
                  key={opt} value={opt} current={answers.source} field="source" />
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <h1 className="text-xl font-bold text-center">
              Is this your first time using a room-design app?
            </h1>
            <div className="flex flex-col gap-2">
              {["Yes, first time", "No, I've used similar apps"].map((opt) => (
                <OptionButton
                  key={opt} value={opt} current={answers.firstTime} field="firstTime" />
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
            <h1 className="text-xl font-bold text-center">
              Want to help shape future features?
            </h1>
            <p className="text-sm opacity-70 text-center -mt-2">
              We'll occasionally ask for feedback on what to build next.
            </p>
            <div className="flex flex-col gap-2">
              {['Yes, count me in', 'No thanks'].map((opt) => (
                <OptionButton
                  key={opt} value={opt} current={answers.wantsToShape} field="wantsToShape" />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-2.5">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}

        <button
          onClick={handleNext}
          disabled={!canProceed() || loading}
          className="w-full mt-8 px-4 py-3 rounded-lg bg-accent text-white font-medium
                     hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving…' : step < 3 ? 'Continue' : 'Finish'}
        </button>

      </div>
    </div>
  )
}
