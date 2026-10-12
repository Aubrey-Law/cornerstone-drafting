import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type MailDeskSettingsRow = {
  email_triage_enabled: boolean | null
  email_triage_archive_non_client: boolean | null
}

function isMissingColumnError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('does not exist') || lower.includes('schema cache')
}

async function loadMailDeskSettings(): Promise<MailDeskSettingsRow> {
  const { data, error } = await getAdminClient()
    .from('firm_settings')
    .select('email_triage_enabled, email_triage_archive_non_client')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? {
    email_triage_enabled: false,
    email_triage_archive_non_client: true,
  }) as MailDeskSettingsRow
}

// GET /api/admin/settings/mail-desk — firm Mail Desk toggles.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  try {
    const row = await loadMailDeskSettings()
    return NextResponse.json({
      emailTriageEnabled: Boolean(row.email_triage_enabled),
      // Default on when the column is missing or null — matches scan/mailboxSort.
      archiveNonClient: row.email_triage_archive_non_client !== false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Mail Desk settings'
    if (isMissingColumnError(message)) {
      return NextResponse.json(
        { error: 'Run migrations so firm_settings has Mail Desk columns.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PUT /api/admin/settings/mail-desk — enable triage and/or archive non-client mail.
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = await req.json().catch(() => null) as {
    emailTriageEnabled?: unknown
    archiveNonClient?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: auth.userId ?? null,
  }
  if (typeof body.emailTriageEnabled === 'boolean') {
    patch.email_triage_enabled = body.emailTriageEnabled
  }
  if (typeof body.archiveNonClient === 'boolean') {
    patch.email_triage_archive_non_client = body.archiveNonClient
  }
  if (Object.keys(patch).length === 2) {
    return NextResponse.json(
      { error: 'emailTriageEnabled or archiveNonClient is required' },
      { status: 400 },
    )
  }

  const { error } = await getAdminClient()
    .from('firm_settings')
    .update(patch)
    .eq('id', 1)
  if (error) {
    if (isMissingColumnError(error.message)) {
      return NextResponse.json(
        { error: 'Run migrations so firm_settings has Mail Desk columns.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const row = await loadMailDeskSettings()
  return NextResponse.json({
    ok: true,
    emailTriageEnabled: Boolean(row.email_triage_enabled),
    archiveNonClient: row.email_triage_archive_non_client !== false,
  })
}
