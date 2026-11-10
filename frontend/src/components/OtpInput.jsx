// src/components/OtpInput.jsx
// Reusable 5-digit OTP input.
// Props:
//   value    → string (up to 5 digits)
//   onChange → (newValue: string) => void
//   disabled → bool

import { useRef } from 'react'

export default function OtpInput({ value = '', onChange, disabled = false }) {
  const inputs = useRef([])
  // Always work with a fixed 5-slot array
  const digits = value.padEnd(5, '').split('').slice(0, 5)

  const update = (idx, char) => {
    const next = digits.slice()
    next[idx]  = char
    onChange(next.join('').replace(/[^0-9]/g, '').slice(0, 5))
  }

  const handleChange = (e, idx) => {
    const char = e.target.value.replace(/\D/g, '').slice(-1)
    update(idx, char)
    if (char && idx < 4) inputs.current[idx + 1]?.focus()
  }

  const handleKeyDown = (e, idx) => {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        update(idx, '')
      } else if (idx > 0) {
        update(idx - 1, '')
        inputs.current[idx - 1]?.focus()
      }
    }
    if (e.key === 'ArrowLeft'  && idx > 0) inputs.current[idx - 1]?.focus()
    if (e.key === 'ArrowRight' && idx < 4) inputs.current[idx + 1]?.focus()
  }

  // Paste: take first 5 digits from clipboard, fill all boxes
  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 5)
    onChange(pasted)
    // Focus last filled box (or box after the last digit)
    const focusIdx = Math.min(pasted.length, 4)
    inputs.current[focusIdx]?.focus()
  }

  return (
    <div className="flex gap-3 justify-center" onPaste={handlePaste}>
      {[0, 1, 2, 3, 4].map((idx) => (
        <input
          key={idx}
          ref={(el) => { inputs.current[idx] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[idx] || ''}
          disabled={disabled}
          onChange={(e)   => handleChange(e, idx)}
          onKeyDown={(e)  => handleKeyDown(e, idx)}
          onFocus={(e)    => e.target.select()}
          className={`
            w-12 h-14 text-center text-xl font-bold rounded-xl
            border-2 transition
            bg-surface text-text
            focus:outline-none focus:border-accent
            disabled:opacity-50 disabled:cursor-not-allowed
            ${digits[idx] ? 'border-accent' : 'border-border'}
          `}
        />
      ))}
    </div>
  )
}
