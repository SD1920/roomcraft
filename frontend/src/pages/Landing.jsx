import { Component, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../context/AuthContext'
import DemoButton, { DEMO_MODE } from '../components/DemoButton'

// The 3D preview pulls in three.js, so load it only when the landing page needs it
const LandingPreview = lazy(() => import('../components/LandingPreview'))

// If WebGL isn't available (or anything in the 3D scene throws), show a calm fallback
// instead of taking the whole landing page down with it.
class PreviewBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-6">
          <span className="text-4xl">🛋</span>
          <span className="text-sm opacity-60">3D preview isn't available on this device.</span>
        </div>
      )
    }
    return this.props.children
  }
}

function Landing() {
  const { theme, toggleTheme } = useTheme()
  const { isLoggedIn, user } = useAuth()

  const firstName = user?.name?.split(' ')[0]

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Navbar */}
      <nav className="flex items-center justify-between gap-3 px-4 sm:px-8 py-4 sm:py-5 border-b border-border">
        {/* Logged-in users go to their dashboard; guests stay on the landing page */}
        <Link to={isLoggedIn ? '/dashboard' : '/'} className="text-xl font-bold tracking-tight">
          roomcraft
        </Link>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <button
            onClick={toggleTheme}
            className="text-xs sm:text-sm px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full border border-border hover:bg-surface transition whitespace-nowrap"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀' : '🌙'}<span className="hidden sm:inline"> {theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          {isLoggedIn ? (
            <>
              <Link to="/profile" className="text-sm opacity-70 hover:opacity-100 hover:text-accent transition">
                {firstName ? `Hi, ${firstName}` : 'Profile'}
              </Link>
              <Link
                to="/dashboard"
                className="text-sm font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 transition"
              >
                Dashboard
              </Link>
            </>
          ) : (
            <Link to="/login" className="text-sm font-medium hover:text-accent transition">
              Log in
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col md:flex-row items-center justify-between px-8 md:px-16 py-16 gap-12 max-w-6xl mx-auto w-full">
        <div className="flex flex-col gap-6 max-w-lg">
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            See your room before you buy a single thing.
          </h1>
          <p className="text-lg opacity-80 leading-relaxed">
            Set your room's size and style, get furniture picks that actually fit your space and budget, then arrange them in 3D — no guessing, no returns.
          </p>
          <div className="flex gap-4 mt-2">
            {isLoggedIn ? (
              <>
                <Link
                  to="/editor"
                  className="px-6 py-3 rounded-lg bg-accent text-white font-medium hover:opacity-90 transition"
                >
                  Start a new design
                </Link>
                <Link
                  to="/dashboard"
                  className="px-6 py-3 rounded-lg border border-border font-medium hover:bg-surface transition"
                >
                  My designs
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/register"
                  className="px-6 py-3 rounded-lg bg-accent text-white font-medium hover:opacity-90 transition"
                >
                  Start designing
                </Link>
                {DEMO_MODE && <DemoButton />}
                <Link
                  to="/login"
                  className="px-6 py-3 rounded-lg border border-border font-medium hover:bg-surface transition"
                >
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Live 3D sample room */}
        <div className="relative w-full md:w-[460px] h-[340px] rounded-2xl bg-surface border border-border overflow-hidden shrink-0">
          <PreviewBoundary>
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-sm opacity-50 animate-pulse">Loading preview…</span>
                </div>
              }
            >
              <LandingPreview />
            </Suspense>
          </PreviewBoundary>
          <span className="absolute bottom-3 left-4 text-[11px] opacity-50 pointer-events-none">
            Sample bedroom · built in roomcraft
          </span>
        </div>
      </main>
    </div>
  )
}

export default Landing