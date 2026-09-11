/** Reserve at least 480px for decisions instead of squeezing between two rails. */
export function dockClausePreview(width: number, navigationOpen: boolean): boolean {
  return width >= (navigationOpen ? 1200 : 950)
}
