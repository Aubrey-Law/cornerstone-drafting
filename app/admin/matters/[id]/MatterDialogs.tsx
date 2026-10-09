'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SendSchedulingLinkDialog } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BookingPageDialog } from '@/components/scheduling/BookingPageDialog'
import { ScheduleAppointmentDialog } from '@/components/scheduling/ScheduleAppointmentDialog'
import { CommunicationDialog } from '@/components/comms/CommunicationDialog'
import { stageLabel, type PipelineMatter } from '@/types/database'
import { MergeRecordDialog } from '@/components/matter/MergeRecordDialog'
import type { MatterDeleteDialogState, MatterMergeDialogState } from './useMatterHeaderActions'
import type { StageLifecyclePreflight } from './useMatterStage'
import type { LinkedMatterNote } from './tabs/notes'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('./ImportIntakeDialog'), { ssr: false })

export interface MatterIntakeDialogsState {
  importOpen: boolean
  setImportOpen: (open: boolean) => void
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  liveIntakeId: string | null
  setLiveIntakeId: (id: string | null) => void
  setIntakeCompleted: (completed: boolean) => void
  clientUserId: string | null
  practiceArea: string
}

/** Every dialog and sheet the matter page opens; state is owned by the page's hooks. */
export function MatterDialogs({ matter, token, intake, deleteDialog, mergeDialog, unlock, stage, leadNoteDelete, scheduling, composer }: {
  matter: PipelineMatter
  token: string | null
  intake: MatterIntakeDialogsState
  deleteDialog: MatterDeleteDialogState
  mergeDialog: MatterMergeDialogState
  unlock: { open: boolean; setOpen: (open: boolean) => void; confirm: () => void | Promise<void> }
  stage: {
    preflight: StageLifecyclePreflight | null
    setPreflight: (preflight: StageLifecyclePreflight | null) => void
    saving: boolean
    confirm: (preflight: StageLifecyclePreflight) => void
  }
  /** Matter page only: the lead-note delete confirmation. */
  leadNoteDelete?: { target: LinkedMatterNote | null; setTarget: (note: LinkedMatterNote | null) => void; confirm: (note: LinkedMatterNote) => void | Promise<void> }
  /** Matter page only: the scheduling-link, book-for-client and in-app appointment dialogs. */
  scheduling?: {
    linkOpen: boolean
    setLinkOpen: (open: boolean) => void
    bookOpen: boolean
    setBookOpen: (open: boolean) => void
    appointmentOpen: boolean
    setAppointmentOpen: (open: boolean) => void
  }
  composer: { channel: 'email' | 'sms' | null; setChannel: (channel: 'email' | 'sms' | null) => void }
}) {
  const router = useRouter()
  const matterId = matter.matter_id
  const matterLabel = matter.client_name || matter.matter_name || 'this matter'
  // The booking form splits these for an instant prefill, then loads the stored first/last names.
  const appointmentAttendee = useMemo(() => ({
    firstName: matter.client_name,
    email: matter.client_email,
    phone: matter.client_phone,
    secondFirstName: matter.spouse_name,
    secondEmail: matter.spouse_email,
  }), [matter.client_name, matter.client_email, matter.client_phone, matter.spouse_name, matter.spouse_email])

  return (
    <>
      <MergeRecordDialog
        matterId={matterId}
        recordLabel="matter"
        open={mergeDialog.open}
        onOpenChange={mergeDialog.setOpen}
      />
      <ImportIntakeDialog
        open={intake.importOpen}
        onOpenChange={intake.setImportOpen}
        accessToken={token}
        parseTextUrl={`/api/admin/matters/${matterId}/parse-intake`}
        parseDocxUrl={`/api/admin/matters/${matterId}/parse-intake-docx`}
        onParsed={(parsedIntakeId) => {
          intake.setLiveIntakeId(parsedIntakeId)
          intake.setIntakeCompleted(false)
          intake.setImportOpen(false)
          intake.setSheetOpen(true)
          router.refresh()
        }}
      />

      {intake.sheetOpen && (
        <AdminIntakeSheet
          leadId={null}
          matterId={matterId}
          clientIntakeId={intake.liveIntakeId}
          clientUserId={intake.clientUserId}
          practiceArea={intake.practiceArea}
          clientName={matter.client_name || matter.matter_name || 'Client'}
          open={intake.sheetOpen}
          onClose={() => intake.setSheetOpen(false)}
          onIntakeIdChange={intake.setLiveIntakeId}
          onSubmitted={() => {
            intake.setIntakeCompleted(true)
            intake.setSheetOpen(false)
            router.refresh()
          }}
        />
      )}

      {scheduling && <>
        <SendSchedulingLinkDialog
          target={{ kind: 'matter', id: matterId }}
          open={scheduling.linkOpen}
          onOpenChange={scheduling.setLinkOpen}
        />

        <BookingPageDialog
          target={{ kind: 'matter', id: matterId }}
          open={scheduling.bookOpen}
          onOpenChange={scheduling.setBookOpen}
          onBooked={() => router.refresh()}
        />

        <ScheduleAppointmentDialog
          target={{ kind: 'matter', id: matterId }}
          attendee={appointmentAttendee}
          open={scheduling.appointmentOpen}
          onOpenChange={scheduling.setAppointmentOpen}
          onBooked={() => router.refresh()}
        />
      </>}

      <Dialog open={deleteDialog.open} onOpenChange={open => (open ? deleteDialog.openDialog() : deleteDialog.close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete matter?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{matterLabel}</span>,
              including intake, documents, design sheet, messages, and activity. This cannot be undone.
              Closing or archiving the matter keeps all of it.
            </DialogDescription>
          </DialogHeader>
          {deleteDialog.warning && (
            <div className="space-y-3">
              <p className="rounded-md border border-red-strong-border bg-red-strong-bg p-3 text-sm text-red-strong">
                {deleteDialog.warning}
              </p>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">
                  Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
                </span>
                <Input
                  autoFocus
                  value={deleteDialog.confirmText}
                  onChange={event => deleteDialog.setConfirmText(event.target.value)}
                  aria-label="Type DELETE to confirm"
                  placeholder="DELETE"
                />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={deleteDialog.close} disabled={deleteDialog.deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteDialog.submit(deleteDialog.warning !== null)}
              disabled={deleteDialog.deleting || (deleteDialog.warning !== null && deleteDialog.confirmText.trim() !== 'DELETE')}
            >
              {deleteDialog.deleting ? 'Deleting…' : deleteDialog.warning ? 'Permanently delete' : 'Delete matter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {leadNoteDelete && (
        <AlertDialog open={leadNoteDelete.target !== null} onOpenChange={open => !open && leadNoteDelete.setTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this note?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const note = leadNoteDelete.target
                  leadNoteDelete.setTarget(null)
                  if (note) void leadNoteDelete.confirm(note)
                }}
              >
                Delete note
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <AlertDialog open={unlock.open} onOpenChange={unlock.setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-open the submitted intake?</AlertDialogTitle>
            <AlertDialogDescription>
              The client will be able to edit and resubmit their intake questionnaire.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void unlock.confirm()}>Unlock intake</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={stage.preflight !== null}
        onOpenChange={open => { if (!open && !stage.saving) stage.setPreflight(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Advance with open lifecycle blockers?</AlertDialogTitle>
            <AlertDialogDescription>
              Cornerstone found the following requirements before {stage.preflight ? stageLabel(stage.preflight.stage) : 'the selected stage'}.
              The stage has not changed. Confirm only if you have reviewed these exceptions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {(stage.preflight?.blockers ?? []).map(blocker => (
              <li key={blocker.key} className="rounded-md border p-2">
                <span className="font-medium">{blocker.label}</span>
                <span className="ml-1 text-muted-foreground">· {blocker.owner.replaceAll('_', ' ')}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stage.saving}>Keep current stage</AlertDialogCancel>
            <AlertDialogAction
              disabled={stage.saving || !stage.preflight}
              onClick={event => {
                event.preventDefault()
                if (stage.preflight) stage.confirm(stage.preflight)
              }}
            >
              {stage.saving ? 'Updating…' : 'Confirm exception and advance'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CommunicationDialog
        open={composer.channel !== null}
        channel={composer.channel ?? 'email'}
        target={{ type: 'matter', id: matterId, recipient: 'client' }}
        recipientName={matter.client_name ?? 'Client'}
        recipientEmail={matter.client_email ?? null}
        recipientPhone={matter.client_phone ?? null}
        token={token}
        onOpenChange={open => { if (!open) composer.setChannel(null) }}
        onSent={() => {
          toast.success(composer.channel === 'sms' ? 'Text sent' : 'Email sent')
          router.refresh()
        }}
      />
    </>
  )
}
