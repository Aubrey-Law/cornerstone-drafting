/** Map intake wizard `parent` value to contacts/design-sheet `parentage`. */
export function parentageFromIntakeParent(
  parent: unknown,
  clientFirstName?: string | null,
  spouseFirstName?: string | null,
): 'joint' | 'client' | 'spouse' | null {
  if (parent === 'both' || parent === 'joint') return 'joint'
  if (typeof parent !== 'string') return null
  const trimmed = parent.trim()
  if (!trimmed || trimmed.toLowerCase() === 'both') return 'joint'

  const client = (clientFirstName ?? '').trim().toLowerCase()
  const spouse = (spouseFirstName ?? '').trim().toLowerCase()
  const value = trimmed.toLowerCase()

  if (client && value === client) return 'client'
  if (spouse && value === spouse) return 'spouse'
  return null
}
