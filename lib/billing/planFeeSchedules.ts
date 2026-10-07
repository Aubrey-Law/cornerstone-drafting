import type { BillingPlan } from '@/lib/billing/types'
import {
  ARAG_SCHEDULE_ITEMS,
  aragInputHelp,
  aragScheduleLabel,
  calculateAragScheduleAmount,
} from '@/lib/arag/pricing'
import {
  calculateMetlifeScheduleAmount,
  METLIFE_FEE_SCHEDULE_SOURCE,
  METLIFE_SCHEDULE_ITEMS,
  metlifeScheduleLabel,
} from '@/lib/metlife/pricing'

/**
 * A carrier's fee schedule as the Add charge dialog offers it: pick a row and
 * the claim line's description and amount fill from the schedule. LegalEASE
 * and CLC have no schedule here yet, so their claims are entered by hand.
 */
export interface PlanFeeScheduleEntry {
  key: string
  label: string
  input?: { label: string; step: string; help: string | null }
}

export interface PlanFeeSchedule {
  pickerLabel: string
  source: string
  entries: readonly PlanFeeScheduleEntry[]
  amountCents: (key: string, inputValue?: number) => number | null
}

const metlife: PlanFeeSchedule = {
  pickerLabel: 'MetLife fee schedule item',
  source: `Massachusetts schedule · location ${METLIFE_FEE_SCHEDULE_SOURCE.locationCode}`,
  entries: METLIFE_SCHEDULE_ITEMS.map(item => ({
    key: item.key,
    label: metlifeScheduleLabel(item),
    input: item.input && {
      label: item.inputLabel ?? '',
      step: item.input === 'probate_assets' ? '0.01' : '0.25',
      help: item.input === 'probate_assets'
        ? '1.5% through $100,000 (minimum $450), then 1% over $100,000; maximum $4,000.'
        : '$1,000 through 10 hours, then $100 per additional hour; maximum $2,000.',
    },
  })),
  amountCents(key, inputValue) {
    const item = METLIFE_SCHEDULE_ITEMS.find(candidate => candidate.key === key)
    return item ? calculateMetlifeScheduleAmount(item, inputValue) : null
  },
}

const arag: PlanFeeSchedule = {
  pickerLabel: 'ARAG fee schedule item',
  source: 'ARAG fee schedule effective February 1, 2026',
  entries: ARAG_SCHEDULE_ITEMS.map(item => ({
    key: item.key,
    label: aragScheduleLabel(item),
    input: item.input && {
      label: item.inputLabel ?? '',
      step: item.input === 'documents' ? '1' : item.input === 'hours' ? '0.1' : '0.01',
      help: aragInputHelp(item),
    },
  })),
  amountCents(key, inputValue) {
    const item = ARAG_SCHEDULE_ITEMS.find(candidate => candidate.key === key)
    return item ? calculateAragScheduleAmount(item, inputValue) : null
  },
}

export const PLAN_FEE_SCHEDULES: Partial<Record<BillingPlan, PlanFeeSchedule>> = { metlife, arag }
