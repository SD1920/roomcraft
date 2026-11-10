// src/components/Tutorial.jsx
// A short tour of the editor: a spotlight on one control at a time, with a
// small card explaining it.
//
// The spotlight is the box-shadow trick: a transparent box over the control
// with a huge dark shadow around it. Each step finds its control by
// [data-tutorial="id"]; a step whose control is not on screen just shows the
// card in the middle.
//
// On a phone the card is a strip across the top or bottom of the screen,
// whichever is away from the control, so it never covers what it points at.

import { useState, useEffect } from 'react'

// ─── Steps: one line each, in the order you would use them ───────────────────

const STEPS = [
  { id: 'room-panel',   title: '☰ Room panel',      desc: 'Room type, size and style, Generate room, and furniture to add. Or scan your real room with the phone.' },
  { id: '2d-plan',      title: '🗺 2D / 🧊 3D',      desc: 'Switch between the flat floor plan and the 3D room.' },
  { id: 'tools',        title: '☰ Tools',           desc: 'Lock the camera, show hidden walls, add a window or door, turn the room.' },
  { id: 'ask-ai',       title: '✨ Ask AI',          desc: 'Ask for colours or furniture, or "furnish this as a study". Tap a suggestion to apply it.' },
  { id: null,           title: '👆 Select a piece',  desc: 'Tap any piece to select it. Its size 📐, rotation ⟲⟳ and delete 🗑 appear at the top. Drag it to move.' },
  { id: 'wall-color',   title: '🎨 Wall colours',    desc: 'Tap a wall, then a colour. › shows more colours and ✨ AI Colors.' },
  { id: 'floor-select', title: '🪵 Floor',           desc: 'Pick the floor material.' },
  { id: 'save',         title: '💾 Save',            desc: 'Save your design. Update saves changes to it later.' },
]

// ─── Where the card goes ─────────────────────────────────────────────────────

const M = 12           // gap from the screen edge and from the spotlight
const CARD_W = 290     // card width on wide screens
const CARD_H = 170     // about how tall the card is, for placing it
const PHONE = 640      // narrower than this: the card is a strip, top or bottom

function cardPlace(sr, vpW, vpH) {
  if (vpW < PHONE) {
    const width = vpW - 2 * M
    // away from the control: below it if it is in the top half, else above
    if (!sr) return { left: M, width, top: Math.max(M, vpH / 2 - CARD_H / 2) }
    return sr.top + sr.h / 2 < vpH / 2
      ? { left: M, width, bottom: M }
      : { left: M, width, top: M }
  }
  const width = CARD_W
  if (!sr) return { left: vpW / 2 - width / 2, width, top: vpH / 2 - CARD_H / 2 }
  const clampY = (t) => Math.max(M, Math.min(vpH - CARD_H - M, t))
  const clampX = (l) => Math.max(M, Math.min(vpW - width - M, l))
  const cy = sr.top + sr.h / 2
  if (sr.left + sr.w + M + width < vpW) return { left: sr.left + sr.w + M, width, top: clampY(cy - CARD_H / 2) }
  if (sr.left - M - width > 0) return { left: sr.left - M - width, width, top: clampY(cy - CARD_H / 2) }
  if (sr.top + sr.h + M + CARD_H < vpH) return { left: clampX(sr.left + sr.w / 2 - width / 2), width, top: sr.top + sr.h + M }
  return { left: clampX(sr.left + sr.w / 2 - width / 2), width, top: Math.max(M, sr.top - M - CARD_H) }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Tutorial({ onClose }) {
  const [step, setStep] = useState(0)
  const [spotlight, setSpotlight] = useState(null)  // { top, left, w, h }
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  const PAD = 6  // room around the control
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const isFirst = step === 0

  const goNext = () => (isLast ? onClose() : setStep((s) => s + 1))
  const goBack = () => (!isFirst && setStep((s) => s - 1))

  // find the control for this step (and again when the screen turns or resizes)
  useEffect(() => {
    const run = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight })
      const el = current.id && document.querySelector(`[data-tutorial="${current.id}"]`)
      const r = el?.getBoundingClientRect()
      // a control that is hidden (e.g. inside a closed panel) has no size
      if (!r || r.width === 0 || r.height === 0 || r.right < 0 || r.left > window.innerWidth) { setSpotlight(null); return }
      setSpotlight({ top: r.top - PAD, left: r.left - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 })
    }
    const t = setTimeout(run, 60)
    window.addEventListener('resize', run)
    return () => { clearTimeout(t); window.removeEventListener('resize', run) }
  }, [step, current.id])

  const place = cardPlace(spotlight, vp.w, vp.h)

  return (
    // clicks fall through to the page except on the card
    <div className="fixed inset-0" style={{ zIndex: 9998, pointerEvents: 'none' }}>
      {spotlight ? (
        <div
          style={{
            position: 'fixed', top: spotlight.top, left: spotlight.left, width: spotlight.w, height: spotlight.h,
            borderRadius: 10, background: 'transparent',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.7)',
            outline: '2.5px dashed #f4a261',
            zIndex: 9999, pointerEvents: 'none', transition: 'all 0.2s ease',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, pointerEvents: 'none' }} />
      )}

      <div
        className="bg-surface dark:bg-zinc-800 text-text border border-border dark:border-zinc-600 rounded-2xl shadow-2xl p-4"
        style={{ position: 'fixed', ...place, zIndex: 10000, pointerEvents: 'all' }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-semibold">{current.title}</h3>
          <span className="text-[11px] opacity-60 tabular-nums">{step + 1} / {STEPS.length}</span>
        </div>
        <p className="text-sm opacity-80 leading-snug">{current.desc}</p>

        <div className="flex items-center justify-between mt-3">
          <button onClick={onClose} className="text-xs opacity-60 hover:opacity-100 py-1.5">Skip</button>
          <div className="flex items-center gap-2">
            <button onClick={goBack} disabled={isFirst}
              className="px-3 py-1.5 rounded-lg border border-border dark:border-zinc-600 text-sm disabled:opacity-30">
              Back
            </button>
            <button onClick={goNext} className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90">
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>

      {/* a tap outside the card closes the tour */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9997, pointerEvents: 'all' }} onClick={onClose} />
    </div>
  )
}
