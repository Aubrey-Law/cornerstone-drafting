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
 * Open the Office dialog and resolve once it hands back a session.
 *
 * `displayInIframe: false` is required: the dialog navigates to the Cornerstone
 * login page, which sets cookies and may redirect, and an iframed dialog is
 * both origin-restricted and blocked from doing that.
 */
export function signIn(): Promise<StoredSession> {
  return new Promise((resolve, reject) => {
    // Same origin as the pane — the dev server proxies /auth through to
    // Cornerstone, and in production the pane ships from the Next app.
    const url = `${window.location.origin}/auth/addin`

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

        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (event) => {
          const message = (event as { message?: string }).message
          let payload: Partial<StoredSession> & { type?: string }
          try {
            payload = JSON.parse(message ?? '')
          } catch {
            return
          }
          if (payload.type !== HANDOFF_TYPE || !payload.accessToken) return

          settled = true
          const session: StoredSession = {
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken ?? null,
            expiresAt: payload.expiresAt ?? null,
            email: payload.email ?? null,
          }
          storeSession(session)
          dialog.close()
          resolve(session)
        })

        dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
          // Fires when the attorney closes the dialog themselves. Only an
          // error if they closed it before signing in.
          if (!settled) reject(new Error('Sign-in was cancelled.'))
        })
      },
    )
  })
}
