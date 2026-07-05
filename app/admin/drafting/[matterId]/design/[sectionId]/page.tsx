import { notFound } from 'next/navigation'
import DesignSheetShell from '../DesignSheetShell'
import { loadDraftingMatterContext } from '../../loadDraftingMatterContext'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { getDesignSectionNavItems, isValidDesignSectionId } from '@/lib/designSheet/designSectionNav'

export const dynamic = 'force-dynamic'

export default async function DesignSectionPage({
  params,
}: {
  params: Promise<{ matterId: string; sectionId: string }>
}) {
  const { matterId, sectionId } = await params
  const ctx = await loadDraftingMatterContext(matterId)
  if (!ctx.sheet) notFound()

  const documentInclusions = getDocumentInclusions({
    plan_type: ctx.sheet.plan_type,
    marital_status: ctx.sheet.marital_status ?? ctx.intakeSnapshot?.marital_status ?? null,
    decisions: ctx.sheet.decisions,
  })

  const navItems = getDesignSectionNavItems({
    intakeSnapshot: ctx.intakeSnapshot,
    documentInclusions,
  })

  if (!isValidDesignSectionId(sectionId, navItems)) {
    notFound()
  }

  return (
    <DesignSheetShell
      {...ctx}
      activeSectionId={sectionId}
    />
  )
}
