import { MatterWorkspaceShell } from '@/components/matter/MatterWorkspaceShell'
export default async function DraftingMatterLayout({ children, params }: { children: React.ReactNode; params: Promise<{ matterId: string }> }) {
  const { matterId } = await params
  return <MatterWorkspaceShell matterId={matterId} active="drafting">{children}</MatterWorkspaceShell>
}
