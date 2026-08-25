import { getSettlorFacts, type SettlorFacts } from '@/lib/designSheet/settlorFacts'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

/**
 * Facts about the settlors, straight through from the design sheet. Kept as its
 * own payload type so the generator has one place to read them from, even
 * though it scatters them onto `client`, `spouse` and `marriage` — the roots
 * templates already know.
 */
export type DraftPayloadSettlorFacts = SettlorFacts

export function draftPayloadSettlorFacts(designSheet: DesignSheetRow): DraftPayloadSettlorFacts {
  return getSettlorFacts({ decisions: designSheet.decisions ?? null })
}
