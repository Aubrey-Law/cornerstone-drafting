'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, RefreshCw, Send, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'

interface IntakeSyncStatusCardProps {
  matterId: string
  intakeCompleted: boolean
  designSheetSeeded: boolean
  reviewFlags: IntakeReadinessFlag[]
  resyncPreviewCount: number
  sendingIntake: boolean
  intakeUrl: string | null
  onSendIntake: () => void
  onCopyIntakeUrl: () => void
}

export function IntakeSyncStatusCard({
  matterId,
  intakeCompleted,
  designSheetSeeded,
  reviewFlags,
  resyncPreviewCount,
  sendingIntake,
  intakeUrl,
  onSendIntake,
  onCopyIntakeUrl,
}: IntakeSyncStatusCardProps) {
  const [open, setOpen] = useState(!designSheetSeeded || reviewFlags.length > 0)
  const [resyncing, setResyncing] = useState(false)

  const needsAttention = !designSheetSeeded || reviewFlags.length > 0

  const handleResyncAll = async () => {
    setResyncing(true)
    try {
      const previewRes = await fetch(`/api/admin/matters/${matterId}/design-sheet/resync-intake`)
      const previewBody = await previewRes.json().catch(() => ({}))
      if (!previewRes.ok) throw new Error(previewBody.error ?? 'Could not load resync preview')

      const fields = (Array.isArray(previewBody.preview) ? previewBody.preview : [])
        .filter((f: { selected?: boolean; blocked?: boolean }) => f.selected !== false && !f.blocked)
        .map((f: { field: string }) => f.field)

      if (fields.length === 0) {
        toast.message('Nothing to re-sync from intake')
        return
      }

      const res = await fetch(`/api/admin/matters/${matterId}/design-sheet/resync-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Re-sync failed')
      toast.success(`Re-synced ${fields.length} field${fields.length === 1 ? '' : 's'} from intake`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Re-sync failed')
    } finally {
      setResyncing(false)
    }
  }

  const intakeSent = Boolean(intakeUrl)

  return (
    <div id="matter-intake-actions" className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Intake</span>
        </span>
        {needsAttention ? (
          <span className="text-[10px] font-semibold text-amber-orange">Needs attention</span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-green">
            <CheckCircle2 className="h-3 w-3" /> Ready
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-3 px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <StatusRow
              label="Intake submitted"
              ok={intakeCompleted}
              detail={intakeCompleted ? 'Client intake is complete' : 'Waiting for client to submit intake'}
            />
            <StatusRow
              label="Design sheet seeded"
              ok={designSheetSeeded}
              detail={designSheetSeeded ? 'Design sheet populated from intake' : 'Design sheet not yet seeded from intake'}
            />
            <StatusRow
              label="Review flags"
              ok={reviewFlags.length === 0}
              detail={reviewFlags.length === 0 ? 'No readiness flags' : `${reviewFlags.length} item${reviewFlags.length === 1 ? '' : 's'} need review`}
            />
            <StatusRow
              label="Resync fields available"
              ok={resyncPreviewCount === 0}
              detail={resyncPreviewCount > 0 ? `${resyncPreviewCount} fields can be re-synced` : 'Intake and design sheet aligned'}
            />
          </div>

          {reviewFlags.length > 0 && (
            <ul className="space-y-1 pl-1">
              {reviewFlags.slice(0, 5).map(flag => (
                <li key={flag.key} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-orange" />
                  <span>{flag.message}</span>
                </li>
              ))}
              {reviewFlags.length > 5 && (
                <li className="text-[11px] text-muted-foreground">+{reviewFlags.length - 5} more</li>
              )}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onSendIntake} disabled={sendingIntake}>
              <Send className="h-3.5 w-3.5" />
              {sendingIntake ? 'Sending…' : intakeSent ? 'Resend intake' : 'Send intake'}
            </Button>
            {intakeUrl && (
              <Button type="button" size="sm" variant="outline" onClick={onCopyIntakeUrl}>
                Copy intake link
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" disabled={resyncing} onClick={() => void handleResyncAll()}>
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', resyncing && 'animate-spin')} />
              Re-sync from intake
            </Button>
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link href={`/admin/drafting/${matterId}?step=design`}>Open design sheet</Link>
            </Button>
          </div>

          {intakeUrl && (
            <p className="break-all text-[11px] text-muted-foreground">{intakeUrl}</p>
          )}
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-orange" />
      )}
      <div>
        <span className="text-xs font-medium">{label}</span>
        <p className="text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
