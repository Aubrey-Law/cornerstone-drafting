'use client'

import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MatterIntakeActionsCardProps {
  sendingIntake: boolean
  intakeUrl: string | null
  onSendIntake: () => void
  onCopyIntakeUrl: () => void
}

export function MatterIntakeActionsCard({
  sendingIntake,
  intakeUrl,
  onSendIntake,
  onCopyIntakeUrl,
}: MatterIntakeActionsCardProps) {
  const intakeSent = Boolean(intakeUrl)

  return (
    <div id="matter-intake-actions" className="scroll-mt-24 rounded-lg border border-border bg-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Intake</h3>
        <p className="text-xs text-muted-foreground">
          Send or resend the client questionnaire link. Edit, import, or unlock intake from the header menu.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onSendIntake}
          disabled={sendingIntake}
        >
          <Send className="h-3.5 w-3.5" />
          {sendingIntake ? 'Sending…' : intakeSent ? 'Resend intake' : 'Send intake'}
        </Button>
        {intakeUrl && (
          <Button type="button" size="sm" variant="outline" onClick={onCopyIntakeUrl}>
            Copy intake link
          </Button>
        )}
      </div>
      {intakeUrl && (
        <p className="mt-3 break-all rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {intakeUrl}
        </p>
      )}
    </div>
  )
}
