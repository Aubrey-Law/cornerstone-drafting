import { useCallback, useEffect, useState } from 'react'
import { apiGet, ApiError, NotSignedInError } from './api/client'
import {
  clearSession,
  loadSession,
  signIn,
  storeSession,
  type StoredSession,
} from './auth/session'
import ChatPanel from './components/ChatPanel'
import FormatPanel from './components/FormatPanel'
import MatterBar from './components/MatterBar'
import WriteBackPanel from './components/WriteBackPanel'
import VersionPanel from './components/VersionPanel'
import {
  clearLink,
  currentDocumentKey,
  loadLink,
  storeLink,
  type LinkedMatter,
} from './matter/link'
import {
  clearDocumentLink,
  currentDocumentLinkKey,
  loadDocumentLink,
  storeDocumentLink,
  type LinkedDocument,
} from './document/link'

interface SessionInfo {
  userId: string
  email: string | null
  name: string | null
  role: string | null
}

type Tab = 'chat' | 'sheet' | 'versions' | 'format'

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession())
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chat')
  // Resolved once: the pane is re-created when Word opens another document, so
  // the key cannot change underneath a mounted App.
  const [documentKey] = useState<string | null>(() => currentDocumentKey())
  const [matter, setMatter] = useState<LinkedMatter | null>(() => loadLink(documentKey))

  const linkMatter = useCallback(
    (next: LinkedMatter) => {
      storeLink(documentKey, next)
      setMatter(next)
    },
    [documentKey],
  )

  const unlinkMatter = useCallback(() => {
    clearLink(documentKey)
    setMatter(null)
  }, [documentKey])

  const [documentLinkKey] = useState<string | null>(() => currentDocumentLinkKey())
  // Not named `document`: inside this component that would shadow the global
  // one, and a later `document.getElementById` would resolve to the link.
  const [linkedDocument, setLinkedDocument] = useState<LinkedDocument | null>(() =>
    loadDocumentLink(documentLinkKey),
  )

  const linkDocument = useCallback(
    (next: LinkedDocument) => {
      storeDocumentLink(documentLinkKey, next)
      setLinkedDocument(next)
    },
    [documentLinkKey],
  )

  const unlinkDocument = useCallback(() => {
    clearDocumentLink(documentLinkKey)
    setLinkedDocument(null)
  }, [documentLinkKey])

  const verify = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      setInfo(await apiGet<SessionInfo>('/api/addin/session'))
    } catch (err) {
      // A stored token the server rejects, or none at all, both mean the same
      // thing here: show the sign-in button. This call is non-interactive, so
      // it can never answer a 401 by opening a dialog.
      if (err instanceof NotSignedInError) {
        setSession(null)
        setInfo(null)
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
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
    return <Waiting onSignIn={handleSignIn} onRetry={verify} />
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
          <TokenPaste onAccept={setSession} />
        </div>
      </Centered>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--color-line)] px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
            Draft
          </TabButton>
          <TabButton active={tab === 'sheet'} onClick={() => setTab('sheet')}>
            Sheet
          </TabButton>
          <TabButton active={tab === 'versions'} onClick={() => setTab('versions')}>
            Versions
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
        Above the tabs' content, not inside the chat panel: the matter is a
        property of the document, and it stays on screen while the attorney is
        on the Format tab rather than appearing to have been forgotten.
      */}
      <MatterBar linked={matter} onLink={linkMatter} onUnlink={unlinkMatter} />

      {/*
        Both panels stay mounted. Switching tabs mid-stream would otherwise tear
        down the request and lose the reply.
      */}
      <div className="min-h-0 flex-1" hidden={tab !== 'chat'}>
        <ChatPanel matterId={matter?.id ?? null} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" hidden={tab !== 'sheet'}>
        <WriteBackPanel matterId={matter?.id ?? null} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" hidden={tab !== 'versions'}>
        <VersionPanel
          matterId={matter?.id ?? null}
          linked={linkedDocument}
          onLink={linkDocument}
          onUnlink={unlinkDocument}
        />
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

/**
 * The receiving end of the dialog's escape hatch.
 *
 * When the dialog signs in but cannot reach Word — `messageParent` never turns
 * up — it shows the access token and asks the attorney to paste it here. That
 * offer was previously made with nowhere to paste it, which made the whole
 * fallback theatre. Collapsed by default: it is a recovery path, not a
 * second way to sign in.
 */
function TokenPaste({ onAccept }: { onAccept: (session: StoredSession) => void }) {
  const [token, setToken] = useState('')

  const accept = () => {
    const accessToken = token.trim()
    if (!accessToken) return
    // Everything but the token is unknown here. `expiresAt: null` is honest
    // rather than optimistic: the pane treats a rejected token as signed out,
    // so a stale paste surfaces as a normal 401 instead of a wrong expiry.
    const session: StoredSession = {
      accessToken,
      refreshToken: null,
      expiresAt: null,
      email: null,
    }
    storeSession(session)
    onAccept(session)
  }

  return (
    <details className="text-left">
      <summary className="cursor-pointer text-[11px] text-[color:var(--color-ink-muted)]">
        Paste a token instead
      </summary>
      <div className="mt-2 space-y-2">
        <textarea
          value={token}
          onChange={e => setToken(e.target.value)}
          aria-label="Access token"
          placeholder="Paste the token from the sign-in window"
          className="h-20 w-full rounded border border-[color:var(--color-line)] p-2 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={accept}
          disabled={!token.trim()}
          className="rounded border border-[color:var(--color-line)] px-3 py-1 disabled:opacity-50"
        >
          Use token
        </button>
      </div>
    </details>
  )
}

/**
 * The waiting state, which must never be a dead end.
 *
 * Requests are time-boxed now, so this resolves on its own. The escape hatches
 * appear anyway: when this pane hangs it is usually the dev server, and a
 * spinner with no way out gives the attorney nothing to try.
 */
function Waiting({ onSignIn, onRetry }: { onSignIn: () => void; onRetry: () => void }) {
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), 4000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <Centered>
      <div className="space-y-3 text-center">
        <p>Checking your session…</p>
        {/*
          Always visible, not gated behind `stalled`. The one question that
          cannot be answered by looking at a stuck pane is "is this even the
          code I just changed?" — Word caches add-in bundles hard enough that
          it usually is not.
        */}
        <p className="text-[11px] text-[color:var(--color-ink-muted)]">build {__BUILD_STAMP__}</p>
        {stalled && (
          <>
            <p className="text-[color:var(--color-ink-muted)]">
              Taking longer than expected. Cornerstone should be running at{' '}
              <code>{window.location.origin}</code>.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="rounded border border-[color:var(--color-line)] px-3 py-1"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onSignIn}
                className="rounded bg-[color:var(--color-accent)] px-3 py-1 font-medium text-white"
              >
                Sign in
              </button>
            </div>
          </>
        )}
      </div>
    </Centered>
  )
}
