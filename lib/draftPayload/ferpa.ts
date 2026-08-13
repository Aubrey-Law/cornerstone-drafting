/**
 * FERPA release payload.
 *
 * Education records are governed by the Family Educational Rights and Privacy
 * Act (20 U.S.C. § 1232g; 34 C.F.R. Part 99), not HIPAA, so the College
 * Preparation Plan's HIPAA authorization does not reach them — a student who
 * wants a parent to see grades or a bursar account signs a separate release.
 *
 * Everything here comes off `decisions.college_prep`; there is no FERPA data on
 * an estate sheet, so `buildFerpaRelease` returns null and the package never
 * selects.
 */

import {
  getCollegePrepDesign,
  isCollegePrepDesignSheet,
  type CollegeFerpaRecord,
} from '@/lib/collegePrepDesign'
import { COLLEGE_FERPA_RECORD_OPTIONS } from '@/lib/collegePrepFields'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

export interface FerpaRecordCategory {
  key: CollegeFerpaRecord
  label: string
}

export interface DraftPayloadFerpaRelease {
  school_name: string | null
  school_city: string | null
  school_state: string | null
  /** "Boston, MA" for the document's institution line; null when neither is known. */
  school_location: string | null
  records: FerpaRecordCategory[]
  /** Every category the questionnaire offers was selected. */
  all_records: boolean
  /** Who may receive the records, in the student's own words. */
  recipients: string | null
}

const RECORD_LABELS = new Map<string, string>(
  COLLEGE_FERPA_RECORD_OPTIONS.map(option => [option.value, option.label]),
)

function joinLocation(city: string | null, state: string | null): string | null {
  const parts = [city, state].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : null
}

export function buildFerpaRelease(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null | undefined,
): DraftPayloadFerpaRelease | null {
  if (!designSheet || !isCollegePrepDesignSheet(designSheet)) return null

  const design = getCollegePrepDesign(designSheet)
  if (design.ferpa_release !== true) return null

  const records = design.ferpa_records.map(key => ({
    key,
    label: RECORD_LABELS.get(key) ?? key,
  }))

  return {
    school_name: design.school_name,
    school_city: design.school_city,
    school_state: design.school_state,
    school_location: joinLocation(design.school_city, design.school_state),
    records,
    all_records: records.length === COLLEGE_FERPA_RECORD_OPTIONS.length,
    recipients: design.ferpa_recipients,
  }
}

/**
 * Campus health and counseling records are the seam between the two statutes:
 * treatment records at a postsecondary institution are excluded from FERPA's
 * "education records" definition (34 C.F.R. § 99.3) and handled under state law
 * and HIPAA instead. The release says so rather than implying it covers them.
 */
export function ferpaIncludesHealthCenter(
  release: DraftPayloadFerpaRelease | null | undefined,
): boolean {
  return (release?.records ?? []).some(record => record.key === 'health_center')
}
