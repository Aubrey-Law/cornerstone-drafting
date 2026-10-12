import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { stripPlusTag } from '@/lib/emailTriage/classifySender'

export const dynamic = 'force-dynamic'

export type IgnoreRuleKind = 'domain' | 'address'

export type IgnoreRuleDto = {
  id: string
  kind: IgnoreRuleKind
  value: string
  note: string | null
  createdAt: string
  createdBy: string | null
}

type IgnoreRuleRow = {
  id: string
  kind: string
  value: string
  note: string | null
  created_at: string
  created_by: string | null
}

function toDto(row: IgnoreRuleRow): IgnoreRuleDto {
  return {
    id: row.id,
    kind: row.kind === 'domain' ? 'domain' : 'address',
    value: row.value,
    note: row.note,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '')
  if (!trimmed) return null
  // Reject emails pasted into the domain field; ask for the host only.
  if (trimmed.includes('@') || trimmed.includes(' ') || !trimmed.includes('.')) return null
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(trimmed)) {
    return null
  }
  return trimmed
}

function normalizeAddress(raw: string): string | null {
  const trimmed = stripPlusTag(raw.trim())
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

// GET /api/admin/settings/mail-desk/ignore-rules — list ignored senders & domains.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { data, error } = await getAdminClient()
    .from('email_triage_ignore_rules')
    .select('id, kind, value, note, created_at, created_by')
    .order('kind', { ascending: true })
    .order('value', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rules = ((data ?? []) as IgnoreRuleRow[]).map(toDto)
  return NextResponse.json({ rules })
}

// POST /api/admin/settings/mail-desk/ignore-rules — add a sender or domain ignore.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = await req.json().catch(() => null) as {
    kind?: unknown
    value?: unknown
    note?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const kind: IgnoreRuleKind | null =
    body.kind === 'domain' || body.kind === 'address' ? body.kind : null
  if (!kind) {
    return NextResponse.json({ error: 'kind must be "domain" or "address"' }, { status: 400 })
  }

  const rawValue = typeof body.value === 'string' ? body.value : ''
  const value = kind === 'domain' ? normalizeDomain(rawValue) : normalizeAddress(rawValue)
  if (!value) {
    return NextResponse.json(
      {
        error: kind === 'domain'
          ? 'Enter a domain like vendor.com'
          : 'Enter an email address like name@vendor.com',
      },
      { status: 400 },
    )
  }

  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null

  const { data, error } = await getAdminClient()
    .from('email_triage_ignore_rules')
    .insert({
      kind,
      value,
      note,
      created_by: auth.userId ?? null,
    })
    .select('id, kind, value, note, created_at, created_by')
    .single()

  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return NextResponse.json({ error: 'That sender or domain is already ignored' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rule: toDto(data as IgnoreRuleRow) }, { status: 201 })
}
