/**
 * Pane-side sign-in.
 *
 * The token lives in `localStorage`, not `Office.context.document.settings`.
 * Document settings are embedded in the .docx itself, so a token stored there
 * would travel with the file on a Save As or an email — and would be scoped to
 * one document when the attorney's session is not.
 */

const STORAGE_KEY = 'cornerstone.addin.session.v1'

/** The dialog and this module agree on this discriminator. */
const HANDOFF_TYPE = 'cornerstone-addin-session'

export interface StoredSession {
  accessToken: string
  refreshToken: string | null
  /** Unix seconds, as Supabase reports it. */
  expiresAt: number | null
  email: string | null
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    return typeof parsed?.accessToken === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function storeSession(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Private-mode or quota failure: the pane still works for this session,
    // it just asks to sign in again next time.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing useful to do */
  }
}

/**
 * How long to wait for the dialog to say anything at all.
 *
 * `displayDialogAsync` succeeding only means the dialog opened. If it is then
 * blocked, or closed by something that fires no event, neither handler below
 * ever runs — and without this the promise stays pending forever, taking
 * whatever awaited it down with it.
 */
const DIALOG_TIMEOUT_MS = 180_000

/**
 * Open the Office dialog and resolve once it hands back a session.
 *
 * `displayInIframe: false` is kept deliberately. The dialog needs its own
 * browsing context to call `messageParent`, and an iframed dialog is
 * origin-restricted in ways that have cost this feature several rounds already.
 */
export function signIn(): Promise<StoredSession> {
  return new Promise((resolve, reject) => {
    // Served by the add-in itself, alongside taskpane.html — not by Next.
    //
    // It was `/auth/addin`, a Next page proxied into this origin, and it never
    // completed a sign-in: its client bundle did not execute in Word's WebView,
    // so the page froze on its server-rendered first paint. `dialog.html` is a
    // plain Vite entry with no SSR, no hydration and no /_next dependency.
    const url = `${window.location.origin}/dialog.html`

    Office.context.ui.displayDialogAsync(
      url,
      { height: 60, width: 40, displayInIframe: false },
      (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error(result.error?.message ?? 'Could not open the sign-in window.'))
          return
        }

        const dialog = result.value
        let settled = false

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          try {
            dialog.close()
          } catch {
            // Already gone; nothing to close.
          }
          reject(new Error('The sign-in window did not respond. Try again.'))
        }, DIALOG_TIMEOUT_MS)

        const finish = (outcome: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          outcome()
        }

        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (event) => {
          const message = (event as { message?: string }).message
          let payload: Partial<StoredSession> & { type?: string }
          try {
            payload = JSON.parse(message ?? '')
          } catch {
            return
          }
          if (payload.type !== HANDOFF_TYPE || !payload.accessToken) return

          finish(() => {
            const session: StoredSession = {
              accessToken: payload.accessToken!,
              refreshToken: payload.refreshToken ?? null,
              expiresAt: payload.expiresAt ?? null,
              email: payload.email ?? null,
            }
            storeSession(session)
            dialog.close()
            resolve(session)
          })
        })

        dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
          // Fires when the attorney closes the dialog themselves. Only an
          // error if they closed it before signing in — the guard in `finish`
          // keeps a late event from rejecting an already-resolved promise.
          finish(() => reject(new Error('Sign-in was cancelled.')))
        })
      },
    )
  })
}
