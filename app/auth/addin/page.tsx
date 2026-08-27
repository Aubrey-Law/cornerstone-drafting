'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { supabase } from '@/lib/supabaseClient'
import { AuthShell } from '@/components/layout/AuthShell'

type Status = 'checking' | 'signed-out' | 'handing-off' | 'no-host' | 'forbidden'

/**
 * The slice of Office.js this page uses.
 *
 * Declared locally rather than pulling `@types/office-js` into the Next app:
 * this is the only file in the web app that touches Office, and the runtime
 * arrives from Microsoft's CDN at load time either way.
 */
interface OfficeGlobal {
  onReady: (callback: () => void) => void
  context?: { ui?: { messageParent?: (message: string) => void } }
}

function getOffice(): OfficeGlobal | null {
  return (globalThis as { Office?: OfficeGlobal }).Office ?? null
}

/**
 * The Word add-in's sign-in dialog.
 *
 * Office dialogs can only talk to their opener through `messageParent`, and
 * only from a page on the add-in's own origin. In dev the pane's Vite server
 * proxies `/auth` and `/_next` through to Cornerstone, so this page is served
 * under the pane's HTTPS origin; in production the pane ships from the Next app
 * itself, so it is the same origin outright. Either way the dialog is
 * same-origin with the pane — which is what lets this work without punching a
 * CORS hole or registering an extra AppDomain.
 *
 * The pane cannot reuse the Supabase cookie session: that cookie belongs to the
 * Cornerstone origin, and Word blocks third-party cookies. So this page hands
 * the pane an access token, which it sends as `Authorization: Bearer` to
 * `/api/addin/*`.
 */
export default function AddinAuthPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [officeReady, setOfficeReady] = useState(false)

  useEffect(() => {
    if (!officeReady) return
    let cancelled = false

    void (async () => {
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

      const messageParent = getOffice()?.context?.ui?.messageParent
      if (typeof messageParent !== 'function') {
        // Opened in an ordinary browser tab rather than by the pane.
        setStatus('no-host')
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
    })()

    return () => {
      cancelled = true
    }
  }, [officeReady, router])

  return (
    <>
      <Script
        src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
        strategy="afterInteractive"
        onReady={() => getOffice()?.onReady(() => setOfficeReady(true))}
      />
      <AuthShell>
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold">Cornerstone for Word</h1>
          <p className="text-sm text-muted-foreground">
            {status === 'checking' && 'Checking your session…'}
            {status === 'signed-out' && 'Redirecting you to sign in…'}
            {status === 'handing-off' && 'Signed in. Returning to Word…'}
            {status === 'forbidden' && 'This account does not have firm access.'}
            {status === 'no-host' && 'Open this page from the Cornerstone task pane in Word.'}
          </p>
        </div>
      </AuthShell>
    </>
  )
}
