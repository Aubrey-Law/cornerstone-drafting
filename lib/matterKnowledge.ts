/**
 * Everything the firm knows about one matter, in a shape the assistant can read.
 *
 * The chat's system prompt (lib/adminChat/engine.ts) already carries the facts
 * that shape drafting — intake, design sheet, fiduciaries, assets. It stops
 * there on purpose: it is rebuilt on every turn and cached as a prompt prefix,
 * so putting the document list, the ledger, every task and the whole message
 * history in it would cost that on every message and still be stale the moment
 * anything changed.
 *
 * This module is the other half — the parts of a matter that are large,
 * changeable, or only occasionally relevant — loaded on demand through a tool
 * call instead. Each section is independent and self-limiting, so the assistant
 * pulls the two or three it actually needs to answer.
 *
 * Every read here is service-role. The caller is responsible for having
 * established that the requester is firm staff; `requireAdmin` does that at the
 * route, and these tools are only ever wired into admin chat surfaces.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { documentFolderId } from '@/lib/documentWorkspace'
import type { MatterDocument, MatterDocumentFolder } from '@/types/database'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { computeNextAction } from '@/lib/leads/nextAction'
import { scoringAppointmentAt } from '@/lib/leads/score'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'
import { leadOperationalBrief } from '@/lib/lifecycle/lead'
import { matterOperationalBrief } from '@/lib/lifecycle/matter'
import { loadMatterLifecycleContext } from '@/lib/lifecycle/server'
import { computeMatterNextAction } from '@/lib/matterNextAction'

export const MATTER_SECTIONS = [
  'overview',
  'lifecycle',
  'people',
  'documents',
  'notes',
  'tasks',
  'billing',
  'communications',
  'appointments',
  'activity',
  'engagement',
] as const

export type MatterSection = (typeof MATTER_SECTIONS)[number]

export const MATTER_SECTION_DESCRIPTIONS: Record<MatterSection, string> = {
  overview: 'Matter number, name, practice area, stage, status, plan and dates.',
  lifecycle: 'Canonical operational brief: next action, known and missing facts, ownership, conflicts and next-stage blockers.',
  people: 'Everyone on the matter — client, spouse, children, fiduciaries — with contact details.',
  documents: 'Every document filed to the matter: name, folder, provenance, size, sharing and review state.',
  notes: 'Matter notes, newest first.',
  tasks: 'Open and recently completed tasks, with due dates and assignees.',
  billing: 'Charges, invoices and payments, in dollars.',
  communications: 'Portal messages, SMS, logged emails and calls, newest first.',
  appointments: 'Scheduled, cancelled and past appointments linked to the matter.',
  activity: 'The matter activity feed — stage changes, uploads, sends.',
  engagement: 'Engagement agreement status and signing history.',
}

/** Per-section row cap. Enough to answer from, small enough to stay in context. */
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 200

interface SectionResult {
  section: MatterSection
  /** Present when the section could not be read; the rest still comes back. */
  error?: string
  [key: string]: unknown
}

export interface MatterDossier {
  matter_id: string
  matter_label: string | null
  sections: SectionResult[]
}

type Client = SupabaseClient<never>

function money(cents: number | null | undefined): number {
  return Math.round(Number(cents ?? 0)) / 100
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit as number), 1), MAX_LIMIT)
}

function fullName(row: Record<string, unknown>): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
}

type RecordType = 'matter' | 'lead'

export interface MatterRecordMatch {
  /** The id the rest of the app routes on: the matter id for a hired matter, the client_intake id for a lead. */
  id: string
  type: RecordType
  label: string
  matter_number: string | null
  stage: string | null
  status: string | null
  lead_status: string | null
  client_name: string | null
  client_email: string | null
  url: string
}

interface IntakeRow {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  lead_status: string | null
  matter_id: string | null
}

interface MatterRow {
  id: string
  name: string | null
  matter_number: string | null
  relationship_status: string | null
  stage: string | null
  status: string | null
  client_intake_id: string | null
}

const INTAKE_COLUMNS = 'id, first_name, last_name, full_name, email, phone, lead_status, matter_id'
const MATTER_COLUMNS = 'id, name, matter_number, relationship_status, stage, status, client_intake_id'

function intakeName(intake: IntakeRow | null | undefined): string | null {
  if (!intake) return null
  const name = intake.full_name?.trim() || [intake.first_name, intake.last_name].filter(Boolean).join(' ').trim()
  return name || null
}

/** One record from a matter row and/or its intake row. A lead routes on the intake id. */
function recordFrom(matter: MatterRow | null, intake: IntakeRow | null): MatterRecordMatch | null {
  if (!matter && !intake) return null
  const hired = matter?.relationship_status === 'hired'
  const type: RecordType = hired ? 'matter' : 'lead'
  const leadId = intake?.id ?? matter?.client_intake_id ?? null
  const id = type === 'matter' || !leadId ? matter!.id : leadId
  const clientName = intakeName(intake)
  return {
    id,
    type,
    label: matter?.name?.trim() || clientName || intake?.email || id,
    matter_number: matter?.matter_number ?? null,
    stage: matter?.stage ?? null,
    status: matter?.status ?? null,
    lead_status: intake?.lead_status ?? null,
    client_name: clientName,
    client_email: intake?.email ?? null,
    url: type === 'matter' ? `/admin/matters/${matter!.id}` : `/admin/crm/opportunities/${id}`,
  }
}

/**
 * Matters and leads that match free text, so the assistant can answer "what is
 * going on with the Chens?" without being opened on that matter first.
 *
 * Reads `matters` and `client_intake` directly. It used to read the pipeline
 * view, which carries hired matters only — every lead, lost matter and
 * not-yet-converted intake was invisible to find_matter, to the chat's record
 * picker and to the chat header.
 */
export async function searchMatterRecords(query: string, limit = 10): Promise<MatterRecordMatch[]> {
  const term = query.trim()
  if (!term) return []
  const admin = getAdminClient() as Client
  const like = `%${term.replace(/[%_]/g, match => `\\${match}`)}%`
  const cap = clampLimit(limit)
  // Over-fetch each side so the merge below still has `cap` distinct records to choose from.
  const fetchCap = Math.min(MAX_LIMIT, cap * 3)

  const [intakeRes, matterRes] = await Promise.all([
    admin
      .from('client_intake')
      .select(INTAKE_COLUMNS)
      .or(`first_name.ilike.${like},last_name.ilike.${like},full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .limit(fetchCap),
    admin
      .from('matters')
      .select(MATTER_COLUMNS)
      .or(`name.ilike.${like},matter_number.ilike.${like}`)
      .limit(fetchCap),
  ])
  if (intakeRes.error) throw new Error(`record search failed: ${intakeRes.error.message}`)
  if (matterRes.error) throw new Error(`record search failed: ${matterRes.error.message}`)

  const intakes = new Map<string, IntakeRow>()
  for (const row of (intakeRes.data ?? []) as IntakeRow[]) intakes.set(row.id, row)
  const matters = new Map<string, MatterRow>()
  for (const row of (matterRes.data ?? []) as MatterRow[]) matters.set(row.id, row)

  // Complete each side: a matched intake's matter, a matched matter's intake.
  const missingMatterIds = [...intakes.values()].map(row => row.matter_id).filter((id): id is string => Boolean(id) && !matters.has(id as string))
  if (missingMatterIds.length > 0) {
    const { data } = await admin.from('matters').select(MATTER_COLUMNS).in('id', missingMatterIds)
    for (const row of (data ?? []) as MatterRow[]) matters.set(row.id, row)
  }
  const missingIntakeIds = [...matters.values()].map(row => row.client_intake_id).filter((id): id is string => Boolean(id) && !intakes.has(id as string))
  if (missingIntakeIds.length > 0) {
    const { data } = await admin.from('client_intake').select(INTAKE_COLUMNS).in('id', missingIntakeIds)
    for (const row of (data ?? []) as IntakeRow[]) intakes.set(row.id, row)
  }

  // One record per matter (or per matterless intake), whichever side matched.
  const records = new Map<string, MatterRecordMatch>()
  for (const matter of matters.values()) {
    const intake = matter.client_intake_id ? intakes.get(matter.client_intake_id) ?? null : null
    const record = recordFrom(matter, intake)
    if (record) records.set(`matter:${matter.id}`, record)
  }
  for (const intake of intakes.values()) {
    if (intake.matter_id && matters.has(intake.matter_id)) continue
    const record = recordFrom(null, intake)
    if (record) records.set(`intake:${intake.id}`, record)
  }

  return [...records.values()]
    .sort((a, b) => (a.type === b.type ? a.label.localeCompare(b.label) : a.type === 'matter' ? -1 : 1))
    .slice(0, cap)
}

/**
 * A short label for one record — the matter's name (or the client's), its
 * number, and whether it is a lead. What a chat header shows for the record it
 * is pointed at.
 */
export async function describeRecord(
  id: string,
): Promise<{ id: string; type: RecordType; label: string; url: string } | null> {
  const admin = getAdminClient() as Client
  let matter: MatterRow | null = null
  let intake: IntakeRow | null = null

  const { data: matterRow } = await admin.from('matters').select(MATTER_COLUMNS).eq('id', id).maybeSingle()
  if (matterRow) {
    matter = matterRow as MatterRow
    if (matter.client_intake_id) {
      const { data } = await admin.from('client_intake').select(INTAKE_COLUMNS).eq('id', matter.client_intake_id).maybeSingle()
      intake = (data as IntakeRow | null) ?? null
    }
  } else {
    const { data } = await admin.from('client_intake').select(INTAKE_COLUMNS).eq('id', id).maybeSingle()
    intake = (data as IntakeRow | null) ?? null
    if (!intake) return null
    if (intake.matter_id) {
      const { data: owner } = await admin.from('matters').select(MATTER_COLUMNS).eq('id', intake.matter_id).maybeSingle()
      matter = (owner as MatterRow | null) ?? null
    }
  }

  const record = recordFrom(matter, intake)
  if (!record) return null
  const number = record.type === 'matter' && record.matter_number ? `#${record.matter_number}` : ''
  return {
    id,
    type: record.type,
    label: [record.label, number].filter(Boolean).join(' · '),
    url: record.type === 'matter' ? record.url : `/admin/crm/opportunities/${record.id}`,
  }
}

/**
 * The matter id behind whatever id the caller has.
 *
 * A lead is matter-owned but its own id is a `client_intake` row — that is what
 * a lead chat carries as its context id, and what the lead pages route on.
 * Every section below reads by matter, so an unresolved lead id would find
 * nothing at all rather than reporting the lead's record.
 */
export async function resolveRecordMatterId(id: string): Promise<string | null> {
  const admin = getAdminClient() as Client
  const { data: matter } = await admin.from('matters').select('id').eq('id', id).maybeSingle()
  if (matter) return String((matter as Record<string, unknown>).id)

  const { data: intake } = await admin
    .from('client_intake')
    .select('matter_id')
    .eq('id', id)
    .maybeSingle()
  const matterId = (intake as Record<string, unknown> | null)?.matter_id
  return typeof matterId === 'string' ? matterId : null
}

async function loadOverview(admin: Client, matterId: string) {
  const [matterRes, pipelineRes, detailsRes] = await Promise.all([
    admin
      .from('matters')
      .select('id, matter_number, name, stage, status, relationship_status, created_at, client_intake_id')
      .eq('id', matterId)
      .maybeSingle(),
    admin
      .from('v_matter_pipeline')
      .select(
        'matter_name, stage, status, practice_area, plan_type, client_name, client_email, client_phone, ' +
        'marital_status, intake_status, design_status, intake_submitted_at, drafts_sent_at, signing_date, ' +
        'documents_executed_at, next_appointment, next_appointment_type, fee_amount, opened_at, flags',
      )
      .eq('matter_id', matterId)
      .maybeSingle(),
    admin
      .from('matter_details')
      .select('practice_area, legal_plan, legal_plan_id, ep_plan_category, plan_type')
      .eq('client_id', matterId)
      .maybeSingle(),
  ])

  const matter = (matterRes.data ?? null) as Record<string, unknown> | null
  if (!matter) throw new Error('Matter not found')
  const pipeline = (pipelineRes.data ?? {}) as Record<string, unknown>
  const details = (detailsRes.data ?? {}) as Record<string, unknown>

  // The pipeline view carries hired matters only. A lead's client fields come
  // from its intake row instead, so a lead overview still names the client.
  let intake: IntakeRow | null = null
  if (!pipelineRes.data && typeof matter.client_intake_id === 'string') {
    const { data } = await admin.from('client_intake').select(INTAKE_COLUMNS).eq('id', matter.client_intake_id).maybeSingle()
    intake = (data as IntakeRow | null) ?? null
  }

  return {
    matter_number: matter.matter_number ?? null,
    name: matter.name ?? pipeline.matter_name ?? null,
    record_type: matter.relationship_status === 'hired' ? 'matter' : 'lead',
    stage: matter.stage ?? pipeline.stage ?? null,
    status: matter.status ?? pipeline.status ?? null,
    practice_area: details.practice_area ?? pipeline.practice_area ?? null,
    plan_type: details.ep_plan_category ?? details.plan_type ?? pipeline.plan_type ?? null,
    legal_plan: details.legal_plan ?? null,
    legal_plan_member_id: details.legal_plan_id ?? null,
    client_name: pipeline.client_name ?? intakeName(intake),
    client_email: pipeline.client_email ?? intake?.email ?? null,
    client_phone: pipeline.client_phone ?? intake?.phone ?? null,
    lead_status: intake?.lead_status ?? null,
    marital_status: pipeline.marital_status ?? null,
    flags: pipeline.flags ?? null,
    fee_amount: pipeline.fee_amount ?? null,
    opened_at: pipeline.opened_at ?? matter.created_at ?? null,
    intake_status: pipeline.intake_status ?? null,
    intake_submitted_at: pipeline.intake_submitted_at ?? null,
    design_status: pipeline.design_status ?? null,
    drafts_sent_at: pipeline.drafts_sent_at ?? null,
    signing_date: pipeline.signing_date ?? null,
    documents_executed_at: pipeline.documents_executed_at ?? null,
    next_appointment: pipeline.next_appointment ?? null,
    next_appointment_type: pipeline.next_appointment_type ?? null,
  }
}

async function loadLifecycle(admin: Client, matterId: string) {
  const { data: matter, error } = await admin
    .from('matters')
    .select('id, relationship_status, client_intake_id, discovery_call_at, pmps_at')
    .eq('id', matterId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!matter) throw new Error('Matter not found')
  const lifecycleMatter = matter as unknown as {
    id: string
    relationship_status: string | null
    client_intake_id: string | null
    discovery_call_at: string | null
    pmps_at: string | null
  }

  if (lifecycleMatter.relationship_status === 'hired') {
    const context = await loadMatterLifecycleContext(matterId)
    if (!context) throw new Error('Matter lifecycle not found')
    return {
      record_type: 'matter',
      next_action: computeMatterNextAction(context.matter, context.engagement, context.reviewFlags),
      operational_brief: matterOperationalBrief(
        context.matter,
        context.engagement,
        context.reviewFlags,
      ),
    }
  }

  if (!lifecycleMatter.client_intake_id) throw new Error('Lead intake not found')
  const [{ data: intake, error: intakeError }, spouse] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', lifecycleMatter.client_intake_id).maybeSingle(),
    loadSpouseContact(admin as never, matterId),
  ])
  if (intakeError) throw new Error(intakeError.message)
  if (!intake) throw new Error('Lead intake not found')

  const lead = intake as unknown as LeadDetailRecord
  const nextAppointmentAt = scoringAppointmentAt(lifecycleMatter.discovery_call_at, lifecycleMatter.pmps_at)
  const nextAction = computeNextAction({
    leadStatus: lead.lead_status ?? 'lead',
    intakeSentAt: lead.intake_sent_at ?? null,
    intakeCompletedAt: lead.intake_completed_at ?? null,
    nextAppointmentAt,
    feeQuoted: lead.engagement_fee_quoted,
    hasActiveAgreement: Boolean(lead.engagement_sent_at || lead.engagement_status),
    engagementStatus: lead.engagement_status,
    engagementSentAt: lead.engagement_sent_at,
    engagementSignedAt: lead.engagement_signed_at,
    discoveryCallAt: lifecycleMatter.discovery_call_at,
    planningSessionAt: lifecycleMatter.pmps_at,
    lastTouchAt: lead.updated_at ?? null,
  })
  return {
    record_type: 'lead',
    next_action: nextAction,
    operational_brief: leadOperationalBrief({
      lead,
      spouse: spouse as LeadSpouseRecord | null,
      nextAction,
      nextAppointmentAt,
    }),
  }
}

async function loadPeople(admin: Client, matterId: string, limit: number) {
  const { data, error } = await admin
    .from('matter_contacts')
    .select(
      'relationship_type, relationship_label, for_party, child_relationship, is_minor, ' +
      'contacts(id, first_name, last_name, preferred_name, email, phone, date_of_birth, deceased, ' +
      'address_line1, city, state, zip)',
    )
    .eq('matter_id', matterId)
    .limit(limit)
  if (error) throw new Error(error.message)

  const people = ((data ?? []) as Array<Record<string, unknown>>).map(row => {
    const contact = (row.contacts ?? {}) as Record<string, unknown>
    return {
      name: fullName(contact) || (contact.preferred_name as string | null) || null,
      relationship: row.relationship_label ?? row.relationship_type ?? null,
      for_party: row.for_party ?? null,
      child_relationship: row.child_relationship ?? null,
      is_minor: row.is_minor ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      date_of_birth: contact.date_of_birth ?? null,
      deceased: contact.deceased ?? null,
      address: [contact.address_line1, contact.city, contact.state, contact.zip]
        .filter(Boolean)
        .join(', ') || null,
      contact_id: contact.id ?? null,
    }
  })

  // Fiduciary appointments live on contact_roles, keyed by contact.
  const contactIds = people.map(person => person.contact_id).filter(Boolean) as string[]
  const roles = new Map<string, string[]>()
  if (contactIds.length > 0) {
    const { data: roleRows } = await admin
      .from('contact_roles')
      .select('contact_id, role, for_party, priority, is_coagent')
      .in('contact_id', contactIds)
    for (const row of (roleRows ?? []) as Array<Record<string, unknown>>) {
      const key = String(row.contact_id)
      const label = `${row.role}${row.for_party ? ` (${row.for_party})` : ''} #${row.priority ?? 1}${row.is_coagent ? ' co-agent' : ''}`
      roles.set(key, [...(roles.get(key) ?? []), label])
    }
  }

  return {
    people: people.map(person => ({
      ...person,
      fiduciary_roles: person.contact_id ? roles.get(String(person.contact_id)) ?? [] : [],
    })),
  }
}

async function loadDocuments(admin: Client, matterId: string, limit: number) {
  const [documentsRes, foldersRes] = await Promise.all([
    admin
      .from('matter_documents')
      .select(MATTER_DOCUMENT_COLUMNS)
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('matter_document_folders')
      .select('id, name')
      .eq('matter_id', matterId),
  ])
  if (documentsRes.error) throw new Error(documentsRes.error.message)

  const folders = (foldersRes.data ?? []) as Pick<MatterDocumentFolder, 'id' | 'name'>[]
  const folderName = new Map(folders.map(folder => [folder.id, folder.name]))

  return {
    folders: folders.map(folder => folder.name),
    documents: ((documentsRes.data ?? []) as MatterDocument[]).map(doc => ({
      // The id is what read_document_text takes, so it has to come back.
      document_id: doc.id,
      name: doc.name,
      folder: doc.folder_id
        ? folderName.get(doc.folder_id) ?? null
        : documentFolderId(doc),
      source: doc.source,
      generated: Boolean(doc.generation_id),
      shared_with_client: doc.shared_at !== null,
      reviewed: doc.reviewed_at !== null,
      superseded: doc.superseded_at !== null,
      size_bytes: doc.size,
      content_type: doc.content_type,
      created_at: doc.created_at,
    })),
  }
}

async function loadNotes(admin: Client, matterId: string, limit: number) {
  const { data, error } = await admin
    .from('matter_notes')
    .select('created_at, note_type, body, author')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return { notes: data ?? [] }
}

async function loadTasks(admin: Client, matterId: string, limit: number) {
  const { data, error } = await admin
    .from('tasks')
    .select(
      'id, title, description, status, priority, task_type, stage_key, due_at, soft_due_at, ' +
      'hard_due_at, completed_at, created_at, checklist',
    )
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<Record<string, unknown>>
  return {
    open_count: rows.filter(row => row.status !== 'done' && row.status !== 'archived').length,
    tasks: rows.map(row => ({
      title: row.title,
      description: row.description ?? null,
      status: row.status,
      priority: row.priority,
      stage: row.stage_key ?? null,
      due_at: row.due_at ?? row.hard_due_at ?? row.soft_due_at ?? null,
      completed_at: row.completed_at ?? null,
      checklist: Array.isArray(row.checklist) && row.checklist.length > 0 ? row.checklist : null,
    })),
  }
}

async function loadBilling(admin: Client, matterId: string, limit: number) {
  const [itemsRes, invoicesRes] = await Promise.all([
    admin
      .from('billing_items')
      .select('id, kind, label, plan, amount_billed, status, invoiced_at, created_at, invoice_id')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('invoices')
      .select('id, number, kind, status, subtotal_cents, issue_date, due_date, paid_at, voided_at, sent_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])
  if (itemsRes.error) throw new Error(itemsRes.error.message)

  const items = (itemsRes.data ?? []) as Array<Record<string, unknown>>
  const itemIds = items.map(item => String(item.id))
  let payments: Array<Record<string, unknown>> = []
  if (itemIds.length > 0) {
    const { data } = await admin
      .from('billing_payments')
      .select('billing_item_id, amount, method, received_at, note')
      .in('billing_item_id', itemIds)
      .order('received_at', { ascending: false })
    payments = (data ?? []) as Array<Record<string, unknown>>
  }

  const billed = items.reduce((sum, item) => sum + Number(item.amount_billed ?? 0), 0)
  const collected = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)

  return {
    // Cents everywhere in the schema; dollars here, so the assistant never has
    // to divide and never reports $45,000 as $4,500,000.
    total_billed: money(billed),
    total_collected: money(collected),
    outstanding: money(billed - collected),
    charges: items.map(item => ({
      label: item.label,
      kind: item.kind,
      plan: item.plan ?? null,
      amount: money(item.amount_billed as number),
      status: item.status,
      invoiced_at: item.invoiced_at ?? null,
    })),
    invoices: ((invoicesRes.data ?? []) as Array<Record<string, unknown>>).map(invoice => ({
      number: invoice.number ?? null,
      kind: invoice.kind,
      status: invoice.status,
      amount: money(invoice.subtotal_cents as number),
      issue_date: invoice.issue_date ?? null,
      due_date: invoice.due_date ?? null,
      sent_at: invoice.sent_at ?? null,
      paid_at: invoice.paid_at ?? null,
      voided_at: invoice.voided_at ?? null,
    })),
    payments: payments.map(payment => ({
      amount: money(payment.amount as number),
      method: payment.method,
      received_at: payment.received_at,
      note: payment.note ?? null,
    })),
  }
}

async function loadCommunications(admin: Client, matterId: string, limit: number) {
  // These four tables all key matter_id as text, and each is its own channel.
  const [messagesRes, smsRes, emailRes, callsRes] = await Promise.all([
    admin
      .from('messages')
      .select('created_at, sender_role, body, read_at')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('sms_messages')
      .select('created_at, direction, body, status, recipient_name, recipient_role')
      .eq('matter_id', matterId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('email_log')
      .select('created_at, category, status, subject, actual_to, error')
      .eq('matter_id', matterId)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin
      .from('calls')
      .select('started_at, direction, status, duration_seconds, participant_number, summary, transcript')
      .eq('matter_id', matterId)
      .order('started_at', { ascending: false })
      .limit(limit),
  ])

  return {
    portal_messages: (messagesRes.data ?? []).map((row: Record<string, unknown>) => ({
      created_at: row.created_at,
      from: row.sender_role,
      body: row.body,
      read: row.read_at !== null,
    })),
    sms: (smsRes.data ?? []).map((row: Record<string, unknown>) => ({
      created_at: row.created_at,
      direction: row.direction,
      body: row.body,
      status: row.status,
      with: row.recipient_name ?? row.recipient_role ?? null,
    })),
    emails: (emailRes.data ?? []).map((row: Record<string, unknown>) => ({
      created_at: row.created_at,
      subject: row.subject ?? null,
      to: row.actual_to ?? null,
      category: row.category ?? null,
      status: row.status,
      error: row.error ?? null,
    })),
    calls: (callsRes.data ?? []).map((row: Record<string, unknown>) => ({
      started_at: row.started_at,
      direction: row.direction,
      status: row.status,
      duration_seconds: row.duration_seconds ?? null,
      number: row.participant_number ?? null,
      // The transcript can run to thousands of words; the summary is what a
      // question about a call almost always wants.
      summary: row.summary ?? null,
      has_transcript: Boolean(row.transcript),
    })),
  }
}

async function loadAppointments(admin: Client, matterId: string, limit: number) {
  const { data, error } = await admin
    .from('appointments')
    .select(
      'start_time, end_time, status, attendee_name, attendee_email, notes, source, ' +
      'appointment_types(name)',
    )
    .eq('linked_matter_id', matterId)
    .order('start_time', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)

  return {
    appointments: ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      type: (row.appointment_types as { name?: string } | null)?.name ?? null,
      attendee: row.attendee_name ?? null,
      attendee_email: row.attendee_email ?? null,
      notes: row.notes ?? null,
      booked_via: row.source ?? null,
    })),
  }
}

async function loadActivity(admin: Client, matterId: string, limit: number) {
  const { data, error } = await admin
    .from('matter_activity')
    .select('created_at, event_type, title, detail, actor_name, actor_email')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return { activity: data ?? [] }
}

async function loadEngagement(admin: Client, matterId: string, limit: number) {
  const { data, error } = await admin
    .from('engagement_agreements')
    .select('id, status, sent_at, completed_at, created_at, updated_at')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)

  const agreements = (data ?? []) as Array<Record<string, unknown>>
  const recipients = new Map<string, Array<Record<string, unknown>>>()
  if (agreements.length > 0) {
    const { data: recipientRows } = await admin
      .from('engagement_agreement_recipients')
      .select('agreement_id, name, email, role, signed_at, viewed_at')
      .in('agreement_id', agreements.map(row => String(row.id)))
    for (const row of (recipientRows ?? []) as Array<Record<string, unknown>>) {
      const key = String(row.agreement_id)
      recipients.set(key, [...(recipients.get(key) ?? []), row])
    }
  }

  return {
    agreements: agreements.map(agreement => ({
      status: agreement.status,
      sent_at: agreement.sent_at ?? null,
      completed_at: agreement.completed_at ?? null,
      created_at: agreement.created_at,
      signers: (recipients.get(String(agreement.id)) ?? []).map(recipient => ({
        name: recipient.name ?? null,
        email: recipient.email ?? null,
        role: recipient.role ?? null,
        viewed_at: recipient.viewed_at ?? null,
        signed_at: recipient.signed_at ?? null,
      })),
    })),
  }
}

const SECTION_LOADERS: Record<
  MatterSection,
  (admin: Client, matterId: string, limit: number) => Promise<Record<string, unknown>>
> = {
  overview: async (admin, matterId) => loadOverview(admin, matterId),
  lifecycle: async (admin, matterId) => loadLifecycle(admin, matterId),
  people: loadPeople,
  documents: loadDocuments,
  notes: loadNotes,
  tasks: loadTasks,
  billing: loadBilling,
  communications: loadCommunications,
  appointments: loadAppointments,
  activity: loadActivity,
  engagement: loadEngagement,
}

export function isMatterSection(value: unknown): value is MatterSection {
  return typeof value === 'string' && (MATTER_SECTIONS as readonly string[]).includes(value)
}

/**
 * Read the requested sections of a matter. A section that fails comes back
 * carrying its error rather than taking the others down with it — a missing
 * table or a schema drift in one channel must not make the whole record
 * unreadable.
 */
export async function loadMatterDossier(
  matterId: string,
  sections: MatterSection[],
  options: { limit?: number } = {},
): Promise<MatterDossier> {
  const admin = getAdminClient() as Client
  const limit = clampLimit(options.limit)
  const requested = sections.length > 0 ? [...new Set(sections)] : (['overview'] as MatterSection[])

  const results = await Promise.all(
    requested.map(async (section): Promise<SectionResult> => {
      try {
        return { section, ...(await SECTION_LOADERS[section](admin, matterId, limit)) }
      } catch (error) {
        return { section, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )

  const { data: matter } = await admin
    .from('matters')
    .select('name, matter_number')
    .eq('id', matterId)
    .maybeSingle()
  const row = (matter ?? null) as Record<string, unknown> | null
  const label = row
    ? [row.name, row.matter_number ? `#${row.matter_number}` : ''].filter(Boolean).join(' · ')
    : null

  return { matter_id: matterId, matter_label: label || null, sections: results }
}

/** How much of a document the assistant gets in one read. */
export const DOCUMENT_TEXT_LIMIT = 60_000

export interface DocumentTextResult {
  document_id: string
  name: string
  matter_id: string
  characters: number
  truncated: boolean
  text: string
}

/**
 * The words inside a stored document, so the assistant can summarize or quote
 * a draft rather than only knowing its filename. DOCX and PDF are extracted;
 * anything else is decoded as UTF-8, which covers text and JSON and produces
 * obvious garbage (rather than a plausible answer) for binary formats.
 */
export async function readMatterDocumentText(
  documentId: string,
  options: { maxCharacters?: number } = {},
): Promise<DocumentTextResult> {
  const admin = getAdminClient() as Client
  const { data: doc, error } = await admin
    .from('matter_documents')
    .select('id, matter_id, name, r2_key, content_type')
    .eq('id', documentId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) throw new Error('Document not found')

  const row = doc as Record<string, unknown>
  const name = String(row.name)
  const contentType = (row.content_type as string | null) ?? ''

  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const { getR2Client, r2Bucket } = await import('@/lib/r2')
  const object = await getR2Client().send(
    new GetObjectCommand({ Bucket: r2Bucket(), Key: String(row.r2_key) }),
  )
  if (!object.Body) throw new Error('Document body not found in storage')

  const chunks: Buffer[] = []
  for await (const chunk of object.Body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const buffer = Buffer.concat(chunks)

  const lower = name.toLowerCase()
  let text: string
  if (lower.endsWith('.docx') || contentType.includes('wordprocessingml')) {
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ buffer })).value
  } else if (lower.endsWith('.pdf') || contentType === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      text = typeof result.text === 'string' ? result.text : ''
    } finally {
      await parser.destroy()
    }
  } else if (lower.endsWith('.doc')) {
    // Legacy binary .doc has no extractor here; say so instead of returning
    // the mangled bytes as if they were the document.
    throw new Error('Legacy .doc files cannot be read as text. Convert to .docx first.')
  } else {
    text = buffer.toString('utf-8')
  }

  const max = clampCharacters(options.maxCharacters)
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    document_id: String(row.id),
    name,
    matter_id: String(row.matter_id),
    characters: normalized.length,
    truncated: normalized.length > max,
    text: normalized.slice(0, max),
  }
}

function clampCharacters(value?: number): number {
  if (!Number.isFinite(value)) return DOCUMENT_TEXT_LIMIT
  return Math.min(Math.max(Math.trunc(value as number), 500), DOCUMENT_TEXT_LIMIT)
}
