import { csvFilename, toCsvText } from '@/lib/csvFile'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { stageLabel } from '@/types/database'
import { matterLastMilestoneAt } from '@/lib/matters/cardFacts'
import type { MatterListRow } from '@/lib/queries/matters'
import type { MatterSortKey, MatterTableFilters } from '@/lib/adminTables/matterTable'

/**
 * The matters list as a spreadsheet.
 *
 * Mirrors the columns the list itself shows — client, practice area, stage,
 * intake, last milestone — and adds the contact and identity fields a reader
 * needs once the rows are out of the app. Codes are written as the labels the
 * page displays (`EP` → `Estate Planning`), because a CSV is read by a person,
 * not by the app that wrote it.
 *
 * Dates are ISO (`2026-08-30`) rather than the list's relative "3d ago": a
 * spreadsheet can sort and subtract a date, and a file outlives the day it was
 * exported on.
 */

export const MATTER_EXPORT_HEADERS = [
  'Client',
  'Email',
  'Phone',
  'Matter number',
  'Matter name',
  'Practice area',
  'Stage',
  'Intake',
  'Fee',
  'Last milestone',
]

export interface MatterExportRow {
  client: string
  email: string
  phone: string
  matterNumber: string
  matterName: string
  practiceArea: string
  stage: string
  intake: string
  fee: string
  lastMilestone: string
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isoDate(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10)
}

export function toMatterExportRow(matter: MatterListRow): MatterExportRow {
  return {
    client: trimmed(matter.client_name) || trimmed(matter.matter_name),
    email: trimmed(matter.client_email),
    phone: trimmed(matter.client_phone),
    matterNumber: trimmed(matter.matter_number),
    matterName: trimmed(matter.matter_name),
    // An unset practice area is blank, not the label's "Estate Planning"
    // default: an export should not assert a plan the matter does not record.
    practiceArea: matter.practice_area ? practiceAreaLabel(matter.practice_area) : '',
    stage: matter.stage ? stageLabel(matter.stage) : '',
    intake: trimmed(matter.intake_status).replace(/_/g, ' '),
    fee: matter.fee_amount == null ? '' : String(matter.fee_amount),
    lastMilestone: isoDate(matterLastMilestoneAt(matter)),
  }
}

export function matterExportCsv(rows: MatterExportRow[]): string {
  return toCsvText(
    MATTER_EXPORT_HEADERS,
    rows.map(row => [
      row.client,
      row.email,
      row.phone,
      row.matterNumber,
      row.matterName,
      row.practiceArea,
      row.stage,
      row.intake,
      row.fee,
      row.lastMilestone,
    ]),
  )
}

/**
 * `label` names the selection exported — the stage group filter, or "all" when
 * the list is unfiltered — so two exports taken the same day do not overwrite
 * each other in the downloads folder.
 */
export function matterExportFilename(label: string, today = new Date()): string {
  return csvFilename('matters', label, today)
}

/**
 * The export route's URL for a given selection.
 *
 * One definition, so the assistant's `export_matters` tool and anything else
 * that links to the download describe the same filters the same way.
 */
export function matterExportUrl(filters: MatterTableFilters, sort?: MatterSortKey): string {
  const query = new URLSearchParams()
  if (filters.search) query.set('search', filters.search)
  if (filters.practice && filters.practice !== 'all') query.set('practice', filters.practice)
  if (filters.stageGroup !== 'all') query.set('stage', filters.stageGroup)
  // Only when asked for: the link has to open the same selection the rows came
  // from, and closed matters are out of that selection by default.
  if (filters.includeClosed) query.set('closed', '1')
  if (sort) query.set('sort', sort)
  const qs = query.toString()
  return `/api/admin/matters/export${qs ? `?${qs}` : ''}`
}

/** The filename's label: the stage group exported, else "all". */
export function matterExportLabel(filters: MatterTableFilters): string {
  return filters.stageGroup === 'all' ? 'all' : filters.stageGroup
}
