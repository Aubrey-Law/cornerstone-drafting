import { useCallback, useEffect, useState } from 'react'
import { apiGet, ApiError } from './api/client'
import { clearSession, loadSession, signIn, type StoredSession } from './auth/session'
import ChatPanel from './components/ChatPanel'
import FormatPanel from './components/FormatPanel'

interface SessionInfo {
  userId: string
  email: string | null
  name: string | null
  role: string | null
}

type Tab = 'chat' | 'format'

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession())
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chat')

  const verify = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      setInfo(await apiGet<SessionInfo>('/api/addin/session'))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession()
        setSession(null)
        setInfo(null)
        if (err.status === 403) setError('This account does not have firm access.')
      } else {
        setError(err instanceof Error ? err.message : 'Could not reach Cornerstone.')
      }
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (session) void verify()
    else setChecking(false)
  }, [session, verify])

  const handleSignIn = async () => {
    setError(null)
    try {
      setSession(await signIn())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    }
  }

  if (checking) {
    return <Centered>Checking your session…</Centered>
  }

  if (!info) {
    return (
      <Centered>
        <div className="space-y-3 text-center">
          <p className="text-[color:var(--color-ink-muted)]">
            Sign in to draft with Cornerstone.
          </p>
          {error && <p className="text-red-600">{error}</p>}
          <button
            type="button"
            onClick={handleSignIn}
            className="rounded bg-[color:var(--color-accent)] px-4 py-2 font-medium text-white"
          >
            Sign in
          </button>
        </div>
      </Centered>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--color-line)] px-3 py-2">
        <div className="flex gap-1">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
            Draft
          </TabButton>
          <TabButton active={tab === 'format'} onClick={() => setTab('format')}>
            Format
          </TabButton>
        </div>
        <button
          type="button"
          onClick={() => {
            clearSession()
            setSession(null)
            setInfo(null)
          }}
          className="text-xs text-[color:var(--color-ink-muted)] underline"
          title={info.email ?? undefined}
        >
          Sign out
        </button>
      </header>

      {/*
        Both panels stay mounted. Switching tabs mid-stream would otherwise tear
        down the request and lose the reply.
      */}
      <div className="min-h-0 flex-1" hidden={tab !== 'chat'}>
        <ChatPanel />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" hidden={tab !== 'format'}>
        <FormatPanel />
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-3 py-1 font-medium ${
        active
          ? 'bg-[color:var(--color-surface-sunken)] text-[color:var(--color-ink)]'
          : 'text-[color:var(--color-ink-muted)]'
      }`}
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-4 text-sm">{children}</div>
}
