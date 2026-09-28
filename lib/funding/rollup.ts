import {
  defaultMethodFor,
  fundingSummary,
  FUNDING_METHODS,
  FUNDING_STATUSES,
  type FundingMethod,
  type FundingStatus,
  type FundingSummary,
} from './model'

/** One asset joined to its funding row, as the query returns it. */
export interface FundingJoinRow {
  matter_id: string
  matter_title: string | null
  matter_stage: string | null
  asset_id: string
  category: string
  description: string | null
  ownership: string | null
  value: number | string | null
  method: string | null
  status: string | null
  confirmed_on: string | null
  note: string | null
}

export interface FundingAsset {
  assetId: string
  category: string
  description: string
  ownership: string
  value: number | string | null
  method: FundingMethod
  status: FundingStatus
  confirmedOn: string | null
  note: string | null
  /** False when nothing has been recorded yet, so the row is a suggestion. */
  isRecorded: boolean
}

const asMethod = (value: string | null): FundingMethod | null =>
  value !== null && (FUNDING_METHODS as readonly string[]).includes(value)
    ? (value as FundingMethod)
    : null

const asStatus = (value: string | null): FundingStatus | null =>
  value !== null && (FUNDING_STATUSES as readonly string[]).includes(value)
    ? (value as FundingStatus)
    : null

/**
 * An asset with no funding row has not been looked at, which is a different
 * thing from having been looked at and found to need nothing. It reads as
 * `not_started` with the method its category suggests — a starting point the
 * attorney confirms or overrides, never a claim that anything has been done.
 *
 * An unrecognised stored value falls back the same way rather than throwing:
 * a row written by older code must not take a page down.
 */
export function toFundingAssets(rows: readonly FundingJoinRow[]): FundingAsset[] {
  return rows.map((row) => ({
    assetId: row.asset_id,
    category: row.category,
    description: row.description ?? '',
    ownership: row.ownership ?? '',
    value: row.value,
    method: asMethod(row.method) ?? defaultMethodFor(row.category),
    status: asStatus(row.status) ?? 'not_started',
    confirmedOn: row.confirmed_on,
    note: row.note,
    isRecorded: asStatus(row.status) !== null,
  }))
}

export interface MatterFundingSummary {
  matterId: string
  title: string
  stage: string | null
  summary: FundingSummary
}

/**
 * The worklist, ordered by exposure.
 *
 * Sorted by unfunded value descending because that is the question this screen
 * answers: which client is most at risk right now. A matter with one
 * outstanding brokerage account worth more than another's whole estate belongs
 * at the top regardless of how many items each has left.
 */
export function summariseMatters(rows: readonly FundingJoinRow[]): MatterFundingSummary[] {
  const byMatter = new Map<string, FundingJoinRow[]>()
  for (const row of rows) {
    const existing = byMatter.get(row.matter_id)
    if (existing) existing.push(row)
    else byMatter.set(row.matter_id, [row])
  }

  return [...byMatter.entries()]
    .map(([matterId, matterRows]) => ({
      matterId,
      title: matterRows[0].matter_title ?? 'Untitled matter',
      stage: matterRows[0].matter_stage,
      summary: fundingSummary(toFundingAssets(matterRows)),
    }))
    .sort(
      (a, b) =>
        b.summary.unfundedValue - a.summary.unfundedValue || a.title.localeCompare(b.title),
    )
}
