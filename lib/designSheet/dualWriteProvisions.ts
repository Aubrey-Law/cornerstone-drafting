import { getTrustDetails, setTrustDetails } from '@/lib/designSheetTrustDetails'
import type { DesignSheet } from '@/types/database'

/**
 * Three trust answers predate `decisions.trust_details` and are still stored in
 * their original design-sheet column as well as the namespace. Neither half can
 * be dropped: the column is what a pre-namespace matter carries, and the
 * namespace is what everything written since reads.
 *
 * Both halves are therefore merged with an OR — which cannot distinguish
 * "nobody answered" from "answered no", so when they disagree the `include`
 * side wins and nothing marks it. #344 was that failure reaching a signed
 * document: a control wrote the column alone, so the sheet showed "Omit" on a
 * will that drafted the clause.
 *
 * This module is the only place either half is read or written. Everything
 * else — the section components and `draftPayloadTrustProvisions` — goes
 * through `readDualWriteProvision` and `dualWriteProvisionWriter`, so the two
 * halves cannot drift apart and the UI cannot disagree with the generator about
 * what the merge means. `tests/design-sheet-dual-write-pairs.test.ts` holds it
 * that way.
 */
export type DualWriteProvision = 'substance_abuse' | 'creditor_divorce' | 'no_contest'

interface DualWritePair {
  /** Key inside `decisions.trust_details`. */
  namespaceKey: 'include_substance_abuse' | 'include_creditor_divorce_provisions' | 'include_no_contest_clause'
  /** Legacy top-level design-sheet column holding the same answer. */
  column: 'provision_substance_abuse' | 'provision_married_beneficiary' | 'no_contest_clause'
  /** Column encoding of an on/off answer — the columns predate booleans. */
  encode: (enabled: boolean) => string
  decode: (value: unknown) => boolean
}

const yesNo = {
  encode: (enabled: boolean) => (enabled ? 'yes' : 'no'),
  decode: (value: unknown) => String(value ?? '').toLowerCase() === 'yes',
}

export const DUAL_WRITE_PROVISIONS: Record<DualWriteProvision, DualWritePair> = {
  substance_abuse: { namespaceKey: 'include_substance_abuse', column: 'provision_substance_abuse', ...yesNo },
  creditor_divorce: { namespaceKey: 'include_creditor_divorce_provisions', column: 'provision_married_beneficiary', ...yesNo },
  no_contest: {
    namespaceKey: 'include_no_contest_clause',
    column: 'no_contest_clause',
    encode: (enabled: boolean) => (enabled ? 'include' : 'omit'),
    decode: (value: unknown) => value === 'include',
  },
}

/** Everything both a design sheet and a draft-payload input have in common here. */
export type DualWriteProvisionSheet = Pick<DesignSheet, 'decisions'> & {
  [K in DualWritePair['column']]?: unknown
}

/** The merged answer — the single definition the UI and the generator share. */
export function readDualWriteProvision(
  sheet: DualWriteProvisionSheet,
  provision: DualWriteProvision,
): boolean {
  const pair = DUAL_WRITE_PROVISIONS[provision]
  return getTrustDetails(sheet)[pair.namespaceKey] || pair.decode(sheet[pair.column])
}

/**
 * The only writer. One call updates both halves, so no caller can write one and
 * forget the other — the shape that produced #344.
 *
 * Takes the section's `onChange` rather than returning a patch because the two
 * halves land in different places (the `decisions` blob and a column), and a
 * caller free to apply half of a returned patch would reintroduce the bug.
 */
export function dualWriteProvisionWriter(
  onChange: {
    (key: 'decisions', value: (previous: DualWriteProvisionSheet) => unknown): void
    (key: DualWritePair['column'], value: string): void
  },
) {
  return (provision: DualWriteProvision, enabled: boolean) => {
    const pair = DUAL_WRITE_PROVISIONS[provision]
    onChange('decisions', previous => setTrustDetails(previous, { [pair.namespaceKey]: enabled }))
    onChange(pair.column, pair.encode(enabled))
  }
}
