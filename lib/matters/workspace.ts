export const MATTER_WORKSPACE_SECTIONS = [
  ['overview', 'Overview'], ['tasks', 'Tasks'], ['drafting', 'Drafting'],
  ['people', 'People'], ['assets', 'Assets'], ['documents', 'Documents'], ['billing', 'Billing'],
  ['communications', 'Messages'], ['history', 'History'],
] as const
export type MatterWorkspaceSection = (typeof MATTER_WORKSPACE_SECTIONS)[number][0]
export function matterWorkspaceHref(id: string, section: MatterWorkspaceSection) {
  return section === 'drafting' ? `/admin/drafting/${id}` : `/admin/matters/${id}?tab=${section}`
}
export function matterIdFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/admin\/(?:matters|drafting)\/([0-9a-f-]{36})(?:\/|$)/i)?.[1]
}
