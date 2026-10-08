'use client'

import { useCallback, useEffect, useState } from 'react'
import { resolveMatterIntake, markIntakeUploadsReviewed, markPortalUploadsReviewed } from '@/app/actions/adminIntake'
import { mergeUnreviewedCounts, type UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'

/**
 * The matter's intake: which intake row is live, whether it is submitted, the
 * staff intake sheet and import dialog, and the unreviewed-upload counts that
 * opening the sheet (or reviewing portal uploads) clears.
 */
export function useMatterIntake({ matterId, initialIntakeId, initiallyCompleted, initialUploadCounts }: {
  matterId: string
  initialIntakeId: string | null
  initiallyCompleted: boolean
  initialUploadCounts: UnreviewedUploadCounts
}) {
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialIntakeId)
  const [intakeCompleted, setIntakeCompleted] = useState(initiallyCompleted)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [uploadCounts, setUploadCounts] = useState(initialUploadCounts)

  useEffect(() => { setLiveIntakeId(initialIntakeId) }, [initialIntakeId])
  useEffect(() => { setUploadCounts(initialUploadCounts) }, [initialUploadCounts])

  const markIntakeReviewed = useCallback(async (intakeId: string) => {
    try {
      await markIntakeUploadsReviewed({ intakeId, matterId })
      setUploadCounts(prev => mergeUnreviewedCounts(0, prev.portal))
    } catch {
      /* non-blocking */
    }
  }, [matterId])

  const markPortalReviewed = useCallback(async () => {
    try {
      await markPortalUploadsReviewed({ matterId })
      setUploadCounts(prev => mergeUnreviewedCounts(prev.intake, 0))
    } catch {
      /* non-blocking */
    }
  }, [matterId])

  const openSheet = useCallback(async () => {
    const open = async (intakeId: string | null) => {
      if (intakeId) await markIntakeReviewed(intakeId)
      setSheetOpen(true)
    }
    if (liveIntakeId) {
      await open(liveIntakeId)
      return
    }
    try {
      const resolved = await resolveMatterIntake(matterId)
      if (resolved) {
        setLiveIntakeId(resolved)
        await open(resolved)
      } else {
        await open(null)
      }
    } catch {
      await open(null)
    }
  }, [markIntakeReviewed, liveIntakeId, matterId])

  return {
    liveIntakeId, setLiveIntakeId, intakeCompleted, setIntakeCompleted,
    sheetOpen, setSheetOpen, importOpen, setImportOpen,
    uploadCounts, markPortalReviewed, openSheet,
  }
}
