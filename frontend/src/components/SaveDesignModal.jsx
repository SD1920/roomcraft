// src/components/SaveDesignModal.jsx
// Shown when user clicks "💾 Save Design" in the Editor bottom bar.
// If design was already saved (savedDesignId exists), does PUT (update).
// Otherwise does POST (create new).

import { useState, useEffect } from 'react'
import api from '../api/api'

export default function SaveDesignModal({
  initialName,        // pre-fill from room type
  savedDesignId,      // null = new, number = update existing
  roomData,
  furniture,
  openings,
  wallColors,
  floorType,
  connections = [],   // [{ design_id, door_id, wall }] — connected rooms
  onSaved,            // (design) => void
  onClose,
}) {
  const [name,    setName]    = useState(initialName || '')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Keep name in sync if initialName changes (e.g. room type selected)
  useEffect(() => {
    if (!savedDesignId && initialName) setName(initialName)
  }, [initialName, savedDesignId])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Please enter a name for this design.'); return }
    setError('')
    setSaving(true)

    const payload = {
      name:        name.trim(),
      room_type:   roomData.roomType   || null,
      room_width:  parseFloat(roomData.width)  || null,
      room_length: parseFloat(roomData.length) || null,
      wall_height: Math.min(15, Math.max(8, parseFloat(roomData.height) || 8)),
      style:       roomData.style      || null,
      furniture:   furniture,
      openings:    openings,
      wall_colors: wallColors,
      floor_type:  floorType,
      connections,
    }

    try {
      let res
      if (savedDesignId) {
        // Already saved before — update in place
        res = await api.put(`/api/designs/${savedDesignId}`, payload)
      } else {
        // First save — create new
        res = await api.post('/api/designs', payload)
      }
      onSaved(res.data.design)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-bg text-text border border-border rounded-2xl shadow-2xl
                      w-full max-w-sm p-6">

        <h2 className="font-semibold text-base mb-1">
          {savedDesignId ? 'Update design' : 'Save design'}
        </h2>
        <p className="text-xs opacity-50 mb-5">
          {savedDesignId
            ? 'Saves over the existing design — previous version will be replaced.'
            : 'Give this design a name so you can find it in your dashboard later.'}
        </p>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium opacity-70">Design name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              placeholder="e.g. My Bedroom, Living Room Draft…"
              maxLength={100}
              autoFocus
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-[11px] opacity-40 text-right">{name.length}/100</p>
          </div>

          {/* Summary of what's being saved */}
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs space-y-1">
            {roomData.roomType && (
              <p className="opacity-60">
                Room: <span className="text-text font-medium capitalize">
                  {roomData.roomType.replace('-', ' ')}
                </span>
              </p>
            )}
            {roomData.width && roomData.length && (
              <p className="opacity-60">
                Size: <span className="text-text font-medium">
                  {roomData.width} × {roomData.length} ft
                </span>
              </p>
            )}
            <p className="opacity-60">
              Wall height: <span className="text-text font-medium">
                {Math.min(15, Math.max(8, parseFloat(roomData.height) || 8))} ft
              </span>
            </p>
            <p className="opacity-60">
              Furniture: <span className="text-text font-medium">
                {furniture.length} item{furniture.length !== 1 ? 's' : ''}
              </span>
            </p>
            <p className="opacity-60">
              Openings: <span className="text-text font-medium">
                {openings.filter(o => o.type === 'door').length} door
                {openings.filter(o => o.type === 'door').length !== 1 ? 's' : ''},&nbsp;
                {openings.filter(o => o.type === 'window').length} window
                {openings.filter(o => o.type === 'window').length !== 1 ? 's' : ''}
              </span>
            </p>
          </div>

          {connections.length > 0 && (
            <p className="text-xs opacity-60 -mt-1">
              Connected rooms: <span className="text-text font-medium">{connections.length}</span>
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-2">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm
                         font-medium hover:bg-surface transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-lg bg-accent text-white text-sm
                         font-medium hover:opacity-90 transition disabled:opacity-40"
            >
              {saving ? 'Saving…' : savedDesignId ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
