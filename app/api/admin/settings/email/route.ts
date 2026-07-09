import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_META,
  isEmailCategory,
  isEmailProvider,
  type EmailMode,
  type EmailProvider,
} from '@/lib/email/categories'
import {
  clearSettingsCache,
  envEmailsHardKilled,
  getAllowlist,
  getTestInbox,
} from '@/lib/email/settings'
import { getStoredCalendarConnection, getAnyMicrosoftConnection } from '@/lib/calendarConnections'
import { hasMailSendScope } from '@/lib/microsoftCalendar'
import { clearFirmSettingsCache, loadFirmSettings } from '@/lib/firmSettings'

const VALID_MODES: EmailMode[] = ['on', 'off', 'redirect']

export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('email_settings')
    .select('category, mode, provider, updated_at, updated_by')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byCategory = new Map<string, { mode: EmailMode; provider: EmailProvider; updated_at: string; updated_by: string | null }>()
  for (const row of (data ?? []) as { category: string; mode: EmailMode; provider: EmailProvider | null; updated_at: string; updated_by: string | null }[]) {
    byCategory.set(row.category, { ...row, provider: row.provider ?? 'resend' })
  }

  const msConn =
    (userId ? await getStoredCalendarConnection(userId, 'microsoft') : null) ??
    (await getAnyMicrosoftConnection())
  const graphAvailable = Boolean(msConn) && hasMailSendScope(msConn?.scopes)
  const graphAccountEmail = msConn?.email ?? null

  const { data: lastSends } = await admin
    .from('email_log')
    .select('category, status, sent_at, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const lastByCategory = new Map<string, { sent_at: string; status: string }>()
  for (const row of (lastSends ?? []) as { category: string | null; status: string; sent_at: string | null; created_at: string }[]) {
    if (row.category && !lastByCategory.has(row.category)) {
      lastByCategory.set(row.category, {
        sent_at: row.sent_at ?? row.created_at,
        status: row.status,
      })
    }
  }

  const categories = EMAIL_CATEGORIES.map(c => {
    const setting = byCategory.get(c)
    const last = lastByCategory.get(c)
    return {
      ...EMAIL_CATEGORY_META[c],
      mode: (setting?.mode ?? 'off') as EmailMode,
      provider: (setting?.provider ?? 'resend') as EmailProvider,
      updatedAt: setting?.updated_at ?? null,
      updatedBy: setting?.updated_by ?? null,
      lastSentAt: last?.sent_at ?? null,
      lastSendStatus: last?.status ?? null,
    }
  })

  const firm = await loadFirmSettings()

  return NextResponse.json({
    categories,
    envHardKilled: envEmailsHardKilled(),
    testInbox: getTestInbox(),
    allowlist: getAllowlist(),
    emailLogoHeader: firm.emailLogoHeader,
    graph: {
      available: graphAvailable,
      accountEmail: graphAccountEmail,
      missingScope: Boolean(msConn) && !graphAvailable,
    },
  })
}

export async function PUT(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { category?: unknown; mode?: unknown; provider?: unknown; emailLogoHeader?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Global logo-header toggle (firm_settings, single row) — handled separately
  // from per-category mode/provider.
  if (typeof body.emailLogoHeader === 'boolean') {
    const admin = getAdminClient()
    const { error } = await admin
      .from('firm_settings' as never)
      .update({
        email_logo_header: body.emailLogoHeader,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      } as never)
      .eq('id', 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    clearFirmSettingsCache()
    return NextResponse.json({ ok: true })
  }

  const { category, mode, provider } = body
  if (!isEmailCategory(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }
  if (mode !== undefined && (typeof mode !== 'string' || !VALID_MODES.includes(mode as EmailMode))) {
    return NextResponse.json({ error: 'mode must be on|off|redirect' }, { status: 400 })
  }
  if (provider !== undefined && !isEmailProvider(provider)) {
    return NextResponse.json({ error: 'provider must be resend|graph' }, { status: 400 })
  }
  if (mode === undefined && provider === undefined) {
    return NextResponse.json({ error: 'mode or provider is required' }, { status: 400 })
  }

  if (provider === 'graph') {
    const conn =
      (userId ? await getStoredCalendarConnection(userId, 'microsoft') : null) ??
      (await getAnyMicrosoftConnection())
    if (!conn || !hasMailSendScope(conn.scopes)) {
      return NextResponse.json(
        { error: 'Microsoft mailbox not connected with Mail.Send scope. Connect from Settings → Outlook.' },
        { status: 400 },
      )
    }
  }

  const admin = getAdminClient()
  const update: Record<string, unknown> = {
    category,
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  }
  if (mode !== undefined) update.mode = mode
  if (provider !== undefined) update.provider = provider

  const { error } = await admin
    .from('email_settings')
    .upsert(update, { onConflict: 'category' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  clearSettingsCache()
  return NextResponse.json({ ok: true })
}
