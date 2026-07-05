import { notFound } from 'next/navigation'
import DesignSheetShell from './DesignSheetShell'
import { loadDraftingMatterContext } from '../loadDraftingMatterContext'

export const dynamic = 'force-dynamic'

export default async function DesignSheetOverviewPage({
  params,
}: {
  params: Promise<{ matterId: string }>
}) {
  const { matterId } = await params
  const ctx = await loadDraftingMatterContext(matterId)

  return (
    <DesignSheetShell
      {...ctx}
      activeSectionId={null}
    />
  )
}
