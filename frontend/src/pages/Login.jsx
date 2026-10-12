import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, Presentation } from 'lucide-react';
import Brand from '../components/ui/Brand';
import Spinner from '../components/ui/Spinner';

export default function Login() {
  const [role, setRole] = useState('student')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [demoAccounts, setDemoAccounts] = useState([]);
  const navigate = useNavigate()
  // Sliding tab pill: follows the cursor while hovering, snaps back to the active role on leave
  const tabsRef = useRef(null)
  const [pillX, setPillX] = useState(null)
  const trackPill = (e) => {
    const r = tabsRef.current.getBoundingClientRect()
    const half = (r.width - 8) / 2
    setPillX(Math.min(half, Math.max(0, e.clientX - r.left - 4 - half / 2)))
  }

  // Auto-redirect if already logged in with active session
  useEffect(() => {
    try {
      const user = JSON.parse(sessionStorage.getItem('user') || '{}')
      const token = sessionStorage.getItem('authToken')
      if (token && user.role === 'teacher') {
        navigate('/teacher', { replace: true })
      } else if (token && user.role === 'student') {
        navigate('/student', { replace: true })
      }
    } catch {}
  }, [navigate])

  useEffect(() => {
    fetch('/api/auth/demo-accounts')
      .then((res) => {
        if (!res.ok) throw new Error('Could not load demo accounts')
        return res.json();
      })
      .then((data) => {
        setDemoAccounts(data.accounts || [])
      })
      .catch(() => {
        setDemoAccounts([])
      })
  }, [])

  const visibleDemoAccounts = demoAccounts.filter(
    (account) => account.role === role
  )

  const fillDemoAccount = (account) => {
    setUsername(account.username)
    setPassword(account.password)
    setError('')
  }

  const handleRoleChange = (newRole) => {
    setRole(newRole)
    setError('')
    setUsername('')
    setPassword('')
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.user) {
        throw new Error(data?.error || 'Invalid username or password.')
      }

      sessionStorage.setItem('user', JSON.stringify(data.user))
      if (data.token) sessionStorage.setItem('authToken', data.token)
      if (data.user.role === 'teacher') {
        navigate('/teacher')
      } else {
        navigate('/student')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputCls =
    'h-11 w-full rounded-xl border border-line-strong bg-panel px-3.5 text-[15px] text-fg placeholder:text-mute transition focus:border-accent focus:bg-panel focus:ring-4 focus:ring-accent/15 focus:outline-none'

  return (
    <div className="grid min-h-dvh bg-ink text-fg lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <aside className="rail-dark dot-grid relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
        <Brand />
        <div className="max-w-xl">
          <p className="font-mono text-[11px] tracking-[0.25em] text-accent">AI · RAG · MULTI-SUBJECT</p>
          <h1 className="mt-6 text-[clamp(2.4rem,3.6vw,3.6rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-fg">
            Answers grounded in the material you <span className="font-serif font-normal italic text-accent">actually</span> study.
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-dim">
            A personalized tutor that reads your course documents and explains
            concepts, diagrams, and derivations — subject by subject.
          </p>
        </div>
        <ul className="grid gap-0 border-t border-line">
          {[
            ['01', 'Retrieval-augmented answers, tied to your sources'],
            ['02', 'Diagrams and math rendered inline'],
            ['03', 'Separate spaces for students and faculty'],
          ].map(([n, t]) => (
            <li key={n} className="flex items-baseline gap-5 border-b border-line py-4 text-sm text-dim">
              <span className="font-mono text-xs text-accent">{n}</span> {t}
            </li>
          ))}
        </ul>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="pointer-events-none absolute inset-0 grain lg:hidden" />
        <div className="relative w-full max-w-[420px] animate-rise lg:-mt-10">
          <Brand className="mb-10 lg:hidden" />
          <p className="font-mono text-[11px] tracking-[0.22em] text-mute uppercase">Welcome back</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">Sign in to continue</h1>
          <p className="mt-2 text-sm text-dim">Choose your role, then enter your credentials.</p>

          <div
            ref={tabsRef}
            role="tablist"
            onPointerMove={(e) => e.pointerType === 'mouse' && trackPill(e)}
            onPointerLeave={() => setPillX(null)}
            className="relative mt-8 grid grid-cols-2 rounded-xl border border-line bg-raised p-1">
            <span
              aria-hidden
              style={{ transform: pillX === null ? `translateX(${role === 'teacher' ? '100%' : '0'})` : `translateX(${pillX}px)` }}
              className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-panel shadow-[0_1px_2px_#0f16301a,0_4px_12px_-4px_#1a245033,inset_0_0_0_1px_#dbe0ec] transition-transform ease-[cubic-bezier(0.3,0.9,0.3,1)] ${
                pillX === null ? 'duration-300' : 'duration-150'
              }`}
            />
            {[
              ['student', 'Student', GraduationCap],
              ['teacher', 'Teacher', Presentation],
            ].map(([key, label, Ico]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={role === key}
                onClick={() => { handleRoleChange(key); setPillX(null) }}
                className={`relative z-10 flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-300 ${
                  role === key ? 'text-fg' : 'text-mute hover:text-dim'
                }`}
              >
                <Ico size={15} className={`transition-colors duration-300 ${role === key ? 'text-accent' : ''}`} />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleLogin} className="animate-rise shadow-[0_30px_70px_-40px_#13172655] mt-5 space-y-4 rounded-2xl border border-line bg-panel/70 p-5 sm:p-6">
            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-dim">Username</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={`Enter ${role} username`}
                autoComplete="username"
                required
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-dim">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
                className={inputCls}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_#5b7cff] transition hover:bg-accent-strong disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Spinner className="size-4 border-white/30 border-t-white" /> Signing in...
                </>
              ) : (
                <>
                  {`Sign In as ${role.charAt(0).toUpperCase() + role.slice(1)}`}
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 min-h-[140px] rounded-xl border border-dashed border-line-strong px-4 py-3 font-mono text-xs leading-6 text-mute">
            {visibleDemoAccounts.length > 0 ? (
              <div className="space-y-1">
                {visibleDemoAccounts.map((account) => (
                  <p
                    key={account.username}
                    className="cursor-pointer transition hover:text-fg"
                    onClick={() => fillDemoAccount(account)}
                  >
                    {account.name}: <strong className="text-dim">{account.username}</strong>
                    {' / '}
                    <strong className="text-dim">{account.password}</strong>
                    <span className="opacity-60"> (click to fill)</span>
                  </p>
                ))}
              </div>
            ) : (
              <p>No {role} demo accounts are available.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
