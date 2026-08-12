import { worksDb } from '@/lib/works/data'

export interface MetlifeClaimItemResult {
  itemId: string
  created: boolean
  amountCents: number
}

/**
 * File the prepared claim in the billing ledger.
 *
 * A matter has at most one MetLife plan claim, so this upserts rather than
 * inserts: re-running the skill after the design sheet changes should correct
 * the amount, not stack a second claim the finance dashboard would double-count.
 * A claim that has already been paid is left alone — the money has landed and
 * the ledger row is now history.
 */
export async function ensureMetlifeClaimItem(args: {
  matterId: string
  amountCents: number
  userId: string
}): Promise<MetlifeClaimItemResult> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new Error('A MetLife claim must have a positive total before it reaches the ledger.')
  }
  const db = worksDb()
  const { data: existing, error: readError } = await db
    .from('billing_items')
    .select('id, status, amount_billed')
    .eq('matter_id', args.matterId)
    .eq('kind', 'plan_claim')
    .eq('plan', 'metlife')
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (readError) throw new Error(readError.message)

  if (existing) {
    if (existing.status !== 'paid' && existing.amount_billed !== args.amountCents) {
      const { error } = await db
        .from('billing_items')
        .update({ amount_billed: args.amountCents, updated_by: args.userId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
    }
    return { itemId: existing.id, created: false, amountCents: args.amountCents }
  }

  const { data: inserted, error: insertError } = await db
    .from('billing_items')
    .insert({
      matter_id: args.matterId,
      kind: 'plan_claim',
      plan: 'metlife',
      label: 'MetLife claim',
      amount_billed: args.amountCents,
      status: 'to_invoice',
      source: 'workflow',
      created_by: args.userId,
      updated_by: args.userId,
    })
    .select('id')
    .single()
  if (insertError || !inserted) throw new Error(insertError?.message ?? 'Unable to add the MetLife claim to the ledger')

  // 'item_seeded' is the only billing_events type that describes a row the firm
  // did not hand-enter; the CHECK constraint accepts no closer alternative.
  await db.from('billing_events').insert({
    billing_item_id: inserted.id,
    event_type: 'item_seeded',
    actor_id: args.userId,
    detail: 'MetLife claim prepared by the Prepare MetLife Claim workflow',
  })

  return { itemId: inserted.id, created: true, amountCents: args.amountCents }
}
