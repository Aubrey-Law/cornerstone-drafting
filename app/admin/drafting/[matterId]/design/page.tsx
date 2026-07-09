import { notFound } from 'next/navigation'
import DesignSheetShell from './DesignSheetShell'
import { loadDraftingMatterContext } from '../loadDraftingMatterContext'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { getDesignSectionNavItems, isValidDesignSectionId } from '@/lib/designSheet/designSectionNav'
import { normalizeDesignSectionId } from '@/lib/designSheet/sectionIds'

export const dynamic = 'force-dynamic'

export default async function DesignSheetOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>
  searchParams: Promise<{ section?: string }>
}) {
  const { matterId } = await params
  const { section } = await searchParams
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
    maritalStatus: ctx.sheet.marital_status ?? ctx.intakeSnapshot?.marital_status ?? null,
    spouseName: ctx.sheet.spouse_name ?? ctx.matter.spouse_name ?? null,
    isJointTrust: ctx.sheet.is_joint,
  })

  const normalizedSectionId = section ? (normalizeDesignSectionId(section) ?? section) : null
  const activeSectionId = normalizedSectionId && isValidDesignSectionId(normalizedSectionId, navItems)
    ? normalizedSectionId
    : null

  return (
    <DesignSheetShell
      {...ctx}
      activeSectionId={activeSectionId}
    />
  )
}
