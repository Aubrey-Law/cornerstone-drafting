import type { DesignSheet, PipelineMatter } from '@/types/database'

/**
 * Computed-default values for the design sheet. These fill fields that the
 * client intake never captures (trust names and domicile) so the
 * attorney sees a sensible pre-filled value instead of a blank box. They are
 * seeded into the saved sheet on load (see app/admin/drafting/[matterId]/page.tsx)
 * so they flow into drafting and the Word export, and they are shown live in the
 * design sheet UI until persisted. Every value is overridable.
 */

type NameSource = Pick<PipelineMatter, 'client_name' | 'spouse_name'>

function nameInitials(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}

function nameLast(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.at(-1) ?? ''
}

function isMarried(sheet: DesignSheet): boolean {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  return marital.includes('married') && !marital.includes('never')
}

/**
 * Auto-derived trust name shown when the attorney hasn't set one.
 * Joint → "[Client Last Name] Family Trust"; otherwise → "The [Client Initials] Trust".
 */
export function deriveTrustName(sheet: DesignSheet, matter: NameSource): string {
  const clientName = (sheet.client_name ?? matter.client_name ?? '').trim()
  if (!clientName) return ''
  if (sheet.is_joint) {
    const last = nameLast(clientName)
    return last ? `${last} Family Trust` : ''
  }
  const initials = nameInitials(clientName)
  return initials ? `The ${initials} Trust` : ''
}

/** Auto-derived separate spouse trust name → "The [Spouse Initials] Trust". */
export function deriveSpouseTrustName(sheet: DesignSheet, matter: NameSource): string {
  const spouseName = (sheet.spouse_name ?? matter.spouse_name ?? '').trim()
  const initials = nameInitials(spouseName)
  return initials ? `The ${initials} Trust` : ''
}

/**
 * Returns a patch of computed-default values for fields that are currently
 * empty. Never overwrites a value the attorney has already entered. Computed
 * from the sheet's current state, so the trust-name basis (joint vs. separate,
 * names) reflects whatever is saved at the time of seeding.
 */
export function computeDesignSheetDefaults(
  sheet: DesignSheet,
  matter: NameSource,
): Partial<DesignSheet> {
  const patch: Partial<DesignSheet> = {}

  // Domicile — defaults to the client's residency state.
  if (!sheet.client_domicile && sheet.state) patch.client_domicile = sheet.state

  // Trust names — derived from initials / family name.
  if (!sheet.trust_name) {
    const trustName = deriveTrustName(sheet, matter)
    if (trustName) patch.trust_name = trustName
  }
  if (isMarried(sheet) && !sheet.is_joint && !sheet.spouse_trust_name) {
    const spouseTrustName = deriveSpouseTrustName(sheet, matter)
    if (spouseTrustName) patch.spouse_trust_name = spouseTrustName
  }

  return patch
}
