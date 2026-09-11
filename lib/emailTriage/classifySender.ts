import { findLeadByEmail, findMatterIdByEmail, findMatterIdByLeadId } from '@/lib/bookings/link'
import type { getAdminClient } from '@/lib/supabaseAdmin'

type AdminClient = ReturnType<typeof getAdminClient>

/**
 * Who sent this, and does the firm know them.
 *
 * Only `client`, `lead`, `contact` and `possible_lead` reach the queue.
 * `internal` and `automated` are counted and dropped.
 */
export type SenderClassification =
  | 'client'
  | 'lead'
  | 'contact'
  | 'possible_lead'
  | 'automated'
  | 'internal'

export interface SenderMatch {
  classification: SenderClassification
  clientIntakeId: string | null
  matterId: string | null
  contactId: string | null
  displayName: string | null
  /** Why, in words. Stored on the row so a wrong call can be argued with. */
  reason: string
}

export interface IgnoreRules {
  domains: Set<string>
  addresses: Set<string>
}

export const EMPTY_IGNORE_RULES: IgnoreRules = { domains: new Set(), addresses: new Set() }

/**
 * Local parts that are never a person. Protocol and convention rather than firm
 * preference, which is why these live in code while the vendor list lives in
 * `email_triage_ignore_rules` where the attorney can edit it.
 */
const HARD_AUTOMATED_LOCAL_PARTS = [
  /^no-?reply$/i,
  /^do-?not-?reply$/i,
  /^mailer-daemon$/i,
  /^postmaster$/i,
  /^bounces?$/i,
  /^auto(-?reply|mated)$/i,
]

/**
 * Local parts that are *often* a mailing address and often a real person at a
 * small business. On their own they prove nothing — `info@` at a two-person
 * company is someone's actual inbox — so these only count alongside a second
 * signal.
 */
const SOFT_AUTOMATED_LOCAL_PARTS = new Set([
  'info', 'support', 'billing', 'receipts', 'admin', 'sales', 'marketing',
  'newsletter', 'news', 'updates', 'team', 'hello', 'contact',
])

const AUTOMATED_SUBJECTS =
  /^\s*(out of office|automatic reply|undeliverable|delivery status notification|read:|auto(matic)? response)/i

const BULK_CATEGORY_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_FORUMS',
  'CATEGORY_UPDATES',
])

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase()
}

export function emailLocalPart(email: string): string {
  return email.slice(0, email.indexOf('@') > -1 ? email.indexOf('@') : email.length).toLowerCase()
}

/**
 * Strip a `+tag` so `jane+estate@example.com` still matches the `jane@` on the
 * client's intake record.
 */
export function stripPlusTag(email: string): string {
  const at = email.indexOf('@')
  if (at < 0) return email.toLowerCase()
  const local = email.slice(0, at)
  const plus = local.indexOf('+')
  return `${plus < 0 ? local : local.slice(0, plus)}${email.slice(at)}`.toLowerCase()
}

export interface AutomatedCheckArgs {
  email: string
  name: string | null
  headers: Record<string, string>
  labelIds: string[]
  subject: string | null
  ignore: IgnoreRules
}

/**
 * Whether this is machine-generated mail.
 *
 * `hard` means unambiguous — a mailing-list header, a `noreply` local part, an
 * autoresponder. Those beat everything, including a CRM match, because a
 * client's own out-of-office is still not a question.
 *
 * Everything else needs **two** agreeing signals. One signal alone throws away
 * real people: a client whose mail Gmail happened to file under Updates, or a
 * prospect writing from `info@` at their own small business.
 */
export function isAutomatedSender(args: AutomatedCheckArgs): {
  automated: boolean
  hard: boolean
  reason: string | null
} {
  const { headers, ignore } = args
  const email = args.email.toLowerCase()
  const domain = emailDomain(email)
  const local = emailLocalPart(email)

  if (headers['list-unsubscribe'] || headers['list-id'] || headers['list-post']) {
    return { automated: true, hard: true, reason: 'mailing-list headers' }
  }
  if (/^(bulk|list|junk)$/i.test(headers.precedence ?? '')) {
    return { automated: true, hard: true, reason: `Precedence: ${headers.precedence}` }
  }
  if (headers['auto-submitted'] && !/^no$/i.test(headers['auto-submitted'])) {
    return { automated: true, hard: true, reason: `Auto-Submitted: ${headers['auto-submitted']}` }
  }
  if (HARD_AUTOMATED_LOCAL_PARTS.some(pattern => pattern.test(local))) {
    return { automated: true, hard: true, reason: `sender is ${local}@` }
  }
  if (AUTOMATED_SUBJECTS.test(args.subject ?? '')) {
    return { automated: true, hard: true, reason: 'autoresponder subject' }
  }
  if (ignore.addresses.has(email)) {
    return { automated: true, hard: true, reason: 'sender on the ignore list' }
  }
  if (ignore.domains.has(domain)) {
    return { automated: true, hard: true, reason: `${domain} on the ignore list` }
  }

  const soft: string[] = []
  if (SOFT_AUTOMATED_LOCAL_PARTS.has(local)) soft.push(`sender is ${local}@`)
  if (args.labelIds.some(id => BULK_CATEGORY_LABELS.has(id))) soft.push('Gmail filed it as bulk')
  if (!args.name || args.name.toLowerCase() === domain) soft.push('no personal display name')
  if (headers['x-mailer'] || headers['feedback-id'] || headers['x-campaign-id']) {
    soft.push('bulk-sender headers')
  }

  if (soft.length >= 2) {
    return { automated: true, hard: false, reason: soft.join(', ') }
  }
  return { automated: false, hard: false, reason: null }
}

export interface ClassifySenderArgs extends AutomatedCheckArgs {
  connectedAddress: string
  /** Domains that are the firm itself. Mail from these is never triaged. */
  firmDomains: string[]
}

/**
 * Resolve a sender to a Cornerstone record.
 *
 * The order is the whole design. Hard-automated wins outright; then the firm's
 * own records, *before* the soft heuristics, so a real client is never
 * suppressed because Gmail filed their mail under Updates; then soft-automated;
 * then a possible new lead.
 *
 * Client beats lead deliberately: a hired client still has the `client_intake`
 * row they arrived as, and would otherwise be filed as a lead forever.
 */
export async function classifySender(
  admin: AdminClient,
  args: ClassifySenderArgs,
): Promise<SenderMatch> {
  const email = args.email.toLowerCase()
  const domain = emailDomain(email)
  const none = { clientIntakeId: null, matterId: null, contactId: null }

  if (
    email === args.connectedAddress.toLowerCase()
    || args.firmDomains.some(d => domain === d.toLowerCase())
  ) {
    return { classification: 'internal', ...none, displayName: args.name, reason: 'firm address' }
  }

  const automated = isAutomatedSender(args)
  if (automated.automated && automated.hard) {
    return {
      classification: 'automated',
      ...none,
      displayName: args.name,
      reason: automated.reason ?? 'automated',
    }
  }

  // Both spellings, so a `+tag` address still finds its record.
  const candidates = Array.from(new Set([email, stripPlusTag(email)]))

  for (const candidate of candidates) {
    const matterId = await findMatterIdByEmail(admin, candidate)
    if (matterId) {
      return {
        classification: 'client',
        clientIntakeId: null,
        matterId,
        contactId: null,
        displayName: args.name,
        reason: 'matches a hired matter',
      }
    }
  }

  for (const candidate of candidates) {
    const lead = await findLeadByEmail(admin, candidate)
    if (lead) {
      return {
        classification: 'lead',
        clientIntakeId: lead.id,
        matterId: await findMatterIdByLeadId(admin, lead.id),
        contactId: null,
        displayName: lead.full_name?.trim()
          || [lead.first_name, lead.last_name].filter(Boolean).join(' ')
          || args.name,
        reason: `matches lead (${lead.lead_status ?? 'no status'})`,
      }
    }
  }

  const contact = await findContactByEmail(admin, candidates)
  if (contact) {
    return {
      classification: 'contact',
      clientIntakeId: contact.client_intake_id,
      matterId: null,
      contactId: contact.id,
      displayName: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || args.name,
      reason: contact.relationship_type
        ? `matches contact (${contact.relationship_type})`
        : 'matches a contact',
    }
  }

  if (automated.automated) {
    return {
      classification: 'automated',
      ...none,
      displayName: args.name,
      reason: automated.reason ?? 'automated',
    }
  }

  return {
    classification: 'possible_lead',
    ...none,
    displayName: args.name,
    reason: 'not in Cornerstone — possible new lead',
  }
}

interface ContactLookupRow {
  id: string
  first_name: string | null
  last_name: string | null
  relationship_type: string | null
  client_intake_id: string | null
}

/**
 * A contact around a client — a CPA, a successor trustee, an adult child.
 * Merged contacts are excluded: replying into a record that was folded into
 * another one loses the reply.
 */
async function findContactByEmail(
  admin: AdminClient,
  candidates: string[],
): Promise<ContactLookupRow | null> {
  for (const candidate of candidates) {
    const { data, error } = await admin
      .from('contacts')
      .select('id, first_name, last_name, relationship_type, client_intake_id')
      .ilike('email', candidate)
      .is('merged_into_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data) return data as ContactLookupRow
  }
  return null
}
