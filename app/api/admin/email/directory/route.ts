import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface EmailDirectoryEntry {
  email: string
  name: string
  /** Where this address came from — matter number, "Lead", or a relationship. */
  detail: string | null
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

function personName(row: {
  full_name?: unknown
  preferred_name?: unknown
  first_name?: unknown
  last_name?: unknown
}): string {
  const full = typeof row.full_name === 'string' ? row.full_name.trim() : ''
  if (full) return full
  const first =
    (typeof row.preferred_name === 'string' && row.preferred_name.trim()) ||
    (typeof row.first_name === 'string' ? row.first_name.trim() : '')
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  return [first, last].filter(Boolean).join(' ')
}

/**
 * GET /api/admin/email/directory
 *
 * Every address the firm might email, for the compose pane's To/Cc/Bcc
 * typeahead. Loaded once per pane mount and filtered in the browser — a few
 * hundred rows, so no per-keystroke request.
 *
 * Matter people win over leads on a shared address, and both win over
 * relationship contacts, so the most specific label is the one shown.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const admin = getAdminClient()

  const [pipeline, matterNumbers, leads, contacts] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id, client_name, client_email, spouse_name, spouse_email'),
    admin.from('matters').select('id, matter_number').neq('status', 'archived'),
    admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, preferred_name, email, lead_status, matter_id')
      .or('lead_status.is.null,lead_status.neq.lost'),
    admin
      .from('contacts')
      .select('email, first_name, last_name, preferred_name, relationship_type, relationship_label')
      .not('email', 'is', null),
  ])

  if (pipeline.error) return NextResponse.json({ error: pipeline.error.message }, { status: 500 })

  const numberByMatter = new Map<string, string | null>(
    (matterNumbers.data ?? []).map(row => [row.id as string, (row.matter_number as string | null) ?? null]),
  )

  const seen = new Set<string>()
  const entries: EmailDirectoryEntry[] = []
  const push = (entry: EmailDirectoryEntry) => {
    if (seen.has(entry.email)) return
    seen.add(entry.email)
    entries.push(entry)
  }

  for (const row of pipeline.data ?? []) {
    const matterNumber = numberByMatter.get(row.matter_id as string) ?? null
    const client = cleanEmail(row.client_email)
    if (client) {
      push({
        email: client,
        name: (row.client_name as string | null)?.trim() || 'Client',
        detail: matterNumber ?? 'Client',
      })
    }
    const spouse = cleanEmail(row.spouse_email)
    if (spouse) {
      push({
        email: spouse,
        name: (row.spouse_name as string | null)?.trim() || 'Spouse',
        detail: matterNumber ? `${matterNumber} · spouse` : 'Spouse',
      })
    }
  }

  for (const row of leads.data ?? []) {
    const email = cleanEmail(row.email)
    if (!email) continue
    push({
      email,
      name: personName(row) || 'Lead',
      detail: row.matter_id ? 'Client' : 'Lead',
    })
  }

  for (const row of contacts.data ?? []) {
    const email = cleanEmail(row.email)
    if (!email) continue
    const relationship =
      (typeof row.relationship_label === 'string' && row.relationship_label.trim()) ||
      (typeof row.relationship_type === 'string' && row.relationship_type.trim()) ||
      null
    push({ email, name: personName(row) || 'Contact', detail: relationship })
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json(
    { entries },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
