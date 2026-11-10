// src/components/ConnectRoomModal.jsx
// Appears when user clicks "+" near a door in the 2D floor plan.
// Lists their saved designs; clicking one connects that room to the door.

import { useState, useEffect } from 'react'
import api from '../api/api'

const ROOM_LABELS = {
  'bedroom':     '🛏 Bedroom',
  'living-room': '🛋 Living Room',
  'study':       '📚 Study Room',
  'dining':      '🍽 Dining Room',
  'kitchen':     '🍳 Kitchen',
  'bathroom':    '🚿 Bathroom',
}

export default function ConnectRoomModal({ door, currentDesignId, onConnect, onClose }) {
  const [designs, setDesigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/designs')
        // Exclude the current design from the list (can't connect a room to itself)
        setDesigns(res.data.designs.filter((d) => d.id !== currentDesignId))
      } catch {
        setError('Failed to load designs.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentDesignId])

  const handleSelect = async (design) => {
    try {
      // Fetch full design (with furniture + openings) before connecting
      const res = await api.get(`/api/designs/${design.id}`)
      onConnect(res.data.design, door)
    } catch {
      setError('Failed to load design. Please try again.')
    }
  }

  const wallLabel = {
    front: 'Front wall (south)',
    back:  'Back wall (north)',
    left:  'Left wall (west)',
    right: 'Right wall (east)',
  }[door?.wall] || door?.wall

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-bg text-text border border-border rounded-2xl shadow-2xl
                      w-full max-w-md flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-base">Connect a room</h2>
            <p className="text-xs opacity-60 mt-0.5">
              Attaches to the door on the <span className="font-medium">{wallLabel}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg opacity-50 hover:opacity-100 transition ml-4"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-surface animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-red-500 text-center py-8">{error}</p>
          ) : designs.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-3xl mb-3">🏠</p>
              <p className="text-sm font-medium opacity-70">No other designs to connect</p>
              <p className="text-xs opacity-50 mt-1">
                Save another room design first, then come back here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {designs.map((design) => (
                <button
                  key={design.id}
                  onClick={() => handleSelect(design)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-xl
                             border border-border bg-surface hover:border-accent/50
                             hover:bg-accent/5 transition group"
                >
                  {/* Color swatch preview */}
                  <div
                    className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center text-xl"
                    style={{
                      backgroundColor: (() => {
                        try {
                          const wc = typeof design.wall_colors === 'string'
                            ? JSON.parse(design.wall_colors)
                            : (design.wall_colors || {})
                          return wc.back || '#f5f5f0'
                        } catch { return '#f5f5f0' }
                      })(),
                    }}
                  >
                    <span className="opacity-50">
                      {ROOM_LABELS[design.room_type]?.split(' ')[0] || '🏠'}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-accent transition">
                      {design.name}
                    </p>
                    <p className="text-xs opacity-50 mt-0.5">
                      {ROOM_LABELS[design.room_type] || 'Room'}
                      {design.room_width && design.room_length
                        ? ` · ${+Number(design.room_width).toFixed(4)}×${+Number(design.room_length).toFixed(4)} ft`
                        : ''}
                    </p>
                  </div>

                  {/* Arrow */}
                  <span className="text-accent opacity-0 group-hover:opacity-100 transition shrink-0">
                    →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0">
          <p className="text-xs opacity-40 text-center">
            The connected room appears in the 2D floor plan next to the door.
            You can remove it at any time.
          </p>
        </div>
      </div>
    </div>
  )
}
