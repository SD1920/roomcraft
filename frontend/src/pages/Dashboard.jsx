// src/pages/Dashboard.jsx — fully wired to backend
import { useState, useEffect }        from 'react'
import { Link, useNavigate }          from 'react-router-dom'
import { useTheme }  from '../hooks/useTheme'
import { useAuth }   from '../context/AuthContext'
import api           from '../api/api'
import { exportFloorPlanPdf, planFromDesign } from '../utils/exportFloorPlan'

const API_BASE = import.meta.env.VITE_API_URL ?? ''
// 15.0000 → 15, 12.3456 stays (sizes are stored with 4 decimals)
const feet = (v) => +Number(v).toFixed(4)

// The user's profile photo in a circle (uploaded on the Profile page), or their
// initials when there is none or it fails to load
function UserAvatar({ user }) {
  const [broken, setBroken] = useState(false)
  const url = user?.avatar_url || ''
  const src = url.startsWith('/') ? `${API_BASE}${url}` : url
  useEffect(() => setBroken(false), [src])
  const initials = String(user?.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <span className="w-8 h-8 shrink-0 rounded-full overflow-hidden border border-border bg-surface
                     flex items-center justify-center text-xs font-semibold text-accent">
      {src && !broken
        ? <img src={src} alt="" className="w-full h-full object-cover" onError={() => setBroken(true)} />
        : initials}
    </span>
  )
}

const ROOM_LABELS = {
  'bedroom':     '🛏 Bedroom',
  'living-room': '🛋 Living Room',
  'study':       '📚 Study Room',
  'dining':      '🍽 Dining Room',
  'kitchen':     '🍳 Kitchen',
  'bathroom':    '🚿 Bathroom',
  'kids-room':   '🧸 Kids Room',
  'entrance':    '🚪 Entrance',
  'balcony':     '🌿 Balcony',
  'utility':     '🧺 Utility',
  'pooja':       '🪔 Pooja Room',
  'gym':         '🏋 Home Gym',
  'classroom':   '🏫 Classroom',
  'computer-lab': '💻 Computer Lab',
}

const STYLE_COLORS = {
  minimal:    '#f5f5f0',
  modern:     '#e2e2e2',
  cozy:       '#e8d5b8',
  industrial: '#787878',
}

function DesignCard({ design, onDelete, onOpen }) {
  const [deleting, setDeleting] = useState(false)
  const [confirm,  setConfirm]  = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy,     setBusy]     = useState('')   // '' | 'download' | 'share'
  const [msg,      setMsg]      = useState('')

  const closeMenu = () => { setMenuOpen(false); setConfirm(false) }

  const handleDelete = async () => {
    if (!confirm) { setConfirm(true); return }
    setDeleting(true)
    try {
      await api.delete(`/api/designs/${design.id}`)
      onDelete(design.id)
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
      setConfirm(false)
    }
  }

  // Fetch the full design (furniture, openings, connected rooms) and export its 2D plan
  const handleExport = async (mode) => {
    setMenuOpen(false)
    setConfirm(false)
    setBusy(mode)
    setMsg('')
    try {
      const res  = await api.get(`/api/designs/${design.id}`)
      const plan = await planFromDesign(res.data.design, api)
      const result = await exportFloorPlanPdf(plan, mode)
      if (result === 'shared') setMsg('✓ Shared')
      else if (result === 'fallback') setMsg('✓ Downloaded')
      else if (result === 'downloaded') setMsg('✓ PDF downloaded')
    } catch (err) {
      console.error('Export failed:', err)
      setMsg('Export failed')
    } finally {
      setBusy('')
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const date = new Date(design.updated_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  const wallColor = design.wall_colors
    ? (typeof design.wall_colors === 'string'
        ? JSON.parse(design.wall_colors).back
        : design.wall_colors.back)
    : STYLE_COLORS[design.style] || '#f5f5f0'

  return (
    <div className="border border-border rounded-2xl bg-surface
                    hover:border-accent/40 transition group">

      {/* Preview swatch */}
      <div
        className="h-28 relative flex items-center justify-center text-3xl cursor-pointer rounded-t-2xl overflow-hidden"
        style={{ backgroundColor: wallColor || '#f5f5f0' }}
        onClick={() => onOpen(design.id)}
      >
        <span className="opacity-60">
          {ROOM_LABELS[design.room_type]?.split(' ')[0] || '🏠'}
        </span>
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition
                        flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 transition text-white text-xs
                           font-medium bg-black/50 px-3 py-1.5 rounded-full">
            Open in Editor
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className="p-4">
        <h3 className="font-semibold text-sm truncate">{design.name}</h3>
        <p className="text-xs opacity-60 mt-0.5">
          {ROOM_LABELS[design.room_type] || '🏠 Room'}
          {design.room_width && design.room_length
            ? ` · ${feet(design.room_width)}×${feet(design.room_length)} ft`
            : ''}
        </p>
        <p className="text-xs opacity-40 mt-1">Updated {date}</p>

        <div className="flex items-center gap-2 mt-3">
          {/* Open button */}
          <button
            onClick={() => onOpen(design.id)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs
                       font-medium hover:opacity-90 transition text-center"
          >
            Open
          </button>

          {msg && (
            <span className={`text-[11px] font-medium ${msg.startsWith('✓') ? 'text-green-500' : 'text-red-500'}`}>
              {msg}
            </span>
          )}

          {/* Three-dot menu: export / share / delete */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={deleting || !!busy}
              title="More options"
              className="w-8 h-8 rounded-lg border border-border hover:bg-bg transition
                         text-base leading-none disabled:opacity-40"
            >
              {busy ? '…' : '⋮'}
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={closeMenu} />
                <div className="absolute bottom-full right-0 mb-1 z-20 w-44 rounded-xl border border-border
                                bg-bg shadow-xl py-1 text-xs">
                  <button onClick={() => handleExport('download')}
                          className="w-full text-left px-3 py-2 hover:bg-surface transition">
                    ⬇ Export 2D plan (PDF)
                  </button>
                  <button onClick={() => handleExport('share')}
                          className="w-full text-left px-3 py-2 hover:bg-surface transition">
                    📤 Share PDF
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button onClick={handleDelete} disabled={deleting}
                          className={`w-full text-left px-3 py-2 transition ${
                            confirm ? 'bg-red-500/10 text-red-500 font-medium' : 'text-red-500 hover:bg-red-500/10'
                          }`}>
                    {deleting ? 'Deleting…' : confirm ? '⚠ Click again to delete' : '🗑 Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { theme, toggleTheme }  = useTheme()
  const { user, logout, updateUser } = useAuth()
  const navigate                = useNavigate()

  const [designs, setDesigns]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState('')

  // fresh name + photo from the server (a photo uploaded on another device, or
  // before this login, is not in the saved session yet)
  useEffect(() => {
    api.get('/api/profile')
      .then((res) => {
        const u = res.data?.user
        if (u && (u.avatar_url !== user?.avatar_url || u.name !== user?.name)) {
          updateUser({ name: u.name, avatar_url: u.avatar_url || '' })
        }
      })
      .catch(() => { /* keep what the session has */ })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/designs')
        setDesigns(res.data.designs)
      } catch (err) {
        setError('Failed to load designs.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleDelete = (id) =>
    setDesigns((prev) => prev.filter((d) => d.id !== id))

  const handleOpen = (id) =>
    navigate(`/editor?id=${id}`)

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">

      {/* Navbar */}
      {/* Navbar: on a phone the theme button is just its icon and a long name is cut short */}
      <nav className="flex items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-5 border-b border-border">
        <Link to="/" className="text-lg sm:text-xl font-bold tracking-tight shrink-0">roomcraft</Link>
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="shrink-0 text-sm px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full border border-border hover:bg-surface transition"
          >
            {theme === 'dark' ? '☀' : '🌙'}<span className="hidden sm:inline"> {theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <Link to="/profile" title="Your profile" className="flex items-center gap-2 min-w-0 hover:text-accent transition">
            <UserAvatar user={user} />
            <span className="text-xs sm:text-sm font-medium truncate max-w-[6.5rem] sm:max-w-[12rem]">
              {user?.name || 'Profile'}
            </span>
          </Link>
          <button
            onClick={() => { logout(); navigate('/') }}
            className="shrink-0 text-xs sm:text-sm opacity-60 hover:opacity-100 transition"
          >
            Log out
          </button>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 px-4 sm:px-8 md:px-16 py-6 sm:py-12 max-w-6xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">My Designs</h1>
            <p className="text-sm opacity-60 mt-1">
              {loading ? 'Loading…' : `${designs.length} design${designs.length === 1 ? '' : 's'} saved`}
            </p>
          </div>
          <div className="flex gap-3">
            {/* The room scanner is its own page (camera + AR), not a React route */}
            <a
              href="/scan.html"
              className="flex-1 sm:flex-none text-center whitespace-nowrap px-4 sm:px-5 py-2.5 rounded-lg border border-accent text-accent text-sm sm:text-base font-medium hover:bg-accent/10 transition"
              title="Measure your real room with your phone's camera"
            >
              📷 Scan my room
            </a>
            <Link
              to="/editor"
              className="flex-1 sm:flex-none text-center whitespace-nowrap px-4 sm:px-5 py-2.5 rounded-lg bg-accent text-white text-sm sm:text-base font-medium hover:opacity-90 transition"
            >
              + New Design
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="border border-border rounded-2xl overflow-hidden animate-pulse">
                <div className="h-28 bg-surface" />
                <div className="p-4 flex flex-col gap-2">
                  <div className="h-3 bg-surface rounded w-3/4" />
                  <div className="h-2 bg-surface rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : designs.length === 0 ? (
          <div className="border border-dashed border-border rounded-2xl py-24
                          flex flex-col items-center justify-center gap-3">
            <p className="text-4xl">🛋</p>
            <p className="text-lg font-medium opacity-80">No designs yet</p>
            <p className="text-sm opacity-50 max-w-sm text-center">
              Create your first room design in the editor and click Save Design.
            </p>
            <Link
              to="/editor"
              className="mt-2 px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:opacity-90 transition"
            >
              Create your first design
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {designs.map((design) => (
              <DesignCard
                key={design.id}
                design={design}
                onDelete={handleDelete}
                onOpen={handleOpen}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
