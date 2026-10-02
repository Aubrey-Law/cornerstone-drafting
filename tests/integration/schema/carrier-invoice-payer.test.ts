import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Invoices billed to a legal plan carrier, as the database enforces them.
 *
 * 20270103090000_invoice_payer lets a plan claim onto an invoice, but only one
 * billed to its carrier: the payer is derived from the charges, one invoice
 * holds one payer, and a client's portal credentials can never read a carrier
 * invoice. Those are claims about the RPCs and RLS policies themselves, so they
 * run against the real migrated schema.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

const password = `pw-${randomUUID()}`
const attorneyEmail = `carrier-attorney-${randomUUID()}@example.invalid`
const clientEmail = `carrier-client-${randomUUID()}@example.invalid`

let attorneyId: string
let clientId: string
let intakeId: string
let matterId: string
let claimIds: string[] = []
let costId: string
let asClient: SupabaseClient

async function createUser(address: string, role: 'attorney' | 'client'): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: address,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const { error: profileError } = await admin
    .from('users')
    .upsert({ id: data.user.id, email: address, role }, { onConflict: 'id' })
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`)
  return data.user.id
}

function draft(itemIds: string[], billToName: string | null = null) {
  return admin.rpc('create_invoice_draft', {
    p_matter_id: matterId,
    p_item_ids: itemIds,
    p_issue_date: '2026-10-02',
    p_due_date: '2026-11-01',
    p_notes: null,
    p_terms: null,
    p_bill_to_name: billToName,
    p_bill_to_email: null,
    p_payment_link: null,
    p_actor_id: attorneyId,
  })
}

beforeAll(async () => {
  attorneyId = await createUser(attorneyEmail, 'attorney')
  clientId = await createUser(clientEmail, 'client')

  const intake = await admin
    .from('client_intake')
    .insert({ user_id: clientId, email: clientEmail })
    .select('id')
    .single()
  if (intake.error || !intake.data) throw new Error(`intake insert failed: ${intake.error?.message}`)
  intakeId = intake.data.id as string

  const matter = await admin
    .from('matters')
    .insert({ client_intake_id: intakeId, client_id: clientId })
    .select('id')
    .single()
  if (matter.error || !matter.data) throw new Error(`matter insert failed: ${matter.error?.message}`)
  matterId = matter.data.id as string

  const created = await admin.rpc('create_billing_items', {
    p_matter_id: matterId,
    p_items: [
      { kind: 'plan_claim', label: 'CT 220 — Power of Attorney — Individual', plan: 'metlife', amount_billed: 6_000 },
      { kind: 'plan_claim', label: 'CT 220 — Power of Attorney — Individual', plan: 'metlife', amount_billed: 6_000 },
      { kind: 'cost', label: 'Deed recording fee', plan: null, amount_billed: 15_500 },
    ],
    p_actor_id: attorneyId,
  })
  if (created.error) throw new Error(`charges failed: ${created.error.message}`)
  const items = created.data as { id: string; kind: string }[]
  claimIds = items.filter(item => item.kind === 'plan_claim').map(item => item.id)
  costId = items.find(item => item.kind === 'cost')!.id

  asClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error } = await asClient.auth.signInWithPassword({ email: clientEmail, password })
  if (error) throw new Error(`client sign-in failed: ${error.message}`)
}, 30_000)

afterAll(async () => {
  if (matterId) {
    await admin.from('billing_payments').delete().in('billing_item_id', [...claimIds, costId].filter(Boolean))
    await admin.from('billing_items').update({ invoice_id: null }).eq('matter_id', matterId)
    await admin.from('invoices').delete().eq('matter_id', matterId)
    await admin.from('billing_items').delete().eq('matter_id', matterId)
    await admin.from('matters').delete().eq('id', matterId)
  }
  if (intakeId) await admin.from('client_intake').delete().eq('id', intakeId)
  for (const id of [attorneyId, clientId].filter(Boolean)) {
    await admin.from('users').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => undefined)
  }
})

describe('invoice payer', () => {
  it('refuses an invoice that mixes client charges with plan claims', async () => {
    const { error } = await draft([...claimIds, costId])
    expect(error?.message).toContain('billed to one payer')
  })

  let carrierInvoiceId: string

  it('bills plan claims to their carrier and marks them submitted on issue', async () => {
    const drafted = await draft(claimIds, 'MetLife Legal Plans')
    expect(drafted.error).toBeNull()
    const invoice = drafted.data as { id: string; payer: string; subtotal_cents: number }
    expect(invoice.payer).toBe('metlife')
    expect(invoice.subtotal_cents).toBe(12_000)
    carrierInvoiceId = invoice.id

    const issued = await admin.rpc('issue_invoice', { p_invoice_id: carrierInvoiceId, p_actor_id: attorneyId })
    expect(issued.error).toBeNull()

    const { data: claims } = await admin
      .from('billing_items')
      .select('status, invoiced_at')
      .in('id', claimIds)
    expect(claims?.map(claim => claim.status)).toEqual(['invoiced', 'invoiced'])
    expect(claims?.every(claim => claim.invoiced_at)).toBe(true)
  })

  it('will not let a carrier draft take on a client charge', async () => {
    const second = await admin.rpc('create_invoice_draft', {
      p_matter_id: matterId,
      p_item_ids: [costId],
      p_issue_date: '2026-10-02',
      p_due_date: '2026-11-01',
      p_notes: null,
      p_terms: null,
      p_bill_to_name: null,
      p_bill_to_email: null,
      p_payment_link: null,
      p_actor_id: attorneyId,
    })
    expect(second.error).toBeNull()
    const clientDraft = second.data as { id: string; payer: string }
    expect(clientDraft.payer).toBe('client')

    const mixed = await admin.rpc('update_invoice_draft', {
      p_invoice_id: clientDraft.id,
      p_item_ids: [costId, claimIds[0]],
      p_issue_date: '2026-10-02',
      p_due_date: '2026-11-01',
      p_notes: null,
      p_terms: null,
      p_bill_to_name: null,
      p_bill_to_email: null,
      p_payment_link: null,
      p_actor_id: attorneyId,
    })
    expect(mixed.error?.message).toMatch(/billed to one payer|already on another invoice/)

    const issued = await admin.rpc('issue_invoice', { p_invoice_id: clientDraft.id, p_actor_id: attorneyId })
    expect(issued.error).toBeNull()
  })

  it('takes the carrier’s EFT payment and pays the claims', async () => {
    const paid = await admin.rpc('record_invoice_payment', {
      p_invoice_id: carrierInvoiceId,
      p_amount: 12_000,
      p_method: 'plan_eft',
      p_note: null,
      p_received_at: new Date().toISOString(),
      p_actor_id: attorneyId,
    })
    expect(paid.error).toBeNull()
    expect((paid.data as { status: string }).status).toBe('paid')
  })

  it('keeps a carrier invoice out of the client’s own reads', async () => {
    const { data, error } = await asClient
      .from('invoices')
      .select('payer')
      .eq('matter_id', matterId)
    expect(error).toBeNull()
    expect(data?.map(row => row.payer)).toEqual(['client'])

    const lines = await asClient.from('invoice_items').select('billing_item_id')
    expect(lines.error).toBeNull()
    expect(lines.data?.map(line => line.billing_item_id)).toEqual([costId])
  })
})
