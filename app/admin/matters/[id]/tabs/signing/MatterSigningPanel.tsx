'use client'

import { useCallback, useEffect, useState } from 'react'
import { Printer, Signature } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Ceremony } from '@/lib/ceremony/repository'
import type { DocumentKind } from '@/lib/execution/requirements'
import { CeremonyRecord } from './CeremonyRecord'
import { ExecutionChecklist } from './ExecutionChecklist'

interface SigningView {
  kinds: DocumentKind[]
  unmatched: string[]
  ceremony: Ceremony | null
}

/**
 * The Signing view of a matter's Documents tab: what each drafted document
 * needs to be signed properly in Massachusetts, and the record of the
 * appointment. Loaded when the view opens, and again after each save.
 */
export function MatterSigningPanel({ matterId }: { matterId: string }) {
  // undefined while loading; null when the matter is not hired.
  const [view, setView] = useState<SigningView | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/signing`)
      const body = (await response.json().catch(() => ({}))) as { signing?: SigningView | null; error?: string }
      if (!response.ok || body.signing === undefined) {
        throw new Error(body.error ?? `Could not load the signing (${response.status})`)
      }
      setView(body.signing)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the signing')
    }
  }, [matterId])

  useEffect(() => {
    setView(undefined)
    void load()
  }, [load])

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (view === undefined) return <p className="text-sm text-muted-foreground">Loading the signing…</p>
  if (view === null) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={Signature}
          title="Nothing to sign yet"
          description="The signing checklist and record open once the matter is hired and has drafted documents."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4" data-testid="matter-signing">
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline">
          <a href={`/admin/matters/${encodeURIComponent(matterId)}/signing-kit`} target="_blank" rel="noreferrer">
            <Printer className="size-4" aria-hidden />
            Print signing-day kit
          </a>
        </Button>
      </div>
      {/* Keyed on the documents it was read from, so the ticks reset when the drafts change. */}
      <ExecutionChecklist
        key={[...view.kinds, ...view.unmatched].join('|')}
        detected={view.kinds}
        unmatched={view.unmatched}
      />
      <CeremonyRecord matterId={matterId} ceremony={view.ceremony} kinds={view.kinds} onSaved={() => void load()} />
    </div>
  )
}
