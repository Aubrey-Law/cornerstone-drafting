import { redirect, notFound } from 'next/navigation'
import { loadDraftingMatterContext } from '../../loadDraftingMatterContext'
import { normalizeDesignSectionId } from '@/lib/designSheet/sectionIds'

export const dynamic = 'force-dynamic'

/** Legacy deep links redirect to query-param navigation for faster client-side section changes. */
export default async function LegacyDesignSectionPage({
  params,
}: {
  params: Promise<{ matterId: string; sectionId: string }>
}) {
  const { matterId, sectionId } = await params
  const ctx = await loadDraftingMatterContext(matterId)
  if (!ctx.sheet) notFound()

  const normalized = normalizeDesignSectionId(sectionId) ?? sectionId
  redirect(`/admin/drafting/${matterId}/design?section=${encodeURIComponent(normalized)}`)
}
