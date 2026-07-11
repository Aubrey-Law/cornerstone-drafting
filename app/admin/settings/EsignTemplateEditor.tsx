'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'

const EDITOR_SCRIPT_SRC =
  'https://api.firma.dev/functions/v1/embed-proxy/template-editor.js'

interface FirmaTemplateEditorInstance {
  destroy?: () => void
}

interface FirmaTemplateEditorOptions {
  container: HTMLElement
  jwt: string
  templateId: string
  theme?: 'light' | 'dark'
  readOnly?: boolean
  width?: string
  height?: string
  showCloseButton?: boolean
  onSave?: (data: unknown) => void
  onClose?: (data: { hasUnsavedChanges?: boolean }) => void
  onError?: (error: unknown) => void
  onLoad?: (template: unknown) => void
}

declare global {
  interface Window {
    FirmaTemplateEditor?: new (
      options: FirmaTemplateEditorOptions,
    ) => FirmaTemplateEditorInstance
  }
}

type Status =
  | { kind: 'loading' }
  | { kind: 'unconfigured'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; token: string; templateId: string }

/**
 * Embeds the firma.dev template editor for the engagement agreement. A backend
 * route (`/api/admin/esign/template-token`) mints a short-lived JWT with the
 * firma API key; the browser only ever sees that token.
 */
export function EsignTemplateEditor() {
  const authToken = useAccessToken()
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<FirmaTemplateEditorInstance | null>(null)

  // Fetch the per-template JWT once we have an auth token.
  useEffect(() => {
    if (!authToken) return
    let cancelled = false
    setStatus({ kind: 'loading' })
    void (async () => {
      try {
        const res = await fetch('/api/admin/esign/template-token', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        })
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.status === 501) {
          setStatus({ kind: 'unconfigured', message: body.error ?? 'E-signature is not configured.' })
          return
        }
        if (!res.ok || typeof body.token !== 'string') {
          setStatus({ kind: 'error', message: body.error ?? 'Could not load the template editor.' })
          return
        }
        setStatus({ kind: 'ready', token: body.token, templateId: body.templateId })
      } catch (e) {
        if (cancelled) return
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the template editor.' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authToken])

  // Load the firma editor library — only once we have a token to render (avoid
  // reaching out to api.firma.dev when e-sign is unconfigured).
  useEffect(() => {
    if (status.kind !== 'ready') return
    if (window.FirmaTemplateEditor) {
      setScriptLoaded(true)
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${EDITOR_SCRIPT_SRC}"]`,
    )
    if (existing) {
      if (window.FirmaTemplateEditor) setScriptLoaded(true)
      else existing.addEventListener('load', () => setScriptLoaded(true), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = EDITOR_SCRIPT_SRC
    script.async = true
    script.onload = () => setScriptLoaded(true)
    script.onerror = () =>
      setStatus({ kind: 'error', message: 'Failed to load the firma.dev editor script.' })
    document.body.appendChild(script)
  }, [status.kind])

  // Instantiate the editor once the library and token are both ready.
  useEffect(() => {
    if (status.kind !== 'ready' || !scriptLoaded) return
    const container = containerRef.current
    const Editor = window.FirmaTemplateEditor
    if (!container || !Editor) return

    editorRef.current = new Editor({
      container,
      jwt: status.token,
      templateId: status.templateId,
      // Default to light; can be wired to the app theme later if desired.
      theme: 'light',
      width: '100%',
      height: '80vh',
      onSave: () => toast.success('Template saved'),
      onError: (error) => {
        console.error('[firma template editor]', error)
        toast.error('The template editor reported an error.')
      },
    })

    return () => {
      editorRef.current?.destroy?.()
      editorRef.current = null
    }
  }, [status, scriptLoaded])

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Engagement agreement template</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Edit the firma.dev engagement-agreement template — the document and where the
          signature and date fields sit — without leaving Cornerstone. Changes save
          directly to firma.dev and apply to future engagement sends.
        </p>
      </div>

      {status.kind === 'loading' && (
        <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
        </div>
      )}

      {status.kind === 'unconfigured' && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          {status.message} Set <code>FIRMA_API_KEY</code> and{' '}
          <code>FIRMA_ENGAGEMENT_TEMPLATE_ID</code> to enable in-app template editing.
        </p>
      )}

      {status.kind === 'error' && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-amber">
          {status.message}
        </p>
      )}

      <div
        ref={containerRef}
        className={status.kind === 'ready' ? 'w-full' : 'hidden'}
      />
    </section>
  )
}
