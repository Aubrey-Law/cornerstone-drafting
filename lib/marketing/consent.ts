import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizeEmail } from '@/lib/marketing/consentTokens'

/**
 * The firm's own record that permission was given.
 *
 * Loops is the sender and holds live subscription state — which lists someone
 * is on, and whether they are subscribed at all. This writes the part the firm
 * has to be able to answer from its own records: that consent exists, where it
 * came from, and when.
 *
 * Nothing here sends anything, and nothing here puts anyone on a list. Writing
 * consent and syncing the contact to Loops are separate steps on purpose: a
 * failure to reach Loops must not lose a permission the person just gave, and a
 * successful sync must not be the only evidence that they gave it.
 */

export type ConsentRecordResult = {
  /** How many cornerstone_crm_people rows were stamped. */
  matched: number
}

/**
 * Stamp confirmed consent onto every CRM row holding this address.
 *
 * `matched: 0` is a normal outcome, not a failure. `cornerstone_crm_people` is a
 * projection of people the firm already knows — clients, leads, and the
 * relatives and fiduciaries attached to their matters. Someone who subscribes
 * from a public form having never contacted the firm has no row here, and
 * should not be given one: creating a lead for a newsletter signup would put a
 * stranger into the pipeline the firm works from.
 *
 * For those people, Loops is the only store, which is the point of having
 * chosen a hosted marketing tool. The caller decides what to do with the count;
 * it is returned rather than logged so a route can report it.
 *
 * Every row for the address is stamped, not just one. A person can appear more
 * than once here (as their own intake record and as a contact on a relative's
 * matter), and consent belongs to the address, so leaving one row saying 'none'
 * would make the next reader's answer depend on which row they happened to read.
 */
export async function recordConfirmedConsent(
  email: string,
  source: string,
  now: Date = new Date(),
): Promise<ConsentRecordResult> {
  const normalized = normalizeEmail(email)
  if (!normalized) throw new Error('recordConfirmedConsent: invalid email')

  const capturedAt = now.toISOString()
  const { data, error } = await getAdminClient()
    .from('cornerstone_crm_people')
    .update({
      marketing_consent_status: 'subscribed',
      consent_source: source,
      consent_captured_at: capturedAt,
      // Clearing this is the point of a re-subscribe: the row must not read as
      // both currently subscribed and previously opted out, and the constraint
      // in 20261214000000 only requires the timestamp for the 'unsubscribed'
      // state.
      unsubscribed_at: null,
    })
    .eq('normalized_email', normalized)
    .select('id')

  if (error) throw new Error(`recordConfirmedConsent: ${error.message}`)
  return { matched: data?.length ?? 0 }
}
