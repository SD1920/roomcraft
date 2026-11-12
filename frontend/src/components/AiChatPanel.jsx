// src/components/AiChatPanel.jsx
// "✨ Ask AI" in the editor: suggestions for the open room. Each concrete
// suggestion comes with an Apply button; nothing changes until it is tapped,
// and every applied change can be undone. On a phone it opens as a bottom
// sheet over the lower part of the room.

import { useEffect, useRef, useState } from 'react'
import { chatAboutRoom } from '../api/assistant'
// notes left by a room made from a description, shown as the first message
export const AI_NOTES_KEY = (id) => `rc_ai_notes_${id}`

const STARTERS = [
  'What wall colour would suit this room?',
  'What else should I add?',
  'Add a window on the left wall',
  'Make the room 2 ft wider',
  'Furnish this room as a cozy study',
]

/**
 * @param designId   the open design's id, to show what the AI assumed when it made the room
 * @param getRoom    () => a compact summary of the open room (utils/promptRoom summariseRoom)
 * @param onApply    (action) => { ok, message?, undo? }
 * @param open, onOpenChange  the editor's "✨ Ask AI" toolbar button opens it
 */
export default function AiChatPanel({ designId, getRoom, onApply, open, onOpenChange }) {
  const setOpen = onOpenChange
  const [messages, setMessages] = useState([])   // { role: 'user'|'model', text, actions? }
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  // a room made from a description: show what was assumed, first thing
  useEffect(() => {
    if (!designId) return
    let notes = null
    try { notes = JSON.parse(sessionStorage.getItem(AI_NOTES_KEY(designId)) || 'null') } catch { /* none */ }
    if (!notes) return
    try { sessionStorage.removeItem(AI_NOTES_KEY(designId)) } catch { /* fine */ }
    const lines = [
      notes.reply,
      ...(notes.assumptions || []).map((a) => `• ${a}`),
      notes.skipped?.length ? `• No space for: ${notes.skipped.join(', ')}.` : '',
      'Ask me to change anything, or edit it by hand.',
    ].filter(Boolean)
    setMessages([...(notes.prompt ? [{ role: 'user', text: notes.prompt }] : []), { role: 'model', text: lines.join('\n') }])
    setOpen(true)
  }, [designId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  const send = async (msg) => {
    const message = (msg ?? text).trim()
    if (!message || busy) return
    const history = messages.slice(-8).map((m) => ({ role: m.role, text: m.text }))
    setMessages((m) => [...m, { role: 'user', text: message }])
    setText('')
    setBusy(true)
    try {
      const { reply, actions, quick } = await chatAboutRoom(message, history, getRoom())
      setMessages((m) => [...m, { role: 'model', text: reply, quick: Boolean(quick), actions: (actions || []).map((a) => ({ ...a, state: 'idle' })) }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'model', text: err.message, error: true }])
    } finally {
      setBusy(false)
    }
  }

  const setAction = (mi, ai, patch) =>
    setMessages((m) => m.map((msg, i) => (i !== mi ? msg : { ...msg, actions: msg.actions.map((a, j) => (j === ai ? { ...a, ...patch } : a)) })))

  const apply = (mi, ai) => {
    const action = messages[mi].actions[ai]
    const r = onApply(action) || { ok: false, message: 'Could not apply that.' }
    setAction(mi, ai, r.ok ? { state: 'applied', note: r.message || '', undo: r.undo } : { state: 'failed', note: r.message || 'Could not apply that.' })
  }

  const undo = (mi, ai) => {
    messages[mi].actions[ai].undo?.()
    setAction(mi, ai, { state: 'idle', note: 'Undone.', undo: null })
  }

  return (
    <>
      {open && (
        <div className="fixed z-40 inset-x-0 bottom-0 h-[62vh] rounded-t-2xl border shadow-2xl
                        md:static md:inset-auto md:h-auto md:w-96 md:shrink-0 md:rounded-none md:border-0 md:border-l md:shadow-none
                        flex flex-col bg-bg text-text border-border">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="font-semibold text-sm">✨ AI assistant</p>
            <button type="button" onClick={() => setOpen(false)} className="text-sm opacity-60 hover:opacity-100 px-2" aria-label="Close">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="opacity-70">
                <p className="mb-2">Ask about colours, furniture or layout for this room. Suggestions come with an Apply button.</p>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:border-accent/50">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, mi) => (
              <div key={mi} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[90%] rounded-xl px-3 py-2 whitespace-pre-line ${
                  m.role === 'user' ? 'bg-accent text-white' : m.error ? 'bg-red-500/10 text-red-500' : 'bg-surface border border-border'}`}>
                  {m.quick && (
                    <span title="Every AI model was busy, so simple rules understood this message"
                      className="inline-block mb-1 mr-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">
                      Quick mode
                    </span>
                  )}
                  {m.text}
                  {m.actions?.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {m.actions.map((a, ai) => (
                        <div key={ai} className="flex flex-wrap items-center gap-2">
                          {a.state === 'applied' ? (
                            <>
                              <span className="text-xs text-green-600">✓ {a.label}</span>
                              {a.undo && <button type="button" onClick={() => undo(mi, ai)} className="text-xs underline opacity-70">Undo</button>}
                            </>
                          ) : (
                            <button type="button" onClick={() => apply(mi, ai)}
                              className="text-xs px-2.5 py-1.5 rounded-lg bg-accent/15 text-accent font-medium hover:bg-accent/25 text-left">
                              {a.label}
                            </button>
                          )}
                          {a.note && <span className={`text-[11px] ${a.state === 'failed' ? 'text-red-500' : 'opacity-60'}`}>{a.note}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs opacity-60">Thinking… (usually a few seconds)</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex gap-2 p-3 border-t border-border">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
              placeholder="e.g. paint the walls sage green"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <button type="submit" disabled={busy || !text.trim()}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50">Send</button>
          </form>
        </div>
      )}
    </>
  )
}
