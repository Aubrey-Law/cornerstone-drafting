import { notFound } from 'next/navigation'
import { loadDraftingMatterContext } from '../loadDraftingMatterContext'
import { parseDesignFocusParam } from '@/lib/designSheetReadiness'
import DesignSheetPage from './DesignSheetPage'

export const dynamic = 'force-dynamic'

export default async function DesignSheetOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>
  searchParams: Promise<{ section?: string; focus?: string }>
}) {
  const { matterId } = await params
  const { section, focus } = await searchParams
  const ctx = await loadDraftingMatterContext(matterId)
  if (!ctx.sheet) notFound()

  return (
    <DesignSheetPage
      {...ctx}
      requestedSectionId={section ?? null}
      initialFocus={parseDesignFocusParam(focus)}
    />
  )
}
