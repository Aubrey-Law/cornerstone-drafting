import { clientNameMatterSlug } from '@/lib/matterNumber'
import { practiceAreaLabel, practiceAreaMatterCode } from '@/lib/practiceArea'
import { compareNullable, normalizeSearchText, stableSort, timestamp } from '@/lib/collections'

export interface LeadTableRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  practice_area: string | null
  status: string | null
  intake_sent_at: string | null
  intake_completed_at: string | null
  engagement_status: string | null
  engagement_sent_at: string | null
  engagement_fee_quoted: number | null
  created_at: string | null
  last_activity_at: string | null
}

export type LeadProgressFilter =
  | 'all'
  | 'intake_not_sent'
  | 'intake_pending'
  | 'intake_complete'
  | 'engagement_pending'
  | 'engagement_signed'

export type LeadTableFilters = {
  search: string
  practice: string
  progress: LeadProgressFilter
}

export type LeadSortKey = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'fee_desc' | 'last_activity'

export const EMPTY_LEAD_TABLE_FILTERS: LeadTableFilters = {
  search: '',
  practice: 'all',
  progress: 'all',
}

export function leadDisplayName(lead: LeadTableRow): string {
  return lead.full_name?.trim()
    || [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim()
    || lead.email
    || 'Lead'
}

export function provisionalLeadNumber(lead: LeadTableRow, fallbackYear = new Date().getFullYear()): string {
  const parsedCreatedAt = lead.created_at ? new Date(lead.created_at) : null
  const year = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
    ? parsedCreatedAt.getFullYear()
    : fallbackYear
  return `${year}-${practiceAreaMatterCode(lead.practice_area)}-${clientNameMatterSlug(leadDisplayName(lead))}`
}

export function filterAndSortLeads<T extends LeadTableRow>(
  leads: T[],
  filters: LeadTableFilters,
  sortKey: LeadSortKey,
): T[] {
  const search = normalizeSearchText(filters.search)
  const practice = normalizeSearchText(filters.practice)
  const filtered = leads.filter(lead =>
    (practice === '' || practice === 'all' || normalize(lead.practice_area) === practice)
    && matchesSearch(lead, search)
    && matchesProgress(lead, filters.progress),
  )
  return stableSort(filtered, (left, right) => compareLeads(left, right, sortKey))
}

function matchesSearch(lead: LeadTableRow, search: string): boolean {
  if (!search) return true
  return [
    leadDisplayName(lead),
    lead.first_name,
    lead.last_name,
    lead.email,
    lead.phone,
    lead.practice_area,
    practiceAreaLabel(lead.practice_area),
    provisionalLeadNumber(lead),
  ].some(value => normalize(value).includes(search))
}

function matchesProgress(lead: LeadTableRow, progress: LeadProgressFilter): boolean {
  if (progress === 'all') return true
  if (lead.status === 'lost') return false
  const intakeComplete = Boolean(lead.intake_completed_at) || lead.status === 'completed'
  if (progress === 'intake_not_sent') return !intakeComplete && !lead.intake_sent_at
  if (progress === 'intake_pending') return !intakeComplete && Boolean(lead.intake_sent_at)
  if (progress === 'intake_complete') return intakeComplete
  if (progress === 'engagement_pending') return Boolean(lead.engagement_sent_at) && lead.engagement_status !== 'signed'
  return lead.engagement_status === 'signed'
}

function compareLeads(left: LeadTableRow, right: LeadTableRow, sortKey: LeadSortKey): number {
  if (sortKey === 'newest') return compareNullable(timestamp(left.created_at), timestamp(right.created_at), (a, b) => b - a)
  if (sortKey === 'oldest') return compareNullable(timestamp(left.created_at), timestamp(right.created_at), (a, b) => a - b)
  if (sortKey === 'name_asc') return compareNullable(displayNameValue(left), displayNameValue(right), (a, b) => a.localeCompare(b))
  if (sortKey === 'name_desc') return compareNullable(displayNameValue(left), displayNameValue(right), (a, b) => b.localeCompare(a))
  if (sortKey === 'fee_desc') return compareNullable(left.engagement_fee_quoted, right.engagement_fee_quoted, (a, b) => b - a)
  return compareNullable(timestamp(left.last_activity_at), timestamp(right.last_activity_at), (a, b) => b - a)
}

function displayNameValue(lead: LeadTableRow): string | null {
  const value = leadDisplayName(lead)
  return value === 'Lead' ? null : value
}

function normalize(value: string | null | undefined): string {
  return normalizeSearchText(value)
}
