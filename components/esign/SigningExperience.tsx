'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * What a client sees when they open their signing link.
 *
 * Two things are deliberate. The consent checkbox gates the signature rather
 * than sitting beside it, because an ESIGN signature without recorded consent
 * is not the thing the firm needs to be able to show. And declining is a
 * first-class button, not a way of closing the tab: a client who does not want
 * to sign should be able to say so and have the firm find out.
 *
 * Declining is also final and asks before it fires. The server marks the
 * session `declined` and every later visit to the link gets a 410, so a client
 * who declines by accident cannot undo it from here — they have to telephone
 * the firm. That is worth one dialog.
 */

type Loaded = {
  documentUrl: string
  signer: { name: string; email: string }
  consentText: string
  /** 'engagement' or 'document'; absent from older responses, read as an engagement. */
  kind?: 'engagement' | 'document'
  /** "engagement agreement", or the document's own name. */
  label?: string
}

type Outcome = 'signed' | 'declined'

export interface SigningExperienceProps {
  /**
   * The route this page talks to: `/api/sign/<token>` from an emailed link,
   * `/api/documents/sign/<sessionId>` from inside the portal. Same shape,
   * same flow behind it; only the credential differs.
   */
  endpoint: string
  /** Send the signed-in client's bearer token (the portal door); the token door needs none. */
  withSession?: boolean
  /** Rendered inside the portal shell rather than as its own page. */
  embedded?: boolean
  /** Where to go once signed or declined, when there is somewhere to go. */
  doneHref?: string
}

async function sessionHeaders(withSession: boolean): Promise<Record<string, string>> {
  if (!withSession) return {}
  const { supabase } = await import('@/lib/supabaseClient')
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export function SigningExperience({ endpoint, withSession = false, embedded = false, doneHref }: SigningExperienceProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [mode, setMode] = useState<'typed' | 'drawn'>('typed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [declineOpen, setDeclineOpen] = useState(false)
  // Kept when the dialog closes rather than cleared, so backing out and
  // reopening does not throw away what the client had already written.
  const [declineReason, setDeclineReason] = useState('')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // State, not a ref: the Sign button's enabled-ness depends on this, and a
  // ref would leave it disabled after the client had already drawn.
  const [hasDrawing, setHasDrawing] = useState(false)
  const strokeOpenRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(endpoint, { headers: await sessionHeaders(withSession) })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'This signing link could not be opened')
        if (!cancelled) setLoaded(body as Loaded)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'This signing link could not be opened')
      }
    })()
    return () => { cancelled = true }
  }, [endpoint, withSession])

  const pointTo = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return null
    const rect = canvas.getBoundingClientRect()
    return {
      context,
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    }
  }, [])

  const startStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointTo(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    point.context.beginPath()
    point.context.moveTo(point.x, point.y)
    strokeOpenRef.current = true
    setHasDrawing(true)
  }, [pointTo])

  const extendStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    // Each press starts its own path. Without that, lifting the pen and
    // starting again draws a straight line between the two, which turns a
    // two-stroke signature into a scribble.
    if (!strokeOpenRef.current || event.buttons !== 1) return
    const point = pointTo(event)
    if (!point) return
    point.context.lineWidth = 2
    point.context.lineCap = 'round'
    point.context.strokeStyle = '#111'
    point.context.lineTo(point.x, point.y)
    point.context.stroke()
  }, [pointTo])

  function clearDrawing() {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    strokeOpenRef.current = false
    setHasDrawing(false)
  }

  async function submit(action: 'sign' | 'decline', reason?: string) {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { action }
      if (action === 'sign') {
        payload.consentAccepted = consent
        if (mode === 'drawn' && hasDrawing && canvasRef.current) {
          payload.signaturePngBase64 = canvasRef.current.toDataURL('image/png')
        } else {
          payload.typedName = typedName.trim()
        }
      } else {
        const trimmed = reason?.trim()
        if (trimmed) payload.declineReason = trimmed
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await sessionHeaders(withSession)) },
        body: JSON.stringify(payload),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not complete this action')
      setOutcome(body.outcome as Outcome)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete this action')
    } finally {
      setBusy(false)
    }
  }

  // The page is its own document from an emailed link and a panel inside the
  // portal shell otherwise; the shell already supplies the frame and the serif.
  const Wrapper = embedded ? 'div' : 'main'
  const narrow = embedded ? 'mx-auto max-w-lg py-8 text-center' : 'client-root mx-auto max-w-lg p-8 text-center'
  // What is being signed, in the words the buttons and headings use. An
  // uploaded document is named by its own title; an agreement stays "agreement".
  const noun = loaded?.kind === 'document' ? 'document' : 'agreement'
  const title = loaded?.kind === 'document'
    ? (loaded.label?.trim() || 'Document to sign')
    : 'Your engagement agreement'

  if (loadError) {
    return (
      <Wrapper className={narrow}>
        <h1 className="text-lg font-semibold text-foreground">This link cannot be opened</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          Please contact the firm if you believe this is a mistake.
        </p>
        {doneHref && (
          <Button asChild size="sm" variant="outline" className="mt-5">
            <a href={doneHref}>Back to documents</a>
          </Button>
        )}
      </Wrapper>
    )
  }

  if (outcome) {
    return (
      <Wrapper className={narrow}>
        <h1 className="text-lg font-semibold text-foreground">
          {outcome === 'signed' ? `Thank you — your ${noun} is signed` : `You have declined this ${noun}`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {outcome === 'signed'
            ? 'A copy has been saved to your matter. The firm has been notified.'
            : 'The firm has been notified and will be in touch.'}
        </p>
        {doneHref && (
          <Button asChild size="sm" className="mt-5">
            <a href={doneHref}>Back to documents</a>
          </Button>
        )}
      </Wrapper>
    )
  }

  if (!loaded) {
    return <Wrapper className={cn(narrow, 'text-left text-sm text-muted-foreground')}>Loading your {noun}…</Wrapper>
  }

  const canSign = consent && (mode === 'drawn' ? hasDrawing : typedName.trim().length > 0)

  return (
    <Wrapper className={embedded ? 'space-y-5' : 'client-root mx-auto max-w-3xl space-y-5 p-4 md:p-8'}>
      <header>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {loaded.signer.name ? `Prepared for ${loaded.signer.name}. ` : ''}
          Please read the {noun} before signing.
        </p>
      </header>

      {/* The document itself, not a summary of it — the client signs what they
          can see, and it is the same PDF the firm stores. */}
      <iframe
        src={loaded.documentUrl}
        title={title}
        className="h-[60vh] w-full rounded-lg border border-border bg-card"
      />

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-2">
          <Checkbox
            id="esign-consent"
            checked={consent}
            onCheckedChange={value => setConsent(value === true)}
          />
          <Label htmlFor="esign-consent" className="text-xs leading-relaxed text-muted-foreground">
            {loaded.consentText}
          </Label>
        </div>

        <div className="flex gap-2">
          <Button type="button" size="sm" variant={mode === 'typed' ? 'default' : 'outline'} onClick={() => setMode('typed')}>
            Type my signature
          </Button>
          <Button type="button" size="sm" variant={mode === 'drawn' ? 'default' : 'outline'} onClick={() => setMode('drawn')}>
            Draw my signature
          </Button>
        </div>

        {mode === 'typed' ? (
          <div className="space-y-1">
            <Label htmlFor="esign-typed" className="text-xs">Full legal name</Label>
            <Input
              id="esign-typed"
              value={typedName}
              onChange={event => setTypedName(event.target.value)}
              placeholder={loaded.signer.name || 'Your full name'}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <canvas
              ref={canvasRef}
              width={600}
              height={140}
              onPointerDown={startStroke}
              onPointerMove={extendStroke}
              onPointerUp={() => { strokeOpenRef.current = false }}
              onPointerLeave={() => { strokeOpenRef.current = false }}
              className="w-full touch-none rounded-md border border-dashed border-border bg-background"
              aria-label="Signature drawing area"
            />
            <Button type="button" size="sm" variant="ghost" onClick={clearDrawing}>Clear</Button>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-micro text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => submit('sign')} disabled={busy || !canSign}>
            Sign {noun}
          </Button>
          {/* Declining has to be as reachable as signing, or the only way out
              is to close the tab and leave the firm guessing. Reachable, but
              not instant — it opens the question below rather than firing. */}
          <Button type="button" variant="outline" onClick={() => setDeclineOpen(true)} disabled={busy}>
            Decline
          </Button>
          <span className={cn('text-micro text-muted-foreground', consent && 'sr-only')}>
            Consent is required before signing.
          </span>
        </div>
      </section>

      {/*
        One dialog that both confirms and collects the reason. The reason used
        to come from `window.prompt`, which returns null on Cancel and '' on an
        empty submit — both falsy, so both fell through to the same decline. A
        client who pressed Cancel expecting to back out declined anyway, and the
        link was dead by the time they noticed.

        Here the two answers are different buttons. Cancel, Escape and the
        overlay all close without sending anything.
      */}
      <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline this {noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone here. Your signing link stops working, and the firm
              will need to send a new one if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1">
            <Label htmlFor="esign-decline-reason" className="text-xs">
              Tell the firm why (optional)
            </Label>
            <Textarea
              id="esign-decline-reason"
              value={declineReason}
              onChange={event => setDeclineReason(event.target.value)}
              rows={3}
              placeholder="You do not have to give a reason."
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                setDeclineOpen(false)
                void submit('decline', declineReason)
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Decline {noun}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Wrapper>
  )
}
