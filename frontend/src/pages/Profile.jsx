// src/pages/Profile.jsx — UPDATED
// Fully wired to backend:
//   GET  /api/profile            → load on mount
//   PUT  /api/profile            → save name + profession
//   PUT  /api/profile/password   → change password
//   POST /api/profile/avatar     → upload profile picture

import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate }           from 'react-router-dom'
import { useTheme }   from '../hooks/useTheme'
import api            from '../api/api'
import { useAuth }    from '../context/AuthContext'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// A picked photo, scaled down to fit size × size and re-encoded as JPEG
function shrinkImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, size / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * s))
      canvas.height = Math.max(1, Math.round(img.height * s))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image.'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Please pick a JPEG, PNG or WebP image.')) }
    img.src = url
  })
}

export default function Profile() {
  const { theme, toggleTheme } = useTheme()
  const navigate               = useNavigate()
  const { user, updateUser, logout } = useAuth()
  const fileInputRef           = useRef()

  // ── Profile state ─────────────────────────────────────────
  const [profile,      setProfile]      = useState({ name: '', email: '', profession: '', avatar_url: '' })
  const [profileMsg,   setProfileMsg]   = useState({ text: '', type: '' })
  const [savingProf,   setSavingProf]   = useState(false)
  const [loadingProf,  setLoadingProf]  = useState(true)

  // ── Password state ────────────────────────────────────────
  const [pwForm,   setPwForm]   = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [pwMsg,    setPwMsg]    = useState({ text: '', type: '' })
  const [savingPw, setSavingPw] = useState(false)
  const [showPw,   setShowPw]   = useState({ current: false, new: false, confirm: false })

  // ── Avatar state ──────────────────────────────────────────
  const [uploading, setUploading] = useState(false)
  const [avatarMsg, setAvatarMsg] = useState('')

  // ── Load profile on mount ─────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/profile')
        const u   = res.data.user
        setProfile({
          name:       u.name       || '',
          email:      u.email      || '',
          profession: u.profession || '',
          avatar_url: u.avatar_url || '',
        })
      } catch (err) {
        console.error('[Profile] load error:', err)
      } finally {
        setLoadingProf(false)
      }
    }
    load()
  }, [])

  // ── Save profile (name + profession) ─────────────────────
  const handleProfileSave = async (e) => {
    e.preventDefault()
    setProfileMsg({ text: '', type: '' })
    setSavingProf(true)
    try {
      const res = await api.put('/api/profile', {
        name:       profile.name.trim(),
        profession: profile.profession.trim(),
      })
      updateUser({ name: res.data.user.name, profession: res.data.user.profession })
      setProfileMsg({ text: 'Profile saved.', type: 'success' })
    } catch (err) {
      setProfileMsg({ text: err.response?.data?.message || 'Failed to save.', type: 'error' })
    } finally {
      setSavingProf(false)
    }
  }

  // ── Change password ───────────────────────────────────────
  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setPwMsg({ text: '', type: '' })

    if (pwForm.newPassword !== pwForm.confirm)
      return setPwMsg({ text: 'New passwords do not match.', type: 'error' })
    if (pwForm.newPassword.length < 8 || !/[A-Z]/.test(pwForm.newPassword) || !/[0-9]/.test(pwForm.newPassword))
      return setPwMsg({ text: 'Password must be at least 8 characters, include 1 uppercase letter and 1 number.', type: 'error' })

    setSavingPw(true)
    try {
      await api.put('/api/profile/password', {
        currentPassword: pwForm.currentPassword,
        newPassword:     pwForm.newPassword,
      })
      setPwMsg({ text: 'Password changed successfully.', type: 'success' })
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      setPwMsg({ text: err.response?.data?.message || 'Failed to change password.', type: 'error' })
    } finally {
      setSavingPw(false)
    }
  }

  // ── Upload avatar ─────────────────────────────────────────
  const handleAvatarChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setAvatarMsg('')
    setUploading(true)

    // shrink to 256 px JPEG first: photos are stored in the database
    let photo
    try {
      photo = await shrinkImage(file)
    } catch (err) {
      setAvatarMsg(err.message)
      setUploading(false)
      return
    }
    const formData = new FormData()
    formData.append('avatar', photo, 'avatar.jpg')     // must match multer field name on backend

    try {
      const res = await api.post('/api/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const newUrl = res.data.avatar_url
      setProfile((prev) => ({ ...prev, avatar_url: newUrl }))
      updateUser({ avatar_url: newUrl })
      setAvatarMsg('Profile photo updated.')
    } catch (err) {
      setAvatarMsg(err.response?.data?.message || 'Upload failed. Max 2 MB (JPEG/PNG/WebP).')
    } finally {
      setUploading(false)
      e.target.value = ''   // reset file input so same file can be re-selected
    }
  }

  // ── Logout ────────────────────────────────────────────────
  const handleLogout = () => {
    logout()
    navigate('/', { replace: true })
  }

  const avatarSrc = profile.avatar_url
    ? (profile.avatar_url.startsWith('/') ? `${API_BASE}${profile.avatar_url}` : profile.avatar_url)
    : null

  const togglePw = (field) => setShowPw((prev) => ({ ...prev, [field]: !prev[field] }))

  const MsgBox = ({ msg }) =>
    msg.text ? (
      <div className={`rounded-lg px-4 py-2.5 text-xs border ${
        msg.type === 'success'
          ? 'border-green-400/40 bg-green-500/10 text-green-600 dark:text-green-400'
          : 'border-red-400/40 bg-red-500/10 text-red-500'
      }`}>
        {msg.text}
      </div>
    ) : null

  if (loadingProf) {
    return (
      <div className="min-h-screen bg-bg text-text flex items-center justify-center">
        <p className="text-sm opacity-50">Loading profile…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">

      {/* Navbar */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-border">
        <Link to="/dashboard" className="text-xl font-bold tracking-tight">roomcraft</Link>
        <div className="flex items-center gap-4">
          <button
            onClick={toggleTheme}
            className="text-sm px-3 py-1.5 rounded-full border border-border hover:bg-surface transition"
          >
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
          <Link to="/dashboard" className="text-sm font-medium hover:text-accent transition">
            Dashboard
          </Link>
          <button
            onClick={handleLogout}
            className="text-sm font-medium hover:text-accent transition"
          >
            Log out
          </button>
        </div>
      </nav>

      <main className="flex-1 px-8 md:px-16 py-12 max-w-2xl mx-auto w-full flex flex-col gap-10">

        <div>
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="text-sm opacity-70 mt-1">Manage your account details.</p>
        </div>

        {/* ── Avatar ─────────────────────────────────────── */}
        <div className="flex items-center gap-5">
          <div
            className="w-20 h-20 rounded-full bg-surface border border-border
                       overflow-hidden flex items-center justify-center shrink-0 relative"
          >
            {uploading ? (
              <span className="text-xs opacity-50">…</span>
            ) : avatarSrc ? (
              <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl opacity-40 font-semibold">
                {profile.name.charAt(0).toUpperCase() || '?'}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-sm font-medium px-4 py-2 rounded-lg border border-border
                         hover:bg-surface transition cursor-pointer inline-block"
            >
              {uploading ? 'Uploading…' : 'Change photo'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarChange}
                disabled={uploading}
                className="hidden"
              />
            </label>
            {avatarMsg && (
              <p className="text-xs opacity-70">{avatarMsg}</p>
            )}
            <p className="text-xs opacity-40">JPEG, PNG, WebP or GIF — max 2 MB</p>
          </div>
        </div>

        {/* ── Profile details ────────────────────────────── */}
        <form onSubmit={handleProfileSave} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Account details</h2>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => { setProfile({ ...profile, name: e.target.value }); setProfileMsg({ text: '', type: '' }) }}
              required
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         opacity-60 cursor-not-allowed"
            />
            <p className="text-xs opacity-40">Email cannot be changed.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Profession</label>
            <input
              type="text"
              value={profile.profession}
              onChange={(e) => { setProfile({ ...profile, profession: e.target.value }); setProfileMsg({ text: '', type: '' }) }}
              placeholder="e.g. Student, Interior Designer, Homeowner"
              className="px-4 py-2.5 rounded-lg border border-border bg-surface text-text
                         focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <MsgBox msg={profileMsg} />

          <button
            type="submit"
            disabled={savingProf}
            className="self-start px-5 py-2.5 rounded-lg bg-accent text-white font-medium
                       hover:opacity-90 transition disabled:opacity-40"
          >
            {savingProf ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        {/* ── Change password ────────────────────────────── */}
        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4 pt-6 border-t border-border">
          <h2 className="text-lg font-semibold">Change password</h2>

          {[
            { label: 'Current password', field: 'currentPassword' },
            { label: 'New password',     field: 'newPassword'     },
            { label: 'Confirm new',      field: 'confirm'         },
          ].map(({ label, field }) => (
            <div key={field} className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">{label}</label>
              <div className="relative">
                <input
                  type={showPw[field === 'currentPassword' ? 'current' : field === 'newPassword' ? 'new' : 'confirm'] ? 'text' : 'password'}
                  value={pwForm[field]}
                  onChange={(e) => { setPwForm({ ...pwForm, [field]: e.target.value }); setPwMsg({ text: '', type: '' }) }}
                  required
                  className="w-full px-4 py-2.5 pr-11 rounded-lg border border-border bg-surface text-text
                             focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => togglePw(field === 'currentPassword' ? 'current' : field === 'newPassword' ? 'new' : 'confirm')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-lg opacity-50 hover:opacity-80"
                >
                  {showPw[field === 'currentPassword' ? 'current' : field === 'newPassword' ? 'new' : 'confirm'] ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          ))}

          <MsgBox msg={pwMsg} />

          <button
            type="submit"
            disabled={savingPw}
            className="self-start px-5 py-2.5 rounded-lg border border-border font-medium
                       hover:bg-surface transition disabled:opacity-40"
          >
            {savingPw ? 'Updating…' : 'Update password'}
          </button>
        </form>

        {/* ── Danger zone ────────────────────────────────── */}
        <div className="pt-6 border-t border-border">
          <h2 className="text-lg font-semibold mb-1">Session</h2>
          <p className="text-sm opacity-60 mb-4">
            Logging out removes your token from this device.
          </p>
          <button
            onClick={handleLogout}
            className="px-5 py-2.5 rounded-lg border border-red-400/40 text-red-500
                       text-sm font-medium hover:bg-red-500/10 transition"
          >
            Log out
          </button>
        </div>

      </main>
    </div>
  )
}
