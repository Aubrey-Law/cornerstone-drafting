import type { TriageClassification } from '@/lib/queries/emailTriage'

/**
 * Which Gmail label an approved reply files its thread under.
 *
 * Kept apart from `lib/email/gmailLabels.ts` so the triage page can show the
 * label without importing the Gmail client. A `possible_lead` — an unknown
 * sender the firm is answering — is filed as a Lead, since that is how most
 * new inquiries arrive. A `contact` (a CPA, a successor trustee) gets none.
 */
const TRIAGE_LABELS: Partial<Record<TriageClassification, string>> = {
  client: 'Client',
  lead: 'Lead',
  possible_lead: 'Lead',
}

export function triageLabelName(classification: TriageClassification): string | null {
  return TRIAGE_LABELS[classification] ?? null
}

/** Every label triage may have put on a thread, for taking them off again. */
export const TRIAGE_LABEL_NAMES: string[] = Array.from(new Set(Object.values(TRIAGE_LABELS)))
