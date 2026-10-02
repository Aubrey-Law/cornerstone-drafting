import { STAGES, stageLabel, type MatterStage } from '@/types/database'
import { normalizePracticeArea, practiceAreaLabel, type PracticeAreaCode } from '@/lib/practiceArea'
import { SLA_PHASES } from '@/lib/slaTasks/types'
import { isDateKey } from '@/lib/slaTasks/schedule'

/**
 * Bringing an existing matter into Cornerstone.
 *
 * The firm is moving clients onto the app whose matters began elsewhere —
 * engaged, drafted outside Cornerstone, often signed and funded years ago.
 * Every create path assumes a new client: the matter starts at intake, and a
 * task plan is generated dated from today, whose client nudges would email
 * someone signed in 2023 about an organizer they finished long ago.
 *
 * An import instead:
 *   - lands the matter directly on the stage the work has actually reached,
 *     without running the stage engine or billing milestones for that move;
 *   - records the real dates (engagement, drafts sent, signed, funded, closed)
 *     without replaying them as clock anchors — the work is done;
 *   - either generates no plan at all (the default, and the only choice for a
 *     closed matter), or generates the plan and skips every phase before the
 *     current stage, so only the work still ahead is open and nudged;
 *   - stamps `matters.imported_at`, so the record says how it arrived.
 *
 * Nothing here emails anyone. Documents are uploaded afterwards on the matter's
 * Documents tab, private until shared — sharing is what notifies a client.
 */

export type ImportPlanMode = 'none' | 'remaining'

export interface ImportMatterDates {
  /** When the matter was opened, at the firm or elsewhere. */
  openedOn?: string | null
  engagementSignedOn?: string | null
  draftsSentOn?: string | null
  /** When the plan documents were signed / executed. */
  signedOn?: string | null
  fundingCompletedOn?: string | null
  /** Only meaningful when the matter is imported as closed. */
  closedOn?: string | null
}

export interface ImportMatterInput {
  clientName: string
  clientEmail: string
  clientPhone: string | null
  practiceArea: PracticeAreaCode
  /** The firm's existing matter number, kept as-is. Generated when absent. */
  matterNumber: string | null
  stage: MatterStage
  plan: ImportPlanMode
  dates: ImportMatterDates
  notes: string | null
  requestId: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_STAGES = new Set<string>(STAGES.map(stage => stage.key))
const DATE_FIELDS: (keyof ImportMatterDates)[] = [
  'openedOn', 'engagementSignedOn', 'draftsSentOn', 'signedOn', 'fundingCompletedOn', 'closedOn',
]

export type ParseResult = { ok: true; input: ImportMatterInput } | { ok: false; error: string }

/** Validate a request body into an import. Every problem is the caller's to fix. */
export function parseImportMatterBody(body: unknown, today: string): ParseResult {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

  const clientName = text(raw.clientName)
  const clientEmail = text(raw.clientEmail).toLowerCase()
  if (!clientName) return { ok: false, error: 'Client name is required' }
  if (!EMAIL_RE.test(clientEmail)) return { ok: false, error: 'A valid client email is required' }

  const stage = text(raw.stage)
  if (!VALID_STAGES.has(stage)) return { ok: false, error: 'Choose the stage this matter is at' }

  const plan = raw.plan === undefined || raw.plan === null || raw.plan === '' ? 'none' : raw.plan
  if (plan !== 'none' && plan !== 'remaining') {
    return { ok: false, error: 'plan must be none or remaining' }
  }
  // A closed matter owes nothing; a plan for it would only be noise.
  if (stage === 'closed' && plan === 'remaining') {
    return { ok: false, error: 'A closed matter has no remaining work to plan' }
  }

  const rawDates = (raw.dates && typeof raw.dates === 'object' ? raw.dates : {}) as Record<string, unknown>
  const dates: ImportMatterDates = {}
  for (const field of DATE_FIELDS) {
    const value = text(rawDates[field])
    if (!value) continue
    if (!isDateKey(value)) return { ok: false, error: `${field} must be a date (YYYY-MM-DD)` }
    // These are things that already happened. A future date is a typo, and
    // left alone it would read as work scheduled rather than work done.
    if (value > today) return { ok: false, error: `${field} cannot be in the future` }
    dates[field] = value
  }
  if (dates.closedOn && stage !== 'closed') {
    return { ok: false, error: 'A closed date needs the stage set to Closed' }
  }

  const matterNumber = text(raw.matterNumber) || null
  if (matterNumber && matterNumber.length > 64) return { ok: false, error: 'Matter number is too long' }

  return {
    ok: true,
    input: {
      clientName,
      clientEmail,
      clientPhone: text(raw.clientPhone) || null,
      practiceArea: normalizePracticeArea(raw.practiceArea),
      matterNumber,
      stage: stage as MatterStage,
      plan,
      dates,
      notes: text(raw.notes) || null,
      requestId: typeof raw.requestId === 'string' && UUID_RE.test(raw.requestId) ? raw.requestId : null,
    },
  }
}

/**
 * The plan phases already behind a matter at `stage`. Index-based on
 * SLA_PHASES, so the lead phases and the legacy v1 names (onboarding, review)
 * fall where they sit. The current stage's own phase stays open: that is the
 * work in hand.
 */
export function phasesBefore(stage: MatterStage): string[] {
  const index = SLA_PHASES.indexOf(stage as (typeof SLA_PHASES)[number])
  return index <= 0 ? [] : SLA_PHASES.slice(0, index)
}

/** Midday UTC, as the key-dates route stores bare days: no timezone rolls them back. */
const atNoon = (day: string) => `${day}T12:00:00Z`

/** The `matters` columns an import writes once the matter exists. */
export function matterPatchFor(input: ImportMatterInput, now: string): Record<string, unknown> {
  const { dates } = input
  const patch: Record<string, unknown> = { stage: input.stage, imported_at: now }
  const hired = dates.engagementSignedOn ?? dates.openedOn
  if (hired) patch.hired_at = atNoon(hired)
  if (dates.engagementSignedOn) patch.engagement_signed_at = atNoon(dates.engagementSignedOn)
  if (dates.draftsSentOn) patch.drafts_sent_at = atNoon(dates.draftsSentOn)
  if (dates.signedOn) patch.documents_executed_at = atNoon(dates.signedOn)
  // The engagement is signed for any matter that got this far, so the fit
  // gate is open: nothing pre-engagement should sit waiting on it.
  patch.fit_decision = 'fit'
  patch.fit_decided_at = now
  if (input.stage === 'closed') {
    patch.status = 'closed'
    // The status trigger keeps a closed_at given in the same write.
    if (dates.closedOn) patch.closed_at = atNoon(dates.closedOn)
  }
  return patch
}

/** The `matter_details` columns an import writes. Date columns take bare days. */
export function detailsPatchFor(input: ImportMatterInput): Record<string, unknown> {
  const { dates } = input
  const patch: Record<string, unknown> = {}
  if (dates.openedOn) patch.open_date = dates.openedOn
  if (dates.engagementSignedOn) patch.hired_date = dates.engagementSignedOn
  if (dates.draftsSentOn) patch.draft_sent_date = dates.draftsSentOn
  if (dates.signedOn) {
    patch.signing_date = dates.signedOn
    patch.execution_date = dates.signedOn
  }
  if (dates.fundingCompletedOn) patch.ep_funding_complete_date = dates.fundingCompletedOn
  if (dates.closedOn) patch.closed_date = dates.closedOn
  if (input.notes) patch.internal_notes = input.notes
  return patch
}

export function importedMatterName(input: Pick<ImportMatterInput, 'clientName' | 'practiceArea'>): string {
  return `${input.clientName} — ${practiceAreaLabel(input.practiceArea)}`
}

export function importActivityDetail(input: ImportMatterInput, skippedTasks: number): string {
  const parts = [`Brought in at ${stageLabel(input.stage)}.`]
  parts.push(
    input.plan === 'remaining'
      ? `Plan generated for the remaining work; ${skippedTasks} task${skippedTasks === 1 ? '' : 's'} for earlier stages skipped.`
      : 'No task plan generated.',
  )
  return parts.join(' ')
}

