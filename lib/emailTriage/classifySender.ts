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
  // `noreply` wherever it sits in the local part, as long as it is its own
  // word: `mssecurity-noreply@` and `noreply-billing@` are as unanswerable as
  // `noreply@`, and both reached the queue in the first week. The delimiter is
  // what keeps a person whose name happens to contain the letters out of it.
  /(^|[-._])no[-_]?reply([-._]|$)/i,
  /(^|[-._])do[-_]?not[-_]?reply([-._]|$)/i,
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
  // Added after the first production scan. A plan administrator's claims
  // desk sent seven separate threads in a fortnight and every one of them
  // reached the queue as a possible new lead.
  'claims', 'panel', 'referrals', 'referral', 'messenger', 'notification',
  'notifications', 'alerts', 'alert', 'service', 'mailer', 'accounts',
  'accountsreceivable', 'ar', 'ap', 'invoices', 'statements', 'donotreply',
])

/**
 * A local part shaped like a department's outbound mailer rather than a name:
 * `ar-simplifile`, `claims-intake`, `no-reply-alerts`. Matching the stem is
 * what the `Set` above cannot do, since these arrive with a suffix attached.
 */
const ROLE_LOCAL_PART_PREFIX =
  /^(ar|ap|claims?|panel|billing|invoices?|accounts?|notifications?|alerts?|mailer|messenger|support|service|updates?|news)[-._]/i

/**
 * Autoresponders, and calendar traffic. A lead accepting the consultation
 * invite is a notification the calendar generated, not a message to answer,
 * and one was drafted a reply in the first week. The colon is load-bearing:
 * "Accepted the offer on the house" is a person.
 */
const AUTOMATED_SUBJECTS =
  /^\s*(out of office|automatic reply|undeliverable|delivery status notification|read:|auto(matic)? response|(accepted|declined|tentative|(updated |new )?invitation|cancell?ed event):)/i

/**
 * A reference number in the subject — `Claim #43667`, `Invoice #000189`,
 * `Ticket 12345`, `Case No. 9`. Prose from a person almost never carries one;
 * a system that files things by number almost always does.
 */
const REFERENCED_SUBJECT =
  /(\b(claim|invoice|ticket|case|order|ref(erence)?|account|policy|statement)\b\W{0,12}(no\.?|number|#)?\s*#?\d{3,})|(#\s?\d{3,})/i

const BULK_CATEGORY_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_FORUMS',
  'CATEGORY_UPDATES',
])

/**
 * The ignore rule that covers this domain, if any: the domain itself or a
 * parent of it. A rule for `fedex.com` silences `message.fedex.com`, because
 * a vendor's notification subdomains are the vendor and nobody wants to add
 * them one at a time as they turn up — which is what the first week required.
 * `notfedex.com` is a different domain and stays untouched.
 */
export function matchIgnoredDomain(domain: string, ignored: Set<string>): string | null {
  let candidate = domain.toLowerCase()
  for (;;) {
    if (ignored.has(candidate)) return candidate
    const dot = candidate.indexOf('.')
    if (dot < 0) return null
    candidate = candidate.slice(dot + 1)
  }
}

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
  /**
   * How many separate threads this address opened in the scan window.
   *
   * The signal the first production scan made obvious: a person writing to a
   * law firm opens one thread, maybe two. Seven in a fortnight, each with its
   * own reference number, is a system filing tickets. Defaults to 1, so a
   * caller that does not count still behaves as it did before.
   */
  threadsFromSender?: number
}

/** Above this, one address is a system rather than a correspondent. */
const HIGH_VOLUME_THREADS = 3

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
  const ignoredDomain = matchIgnoredDomain(domain, ignore.domains)
  if (ignoredDomain) {
    return { automated: true, hard: true, reason: `${ignoredDomain} on the ignore list` }
  }

  const soft: string[] = []
  if (SOFT_AUTOMATED_LOCAL_PARTS.has(local) || ROLE_LOCAL_PART_PREFIX.test(local)) {
    soft.push(`sender is ${local}@`)
  }
  if (args.labelIds.some(id => BULK_CATEGORY_LABELS.has(id))) soft.push('Gmail filed it as bulk')
  if (!args.name || args.name.toLowerCase() === domain) soft.push('no personal display name')
  if (headers['x-mailer'] || headers['feedback-id'] || headers['x-campaign-id']) {
    soft.push('bulk-sender headers')
  }
  if (REFERENCED_SUBJECT.test(args.subject ?? '')) soft.push('subject carries a reference number')
  if ((args.threadsFromSender ?? 1) >= HIGH_VOLUME_THREADS) {
    soft.push(`${args.threadsFromSender} threads in the scan window`)
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
  /**
   * Other addresses in this thread, from `collectThreadParticipants`.
   *
   * Consulted only when the sender's own address matches nothing: a client who
   * was written to at work and replied from personal Gmail is otherwise a
   * stranger forever. Exactly one entry, or this is not used — see below.
   */
  threadParticipants?: string[]
}

/**
 * The other side of a two-party thread.
 *
 * Returns the non-firm addresses in a thread apart from the sender's own, and
 * deliberately returns *all* of them so the caller can see how many there are:
 * `classifySender` uses this only when there is exactly one, because that is
 * the case where "the other party" is unambiguous.
 *
 * Why the count matters. Matching a sender through a thread means inheriting
 * someone else's matter context, and inheriting the wrong one is far worse
 * than inheriting none — it would put a client's file behind a draft written
 * to a stranger. In a two-party thread the other address is the same person
 * writing from a second mailbox, which is the case worth solving. In a thread
 * with several outside parties — a client, opposing counsel, a CPA — the
 * sender could be any of them, so nothing is assumed.
 *
 * Only recipients the firm itself wrote to count. An address that merely
 * appeared in someone else's CC line is not one the firm chose to correspond
 * with, and treating it as identifying would let an outsider attach themselves
 * to a matter by CCing a client.
 */
export function collectThreadParticipants(args: {
  messages: {
    from: { email: string }
    to: { email: string }[]
    cc: { email: string }[]
    labelIds: string[]
  }[]
  senderEmail: string
  connectedAddress: string
  firmDomains: string[]
}): string[] {
  const self = args.connectedAddress.toLowerCase()
  const sender = args.senderEmail.toLowerCase()
  const firmDomains = args.firmDomains.map(d => d.toLowerCase())
  const isFirm = (email: string) =>
    email === self || firmDomains.includes(emailDomain(email))

  const found = new Set<string>()
  for (const message of args.messages) {
    // Outbound only: the firm's own choice of recipient is the signal.
    const fromFirm = message.labelIds.includes('SENT') || isFirm(message.from.email.toLowerCase())
    if (!fromFirm) continue

    for (const address of [...message.to, ...message.cc]) {
      const email = address.email.toLowerCase()
      if (!email || email === sender || isFirm(email)) continue
      found.add(email)
    }
  }
  return Array.from(found)
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

  const direct = await lookupByAddress(admin, email, args.name, null)
  if (direct) return direct

  // The sender's own address matched nothing. A thread the firm started is
  // the remaining evidence: a client written to at work who replies from
  // personal Gmail is a stranger by address and obvious by conversation.
  // Only a two-party thread is unambiguous enough to act on.
  const participants = args.threadParticipants ?? []
  if (participants.length === 1) {
    const viaThread = await lookupByAddress(admin, participants[0], args.name, participants[0])
    if (viaThread) return viaThread
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

/**
 * Look one address up against the firm's records.
 *
 * `via` names the address when it is not the sender's own, so a match made
 * through the thread says so on the row rather than looking like a direct hit
 * — a wrong inference should be legible at a glance, not buried.
 */
async function lookupByAddress(
  admin: AdminClient,
  address: string,
  fallbackName: string | null,
  via: string | null,
): Promise<SenderMatch | null> {
  const suffix = via ? ` via the thread (${via})` : ''
  // Both spellings, so a `+tag` address still finds its record.
  const candidates = Array.from(new Set([address, stripPlusTag(address)]))

  for (const candidate of candidates) {
    const matterId = await findMatterIdByEmail(admin, candidate)
    if (matterId) {
      return {
        classification: 'client',
        clientIntakeId: null,
        matterId,
        contactId: null,
        displayName: fallbackName,
        reason: `matches a hired matter${suffix}`,
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
          || fallbackName,
        reason: `matches lead (${lead.lead_status ?? 'no status'})${suffix}`,
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
      displayName: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || fallbackName,
      reason: contact.relationship_type
        ? `matches contact (${contact.relationship_type})${suffix}`
        : `matches a contact${suffix}`,
    }
  }

  return null
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
