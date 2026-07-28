'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LeadFieldsRail } from '@/components/leads/LeadFieldsRail'
import { LeadNextAction } from '@/components/leads/LeadNextAction'
import { LeadPlanTab } from '@/components/leads/LeadPlanTab'
import { LeadIntakeCard } from '@/app/admin/leads/[id]/LeadIntakeCard'
import { leadListName } from '@/components/leads/LeadsTable'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type { LeadEditableField } from '@/lib/leads/details'
import { computeNextAction } from '@/lib/leads/nextAction'
import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'
import type { LeadDetailRecord, LeadListRow, LeadSpouseRecord } from '@/lib/leads/viewTypes'

type LeadSidePanelProps = {
  lead: LeadListRow
  spouse: LeadSpouseRecord | null
  onClose: () => void
  onOpenFullRecord: () => void
  onOpenRowMenu: () => void
  onLeadSaved: () => void
}

const PANEL_TABS = ['home', 'plan', 'intake', 'timeline', 'notes', 'files'] as const
type PanelTab = (typeof PANEL_TABS)[number]

function EmptyTab({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center px-6 text-center">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  )
}

/** The list row already carries every field the rail edits; widen it in one place. */
function toDetailRecord(lead: LeadListRow): LeadDetailRecord {
  return { ...lead, lead_status: lead.lead_status ?? 'lead' } as unknown as LeadDetailRecord
}

export function LeadSidePanel({
  lead,
  spouse,
  onClose,
  onOpenFullRecord,
  onOpenRowMenu,
  onLeadSaved,
}: LeadSidePanelProps) {
  const token = useAccessToken()
  const [tab, setTab] = useState<PanelTab>('home')
  const [activeField, setActiveField] = useState<LeadEditableField | null>(null)
  const [spouseRemovalError, setSpouseRemovalError] = useState<string | null>(null)
  const [removeSpouseOpen, setRemoveSpouseOpen] = useState(false)
  const record = toDetailRecord(lead)
  const name = leadListName(lead)

  useEffect(() => {
    setTab('home')
    setActiveField(null)
  }, [lead.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && activeField === null) {
        onClose()
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        onOpenFullRecord()
        return
      }
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        onOpenRowMenu()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeField, onClose, onOpenFullRecord, onOpenRowMenu])

  async function saveField(field: LeadEditableField, value: unknown) {
    const response = await fetch(`/api/admin/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value }),
    })
    const json = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      const error = new Error(json.error || 'Could not save field')
      toast.error(error.message)
      throw error
    }
    onLeadSaved()
  }

  const leadDay = lead.created_at
    ? Math.max(0, calendarDayDifference(Date.now(), lead.created_at, FIRM_TIMEZONE) ?? 0)
    : 0

  const nextAction = computeNextAction({
    leadStatus: lead.lead_status ?? 'lead',
    intakeSentAt: lead.intake_sent_at,
    intakeCompletedAt: lead.intake_completed_at,
    nextAppointmentAt: null,
    feeQuoted: lead.engagement_fee_quoted,
    hasActiveAgreement: Boolean(lead.engagement_sent_at),
    lastTouchAt: lead.last_activity_at,
    timeZone: FIRM_TIMEZONE,
  })

  return (
    <aside
      aria-label={`${name} record`}
      className="sticky top-4 flex max-h-[calc(100vh-7rem)] w-[500px] shrink-0 flex-col rounded-lg border border-l border-border bg-card shadow"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-muted text-[10px] font-semibold text-muted-foreground"
        >
          {name.trim().charAt(0).toUpperCase() || '—'}
        </span>
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Lead · day {leadDay}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2"
          aria-label="Close record panel"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <Tabs
        value={tab}
        onValueChange={value => setTab(value as PanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b border-border bg-card px-2">
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="home" className="m-0 flex min-h-0 flex-col">
            {nextAction.key !== 'nothing' && nextAction.actions.length > 0 && (
              <div className="p-3 pb-0">
                <LeadNextAction
                  action={nextAction}
                  busy={false}
                  onIntent={() => onOpenFullRecord()}
                />
              </div>
            )}
            <LeadFieldsRail
              lead={record}
              spouse={spouse}
              activeField={activeField}
              onActiveFieldChange={field => {
                if (field !== 'spouse') setSpouseRemovalError(null)
                setActiveField(field)
              }}
              onSaveField={saveField}
              onRemoveSpouse={() => setRemoveSpouseOpen(true)}
              spouseRemovalError={spouseRemovalError}
              showAssistantPrompts={false}
              className="w-full border-r-0"
            />
          </TabsContent>

          <TabsContent value="plan" className="m-0 p-3">
            <LeadPlanTab
              lead={record}
              spouse={spouse}
              nextAppointmentAt={null}
              lastMeetingAt={null}
              hasActiveAgreement={Boolean(lead.engagement_sent_at)}
              agreementId={null}
              busy={false}
              onDraft={onOpenFullRecord}
              onPreviewAgreement={onOpenFullRecord}
              onOpenField={field => {
                setTab('home')
                setActiveField(field)
              }}
              onOpenIntake={onOpenFullRecord}
            />
          </TabsContent>

          <TabsContent value="intake" className="m-0 p-3">
            <LeadIntakeCard
              intake={record}
              intakeUrl={null}
              onOpen={onOpenFullRecord}
              onCopy={onOpenFullRecord}
            />
          </TabsContent>

          <TabsContent value="timeline" className="m-0">
            <EmptyTab>
              Calls, meetings and system events load on the full record — open it with ⌘↵.
            </EmptyTab>
          </TabsContent>

          <TabsContent value="notes" className="m-0">
            <EmptyTab>
              Internal notes are written and edited on the full record — open it with ⌘↵.
            </EmptyTab>
          </TabsContent>

          <TabsContent value="files" className="m-0">
            <EmptyTab>
              {lead.matter_id
                ? 'Documents live on the linked matter — open the full record to review them.'
                : 'Lead-stage files appear once an engagement is drafted or the lead becomes a matter.'}
            </EmptyTab>
          </TabsContent>
        </div>
      </Tabs>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button type="button" size="sm" variant="outline" onClick={onOpenRowMenu}>
          Options ⌘O
        </Button>
        <Button type="button" size="sm" onClick={onOpenFullRecord}>
          Open full record ⌘↵
        </Button>
      </footer>

      <AlertDialog open={removeSpouseOpen} onOpenChange={setRemoveSpouseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this spouse?</AlertDialogTitle>
            <AlertDialogDescription>
              The spouse&apos;s details entered on this lead will no longer be shown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRemoveSpouseOpen(false)
                void saveField('spouse', null)
                  .then(() => {
                    setSpouseRemovalError(null)
                    setActiveField(null)
                  })
                  .catch(caught => {
                    setSpouseRemovalError(caught instanceof Error ? caught.message : 'Could not remove spouse')
                  })
              }}
            >
              Remove spouse
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
