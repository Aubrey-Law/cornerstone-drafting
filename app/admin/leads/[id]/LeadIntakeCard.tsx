'use client'

import { CheckCircle2, ClipboardList, Copy, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LeadIntakeCardProps {
  intakeCompleted: boolean
  intakeId: string
  intakeUrl: string | null
  sending: boolean
  onOpen: () => void
  onImport: () => void
  onSend: () => void
  onCopy: () => void
}

export function LeadIntakeCard({
  intakeCompleted,
  intakeId,
  intakeUrl,
  sending,
  onOpen,
  onImport,
  onSend,
  onCopy,
}: LeadIntakeCardProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Lead intake">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Intake</h2>
            {intakeCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-green" aria-label="Submitted" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete and review intake before hiring this lead.
          </p>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {intakeCompleted ? 'Submitted' : intakeId ? 'Draft or not submitted' : 'Not started'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onOpen}>
          {intakeCompleted ? 'Edit intake' : intakeId ? 'Update intake' : 'Fill intake'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onImport}>
          Import intake
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onSend} disabled={sending}>
          <Send className="h-3.5 w-3.5" />
          {sending ? 'Sending…' : intakeUrl ? 'Resend intake' : 'Send intake'}
        </Button>
        {intakeUrl && (
          <Button type="button" size="sm" variant="outline" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            Copy intake link
          </Button>
        )}
      </div>
      {intakeUrl && <p className="mt-3 break-all text-[11px] text-muted-foreground">{intakeUrl}</p>}
    </section>
  )
}
