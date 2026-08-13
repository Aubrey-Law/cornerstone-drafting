/**
 * College Preparation Plan will payload.
 *
 * The `will-cp` package is a simple Massachusetts will for the student: tangible
 * personal property by memorandum, residue to the parents (or the survivor of
 * them), and the personal representative from the executor slots. The parents
 * are the one piece of data no estate namespace carries — on this track the
 * student is the client, so `client`/`spouse` cannot supply them the way the
 * young-adult plan's remap does.
 *
 * Everything here comes off `decisions.college_prep`; an estate sheet has no
 * college-prep will, so `buildCollegePrepWill` returns null and the namespace
 * stays empty.
 */

import { getCollegePrepDesign, isCollegePrepDesignSheet } from '@/lib/collegePrepDesign'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

export interface DraftPayloadCollegePrepWill {
  /** First parent taking the residue. One parent is enough — the template drops to a single-parent clause. */
  parent1_name: string | null
  parent2_name: string | null
}

export function buildCollegePrepWill(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null | undefined,
): DraftPayloadCollegePrepWill | null {
  if (!designSheet || !isCollegePrepDesignSheet(designSheet)) return null

  const design = getCollegePrepDesign(designSheet)
  if (design.will_include !== true) return null

  return {
    parent1_name: design.will_parent1_name,
    parent2_name: design.will_parent2_name,
  }
}
