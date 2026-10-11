import type { TriageClassification } from '@/lib/queries/emailTriage'

/**
 * Gmail labels Cornerstone applies while sorting the mailbox.
 *
 * Nested under `Cornerstone/` so they stay together in Gmail's sidebar and do
 * not collide with a hand-made "Client" label. Legacy flat `Client` / `Lead`
 * names are still removed when cleaning up, so older labelled threads do not
 * keep a second filing.
 */

export const CORNERSTONE_LABEL = {
  client: 'Cornerstone/Client',
  lead: 'Cornerstone/Lead',
  contact: 'Cornerstone/Contact',
  noise: 'Cornerstone/Noise',
  handled: 'Cornerstone/Handled',
  internal: 'Cornerstone/Internal',
  snoozed: 'Cornerstone/Snoozed',
  followUp: 'Cornerstone/Follow-up',
} as const

export type CornerstoneLabel = (typeof CORNERSTONE_LABEL)[keyof typeof CORNERSTONE_LABEL]

/** Flat names from the first triage ship — still stripped on ignore cleanup. */
export const LEGACY_TRIAGE_LABEL_NAMES = ['Client', 'Lead'] as const

/**
 * Relationship label for a queue classification. `possible_lead` files as Lead;
 * contacts get their own label so Gmail can group CPAs and trustees without
 * putting them in the client pile.
 */
export function triageLabelName(classification: TriageClassification): string | null {
  switch (classification) {
    case 'client':
      return CORNERSTONE_LABEL.client
    case 'lead':
    case 'possible_lead':
      return CORNERSTONE_LABEL.lead
    case 'contact':
      return CORNERSTONE_LABEL.contact
    default:
      return null
  }
}

/** Every Cornerstone label triage may put on a thread. */
export const TRIAGE_LABEL_NAMES: string[] = Array.from(
  new Set([
    ...Object.values(CORNERSTONE_LABEL),
    ...LEGACY_TRIAGE_LABEL_NAMES,
  ]),
)

/** Workflow labels cleared when re-sorting a thread into a new bucket. */
const WORKFLOW_LABELS: CornerstoneLabel[] = [
  CORNERSTONE_LABEL.noise,
  CORNERSTONE_LABEL.handled,
  CORNERSTONE_LABEL.internal,
  CORNERSTONE_LABEL.snoozed,
  CORNERSTONE_LABEL.followUp,
]

export type MailboxSortKind =
  | 'needs_reply'
  | 'noise'
  | 'internal'
  | 'handled'
  | 'dismissed'
  | 'snoozed'
  | 'follow_up_due'
  | 'contact_idle'

export interface DecideMailboxSortInput {
  kind: MailboxSortKind
  classification?: TriageClassification | 'automated' | 'internal'
  /** When false, labels still apply but INBOX is left alone. */
  archiveEnabled: boolean
  /**
   * Soft-automated (two weak signals) starts label-only so a real person
   * Gmail filed under Updates is not archived by mistake. Hard-automated and
   * ignore-list archive when the setting allows.
   */
  automatedHard?: boolean
}

export interface MailboxSortDecision {
  addLabels: string[]
  removeLabels: string[]
  archive: boolean
  restoreInbox: boolean
  displayLabel: string | null
}

function relationshipLabel(
  classification: TriageClassification | 'automated' | 'internal' | undefined,
): string | null {
  if (!classification || classification === 'automated' || classification === 'internal') {
    return null
  }
  return triageLabelName(classification)
}

/**
 * Pure decision: which Gmail labels to apply and whether to leave the Inbox.
 *
 * Wrong archive is worse than no archive — client/lead/possible_lead threads
 * that still need a reply never leave the Inbox from this helper.
 */
export function decideMailboxSort(input: DecideMailboxSortInput): MailboxSortDecision {
  const removeWorkflow = [...WORKFLOW_LABELS]
  const relationship = relationshipLabel(input.classification)

  switch (input.kind) {
    case 'needs_reply': {
      // Stay in Inbox; do not force-restore if the attorney archived by hand
      // until a new message or follow-up due changes the kind.
      const add = relationship ? [relationship] : []
      return {
        addLabels: add,
        removeLabels: removeWorkflow,
        archive: false,
        restoreInbox: false,
        displayLabel: add[0] ?? null,
      }
    }
    case 'noise': {
      // Soft-automated (automatedHard === false): label only. Undefined/true
      // means hard or ignore-list — archive when the firm setting allows.
      const archive = input.archiveEnabled && input.automatedHard !== false
      return {
        addLabels: [CORNERSTONE_LABEL.noise],
        removeLabels: removeWorkflow.filter(l => l !== CORNERSTONE_LABEL.noise),
        archive,
        restoreInbox: false,
        displayLabel: CORNERSTONE_LABEL.noise,
      }
    }
    case 'internal':
      return {
        addLabels: [CORNERSTONE_LABEL.internal],
        removeLabels: removeWorkflow.filter(l => l !== CORNERSTONE_LABEL.internal),
        archive: input.archiveEnabled,
        restoreInbox: false,
        displayLabel: CORNERSTONE_LABEL.internal,
      }
    case 'handled': {
      const add = [CORNERSTONE_LABEL.handled, ...(relationship ? [relationship] : [])]
      return {
        addLabels: add,
        removeLabels: removeWorkflow.filter(l => l !== CORNERSTONE_LABEL.handled),
        archive: input.archiveEnabled,
        restoreInbox: false,
        displayLabel: CORNERSTONE_LABEL.handled,
      }
    }
    case 'dismissed':
      return {
        addLabels: [CORNERSTONE_LABEL.handled],
        removeLabels: removeWorkflow.filter(l => l !== CORNERSTONE_LABEL.handled),
        archive: input.archiveEnabled,
        restoreInbox: false,
        displayLabel: CORNERSTONE_LABEL.handled,
      }
    case 'snoozed':
      return {
        addLabels: [CORNERSTONE_LABEL.snoozed, ...(relationship ? [relationship] : [])],
        removeLabels: removeWorkflow.filter(l => l !== CORNERSTONE_LABEL.snoozed),
        archive: input.archiveEnabled,
        restoreInbox: false,
        displayLabel: CORNERSTONE_LABEL.snoozed,
      }
    case 'follow_up_due': {
      const add = [CORNERSTONE_LABEL.followUp, ...(relationship ? [relationship] : [])]
      return {
        addLabels: add,
        removeLabels: removeWorkflow.filter(l => l !== CORNERSTONE_LABEL.followUp),
        archive: false,
        restoreInbox: true,
        displayLabel: CORNERSTONE_LABEL.followUp,
      }
    }
    case 'contact_idle':
      return {
        addLabels: [CORNERSTONE_LABEL.contact],
        removeLabels: removeWorkflow,
        archive: input.archiveEnabled,
        restoreInbox: false,
        displayLabel: CORNERSTONE_LABEL.contact,
      }
    default:
      return {
        addLabels: [],
        removeLabels: [],
        archive: false,
        restoreInbox: false,
        displayLabel: null,
      }
  }
}
