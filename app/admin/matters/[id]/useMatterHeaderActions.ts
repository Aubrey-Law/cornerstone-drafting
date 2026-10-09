'use client'

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { unlockIntake } from '@/app/actions/adminIntake'
import { usePushToLawmatics } from '@/hooks/usePushToLawmatics'
import { usePushToStatular } from '@/hooks/usePushToStatular'
import { matterStatusLabel, type MatterStatus, type PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * The record-level actions the matter header's menu and the Details panel's
 * administrative settings reach: unlock intake, delete (with the typed DELETE
 * escalation for protected matters), status, engagement send/draft, and the
 * Lawmatics/Statular pushes. Dialog state lives here; MatterDialogs renders it.
 */
export function useMatterHeaderActions({ matter, setMatter, setMatterDetails, token, liveIntakeId, setIntakeCompleted }: {
  matter: PipelineMatter
  setMatter: Dispatch<SetStateAction<PipelineMatter>>
  setMatterDetails: Dispatch<SetStateAction<MatterDetailsRow | null>>
  token: string | null
  liveIntakeId: string | null
  setIntakeCompleted: (completed: boolean) => void
}) {
  const router = useRouter()
  const matterId = matter.matter_id

  const { push: pushToLawmatics, pushing: pushingToLawmatics } = usePushToLawmatics(liveIntakeId)
  const { push: pushToStatular, pushing: pushingToStatular } = usePushToStatular(liveIntakeId)

  const [unlocking, setUnlocking] = useState(false)
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false)

  const handleUnlockIntake = useCallback(() => {
    if (!liveIntakeId || unlocking) return
    setUnlockConfirmOpen(true)
  }, [liveIntakeId, unlocking])

  const confirmUnlockIntake = useCallback(async () => {
    if (!liveIntakeId || unlocking) return
    setUnlockConfirmOpen(false)
    setUnlocking(true)
    try {
      await unlockIntake({ intakeId: liveIntakeId, matterId })
      setIntakeCompleted(false)
      toast.success('Intake unlocked for client editing')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not unlock intake')
    } finally {
      setUnlocking(false)
    }
  }, [liveIntakeId, matterId, router, setIntakeCompleted, unlocking])

  const [statusSaving, setStatusSaving] = useState(false)
  const handleStatusChange = async (status: MatterStatus) => {
    if (!token || status === (matter.status ?? 'active')) return
    setStatusSaving(true)
    const previous = matter.status
    setMatter(m => ({ ...m, status }))
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not update status')
      toast.success(`Matter ${matterStatusLabel(status).toLowerCase()}`)
      router.refresh()
    } catch (e) {
      setMatter(m => ({ ...m, status: previous }))
      toast.error(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusSaving(false)
    }
  }

  const [sendingEngagement, setSendingEngagement] = useState(false)
  const handleSendEngagement = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSendingEngagement(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/engagement`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not send engagement')
      if (body.row) {
        setMatterDetails(prev => ({ ...(prev ?? {}), ...(body.row as MatterDetailsRow) }))
      }
      toast.success(`Engagement sent to ${matter.client_email ?? 'the client'}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send engagement')
    } finally {
      setSendingEngagement(false)
    }
  }

  const handleDraftEngagement = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSendingEngagement(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/engagement-draft`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not open engagement draft')
      router.push(`/admin/engagements/${body.agreementId}?step=design`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open engagement draft')
    } finally {
      setSendingEngagement(false)
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Set when the server refuses a first-click delete because the matter is
  // hired or carries a signed engagement. Holds its reasons so the dialog can
  // name what is about to be destroyed instead of repeating a generic warning.
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const handleDeleteMatter = async (confirm = false) => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        requiresConfirmation?: boolean
      }
      // Not a failure — the matter is protected and the dialog escalates to a
      // typed confirmation rather than sending the attorney back to the menu.
      if (!res.ok && body.requiresConfirmation) {
        setDeleteWarning(body.error ?? 'This matter holds client records.')
        setDeleteConfirmText('')
        return
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not delete matter')
      toast.success('Matter deleted')
      setDeleteOpen(false)
      router.push('/admin/matters')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete matter')
    } finally {
      setDeleting(false)
    }
  }

  const [mergeOpen, setMergeOpen] = useState(false)

  const closeDeleteDialog = () => {
    setDeleteOpen(false)
    setDeleteWarning(null)
    setDeleteConfirmText('')
  }

  return {
    pushToLawmatics, pushingToLawmatics, pushToStatular, pushingToStatular,
    unlocking, unlockConfirmOpen, setUnlockConfirmOpen, handleUnlockIntake, confirmUnlockIntake,
    statusSaving, handleStatusChange,
    sendingEngagement, handleSendEngagement, handleDraftEngagement,
    deleteDialog: {
      open: deleteOpen, deleting, warning: deleteWarning, confirmText: deleteConfirmText,
      setConfirmText: setDeleteConfirmText,
      openDialog: () => setDeleteOpen(true),
      close: closeDeleteDialog,
      submit: (confirm: boolean) => handleDeleteMatter(confirm),
    },
    mergeDialog: {
      open: mergeOpen,
      setOpen: setMergeOpen,
      openDialog: () => setMergeOpen(true),
    },
  }
}

export type MatterDeleteDialogState = ReturnType<typeof useMatterHeaderActions>['deleteDialog']
export type MatterMergeDialogState = ReturnType<typeof useMatterHeaderActions>['mergeDialog']
