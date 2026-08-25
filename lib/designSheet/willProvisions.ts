/**
 * Will provisions that are decisions rather than columns.
 *
 * Every other will provision — bond, supervision, simultaneous death, UTMA age,
 * the no-contest and disclaimer articles — is a real column, because they
 * predate the decisions blob. New ones go here instead: a column means a
 * migration, a `types/supabase.ts` regeneration and the PostgREST failure mode
 * `WRITABLE_DESIGN_SHEET_COLUMNS` guards against.
 *
 * Distinct from `decisions.will_pr_powers`, which is specifically the personal
 * representative's statutory powers. These are provisions of the will itself.
 */
import type { DesignSheet } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface DesignSheetWillProvisions {
  /**
   * Whether this settlor's will exercises a testamentary power of appointment
   * held under someone else's instrument. Per settlor: one spouse may hold a
   * power the other does not.
   */
  exercise_testamentary_power_of_appointment: boolean
  spouse_exercise_testamentary_power_of_appointment: boolean
}

const DEFAULT_WILL_PROVISIONS: DesignSheetWillProvisions = {
  exercise_testamentary_power_of_appointment: false,
  spouse_exercise_testamentary_power_of_appointment: false,
}

function willProvisionsRaw(sheet: Pick<DesignSheet, 'decisions'>): Record<string, unknown> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.will_provisions
  return isRecord(raw) ? raw : {}
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback
}

export function getDesignSheetWillProvisions(
  sheet: Pick<DesignSheet, 'decisions'>,
): DesignSheetWillProvisions {
  const raw = willProvisionsRaw(sheet)

  return {
    exercise_testamentary_power_of_appointment: readBoolean(
      raw, 'exercise_testamentary_power_of_appointment',
      DEFAULT_WILL_PROVISIONS.exercise_testamentary_power_of_appointment,
    ),
    spouse_exercise_testamentary_power_of_appointment: readBoolean(
      raw, 'spouse_exercise_testamentary_power_of_appointment',
      DEFAULT_WILL_PROVISIONS.spouse_exercise_testamentary_power_of_appointment,
    ),
  }
}

/** Spreads `...raw` first so a stored key this interface has not heard of survives. */
export function setDesignSheetWillProvisions(
  sheet: Pick<DesignSheet, 'decisions'>,
  patch: Partial<DesignSheetWillProvisions>,
) {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = willProvisionsRaw(sheet)
  const current = getDesignSheetWillProvisions(sheet)

  return {
    ...decisions,
    will_provisions: { ...raw, ...current, ...patch },
  }
}

export { DEFAULT_WILL_PROVISIONS }
