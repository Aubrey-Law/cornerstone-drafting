/**
 * Which design sheet an estate-planning matter opens.
 *
 * EP and EPLP matters draft from Essential Estate Plan Design: Intake Details,
 * Fiduciaries, and one Estate Plan Design section drawn from the full sheet.
 * The full sheet stays available on those matters. College preparation and the
 * other practice areas keep the sheet they already use.
 */

import { isCollegePrepDesignSheet } from '@/lib/collegePrepDesign'
import { parsePracticeArea } from '@/lib/practiceArea'
import type { DesignSheet } from '@/types/database'

export const ESSENTIAL_DESIGN_SHEET_TITLE = 'Essential Estate Plan Design'

export type DesignSheetLayout = 'essential' | 'full' | 'college_prep'

export type StoredDesignSheetLayout = 'essential' | 'full'

const LAYOUT_KEY = 'design_sheet_layout'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Estate Planning and Estate Planning - LP. */
export function isEssentialDesignPracticeArea(practiceArea: unknown): boolean {
  const area = parsePracticeArea(practiceArea)
  return area === 'EP' || area === 'EP-LP'
}

export function storedDesignSheetLayout(
  sheet: Pick<DesignSheet, 'decisions'> | null | undefined,
): StoredDesignSheetLayout | null {
  const decisions = sheet?.decisions
  if (!isRecord(decisions)) return null
  const value = decisions[LAYOUT_KEY]
  if (value === 'essential' || value === 'full') return value
  return null
}

export function resolveDesignSheetLayout(args: {
  practiceArea: unknown
  sheet?: Pick<DesignSheet, 'decisions'> | null
}): DesignSheetLayout {
  const practice = parsePracticeArea(args.practiceArea)
  if (practice === 'CP') return 'college_prep'
  // EP and EPLP open the essential sheet. A stored choice can still open the
  // full sheet; the practice area wins over a stale college-prep marker.
  if (isEssentialDesignPracticeArea(practice)) {
    return storedDesignSheetLayout(args.sheet) === 'full' ? 'full' : 'essential'
  }
  if (isCollegePrepDesignSheet(args.sheet)) return 'college_prep'
  return 'full'
}

export function setDesignSheetLayout(
  sheet: Pick<DesignSheet, 'decisions'>,
  layout: StoredDesignSheetLayout,
): Record<string, unknown> {
  return {
    ...(isRecord(sheet.decisions) ? sheet.decisions : {}),
    [LAYOUT_KEY]: layout,
  }
}

/**
 * Decisions the essential sheet does not ask. They stay on the full sheet and
 * must not hold an essential plan that has no control for them.
 */
const ESSENTIAL_SHEET_HIDDEN_READINESS_FIELDS = new Set([
  'dpoa_provisions.agent_compensation',
  'dpoa_provisions.basic_powers',
  'healthcare_provisions.client_advance_directive',
  'healthcare_provisions.spouse_advance_directive',
  'healthcare_provisions.client_advance_directive_other',
  'healthcare_provisions.spouse_advance_directive_other',
  'residuary_spouse_survives',
  'residuary_no_spouse',
])

export function essentialSheetShowsReadinessField(targetField: string | null): boolean {
  if (!targetField) return true
  return !ESSENTIAL_SHEET_HIDDEN_READINESS_FIELDS.has(targetField)
}
