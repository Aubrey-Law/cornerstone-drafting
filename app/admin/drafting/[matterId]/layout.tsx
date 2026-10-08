import { notFound } from 'next/navigation'
import { requireStaffPage } from '@/lib/review/staff'
import { loadMatterWorkspaceFrame } from '@/lib/matters/workspaceFrame'
import { MatterWorkspaceFrame } from '@/app/admin/matters/[id]/MatterWorkspaceFrame'

/**
 * Drafting is a tab of the matter workspace: the shared header, stage stepper,
 * tab bar and Details panel frame the drafting route, whose pages render
 * unchanged inside it.
 */
export default async function DraftingMatterLayout({ children, params }: { children: React.ReactNode; params: Promise<{ matterId: string }> }) {
  const { matterId } = await params
  const { userId } = await requireStaffPage()
  if (!/^[0-9a-f-]{36}$/i.test(matterId)) notFound()
  const frame = await loadMatterWorkspaceFrame(matterId, userId)
  if (!frame) notFound()
  return <MatterWorkspaceFrame data={frame} active="drafting">{children}</MatterWorkspaceFrame>
}
