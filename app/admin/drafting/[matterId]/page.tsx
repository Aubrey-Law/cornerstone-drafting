import { notFound } from 'next/navigation'
import {
  fetchDraftingHubMatters,
} from '@/lib/queries/drafting'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import DraftingWorkspace from './DraftingWorkspace'
import { loadDraftingMatterContext } from './loadDraftingMatterContext'

export const dynamic = 'force-dynamic'

export default async function DraftingWorkspacePage({
  params,
}: {
  params: Promise<{ matterId: string }>
}) {
  const { matterId } = await params

  const [ctx, hubResult] = await Promise.all([
    loadDraftingMatterContext(matterId),
    fetchDraftingHubMatters(),
  ])

  const admin = getAdminClient()
  const { data: sharedDraftRows } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('matter_id', matterId)
    .eq('folder', 'review')
    .order('created_at', { ascending: false })

  const hubMatter = hubResult.matters.find(item => item.matter.matter_id === matterId) ?? null

  return (
    <DraftingWorkspace
      matterId={ctx.matterId}
      matter={ctx.matter}
      contacts={ctx.contacts}
      sheet={ctx.sheet}
      lpData={ctx.lpData}
      intakeSnapshot={ctx.intakeSnapshot}
      hubMatter={hubMatter}
      sharedDrafts={(sharedDraftRows ?? []) as import('@/types/database').MatterDocument[]}
    />
  )
}
