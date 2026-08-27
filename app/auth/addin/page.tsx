'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { supabase } from '@/lib/supabaseClient'
import { AuthShell } from '@/components/layout/AuthShell'

type Status = 'checking' | 'signed-out' | 'handing-off' | 'no-host' | 'forbidden' | 'error'

/**
 * Wording here is deliberately unlike the task pane's waiting text.
 *
 * Both used to say "Checking your session…", and a stuck dialog was
 * indistinguishable from a stuck pane in a screenshot or a bug report — which
 * sent four rounds of fixes at the wrong component. Nothing in this feature
 * should be able to render the same waiting string as anything else.
 */
const STATUS_TEXT: Record<Status, string> = {
  checking: 'Signing you in to Cornerstone…',
  'signed-out': 'Taking you to sign in…',
  'handing-off': 'Signed in. Returning to Word…',
  forbidden: 'This account does not have firm access.',
  'no-host': 'Word did not respond.',
  error: 'Something went wrong signing you in.',
}

/**
 * How long to wait for Office.js before giving up and offering the token
 * manually. Generous: the script comes from Microsoft's CDN and a cold Word
 * dialog is slow. Finite: waiting forever is the bug this replaces.
 */
const OFFICE_TIMEOUT_MS = 15_000

/**
 * The slice of Office.js this page uses.
 *
 * Declared locally rather than pulling `@types/office-js` into the Next app:
 * this is the only file in the web app that touches Office, and the runtime
 * arrives from Microsoft's CDN at load time either way.
 */
interface OfficeGlobal {
  onReady?: (callback?: () => void) => Promise<unknown> | void
  context?: { ui?: { messageParent?: (message: string) => void } }
}

function getOffice(): OfficeGlobal | null {
  return (globalThis as { Office?: OfficeGlobal }).Office ?? null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Resolve `messageParent`, or null if Office never turns up.
 *
 * Polls rather than relying on `next/script`'s `onReady` callback. That
 * callback firing was previously the *only* path forward, reached through an
 * optional chain — so if `window.Office` was not populated at that exact
 * instant, nothing was called, no error was raised, and the dialog waited
 * forever. Polling cannot miss the moment, and the deadline means the failure
 * is reported instead of hung.
 */
async function resolveMessageParent(
  timeoutMs: number,
): Promise<((message: string) => void) | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const office = getOffice()
    if (office) {
      // Modern office.js resolves a promise from a bare onReady(); older
      // builds only take a callback and return undefined. Awaiting undefined
      // is harmless, so this covers both without sniffing versions.
      try {
        await office.onReady?.()
      } catch {
        // A rejected onReady still leaves messageParent worth checking.
      }
      const messageParent = getOffice()?.context?.ui?.messageParent
      if (typeof messageParent === 'function') return messageParent
    }
    await sleep(100)
  }

  return null
}

/**
 * The Word add-in's sign-in dialog.
 *
 * Office dialogs can only talk to their opener through `messageParent`, and
 * only from a page on the add-in's own origin. In dev the pane's Vite server
 * proxies `/auth` and `/_next` through to Cornerstone, so this page is served
 * under the pane's HTTPS origin; in production the pane ships from the Next app
 * itself, so it is the same origin outright.
 *
 * The pane cannot reuse the Supabase cookie session: that cookie belongs to the
 * Cornerstone origin, and Word blocks third-party cookies. So this page hands
 * the pane an access token, which it sends as `Authorization: Bearer` to
 * `/api/addin/*`.
 */
export default function AddinAuthPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [detail, setDetail] = useState<string | null>(null)
  /** Held only for the manual fallback when the Office handoff times out. */
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        // Deliberately not gated on Office. Neither the session lookup nor the
        // role check needs it, and doing them first means a signed-out user
        // reaches the login page immediately rather than waiting on a script
        // that may never announce itself.
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (cancelled) return

        if (!session) {
          setStatus('signed-out')
          router.replace('/auth/login?redirectTo=/auth/addin')
          return
        }

        // requireAdmin re-checks the role on every request; this only avoids
        // handing a token to a pane that would 403 on its first call.
        const { data: profile } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle()
        if (cancelled) return

        if (profile?.role !== 'attorney' && profile?.role !== 'admin') {
          setStatus('forbidden')
          return
        }

        const messageParent = await resolveMessageParent(OFFICE_TIMEOUT_MS)
        if (cancelled) return

        if (!messageParent) {
          // Signed in, but the bridge back to Word never opened. The token is
          // still good, so offer it rather than stranding the attorney.
          setStatus('no-host')
          setToken(session.access_token)
          return
        }

        setStatus('handing-off')
        messageParent(
          JSON.stringify({
            type: 'cornerstone-addin-session',
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt: session.expires_at ?? null,
            email: session.user.email ?? null,
          }),
        )
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setDetail(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [router])

  const copyToken = useCallback(async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
    } catch {
      // Clipboard access can be refused in a dialog; the token is on screen
      // and selectable either way.
      setCopied(false)
    }
  }, [token])

  return (
    <>
      {/*
        Loaded for its side effect only. The page no longer depends on this
        component's onReady firing — `resolveMessageParent` polls for the
        global, so a missed load event degrades to a timed-out message rather
        than an indefinite wait.
      */}
      <Script
        src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
        strategy="afterInteractive"
      />
      <AuthShell>
        <div className="space-y-3 text-center">
          <h1 className="text-lg font-semibold">Cornerstone for Word</h1>
          <p className="text-sm text-muted-foreground">{STATUS_TEXT[status]}</p>

          {status === 'no-host' && (
            <div className="space-y-2 text-left">
              <p className="text-sm text-muted-foreground">
                You are signed in, but this window could not hand the session back to Word.
                Close it and try <strong>Sign in</strong> again, or paste this token into the
                pane:
              </p>
              <textarea
                readOnly
                value={token ?? ''}
                onFocus={event => event.currentTarget.select()}
                aria-label="Access token"
                className="h-24 w-full rounded border p-2 font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={() => void copyToken()}
                className="rounded border px-3 py-1 text-sm"
              >
                {copied ? 'Copied' : 'Copy token'}
              </button>
            </div>
          )}

          {status === 'error' && detail && (
            <p className="text-sm text-red-600">{detail}</p>
          )}
        </div>
      </AuthShell>
    </>
  )
}
