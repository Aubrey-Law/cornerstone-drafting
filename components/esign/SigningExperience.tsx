'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * What a client sees when they open their signing link.
 *
 * Two things are deliberate. The consent checkbox gates the signature rather
 * than sitting beside it, because an ESIGN signature without recorded consent
 * is not the thing the firm needs to be able to show. And declining is a
 * first-class button, not a way of closing the tab: a client who does not want
 * to sign should be able to say so and have the firm find out.
 */

type Loaded = {
  documentUrl: string
  signer: { name: string; email: string }
  consentText: string
}

type Outcome = 'signed' | 'declined'

export function SigningExperience({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [mode, setMode] = useState<'typed' | 'drawn'>('typed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // State, not a ref: the Sign button's enabled-ness depends on this, and a
  // ref would leave it disabled after the client had already drawn.
  const [hasDrawing, setHasDrawing] = useState(false)
  const strokeOpenRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/sign/${encodeURIComponent(token)}`)
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'This signing link could not be opened')
        if (!cancelled) setLoaded(body as Loaded)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'This signing link could not be opened')
      }
    })()
    return () => { cancelled = true }
  }, [token])

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

  async function submit(action: 'sign' | 'decline') {
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
        const reason = window.prompt('If you would like, tell the firm why (optional):')
        if (reason) payload.declineReason = reason
      }
      const response = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  if (loadError) {
    return (
      <main className="client-root mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">This link cannot be opened</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          Please contact the firm if you believe this is a mistake.
        </p>
      </main>
    )
  }

  if (outcome) {
    return (
      <main className="client-root mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">
          {outcome === 'signed' ? 'Thank you — your agreement is signed' : 'You have declined this agreement'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {outcome === 'signed'
            ? 'A copy has been saved to your matter. The firm has been notified.'
            : 'The firm has been notified and will be in touch.'}
        </p>
      </main>
    )
  }

  if (!loaded) {
    return <main className="client-root mx-auto max-w-lg p-8 text-sm text-muted-foreground">Loading your agreement…</main>
  }

  const canSign = consent && (mode === 'drawn' ? hasDrawing : typedName.trim().length > 0)

  return (
    <main className="client-root mx-auto max-w-3xl space-y-5 p-4 md:p-8">
      <header>
        <h1 className="text-lg font-semibold text-foreground">Your engagement agreement</h1>
        <p className="text-sm text-muted-foreground">
          {loaded.signer.name ? `Prepared for ${loaded.signer.name}. ` : ''}
          Please read the agreement before signing.
        </p>
      </header>

      {/* The document itself, not a summary of it — the client signs what they
          can see, and it is the same PDF the firm stores. */}
      <iframe
        src={loaded.documentUrl}
        title="Engagement agreement"
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
            Sign agreement
          </Button>
          {/* Declining has to be as reachable as signing, or the only way out
              is to close the tab and leave the firm guessing. */}
          <Button type="button" variant="outline" onClick={() => submit('decline')} disabled={busy}>
            Decline
          </Button>
          <span className={cn('text-micro text-muted-foreground', consent && 'sr-only')}>
            Consent is required before signing.
          </span>
        </div>
      </section>
    </main>
  )
}
