import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('email settings and templates', () => {
  it('defines lite email categories without lead or triage', () => {
    const categories = fs.readFileSync(path.join(process.cwd(), 'lib/email/categories.ts'), 'utf8')
    expect(categories).toContain("'intake_invite'")
    expect(categories).toContain("'manual'")
    expect(categories).not.toContain('lead_notification')
    expect(categories).not.toContain('outlook_reply')
    expect(categories).not.toContain('post_discovery_followup')
  })

  it('uses category settings and templates in the send pipeline', () => {
    const send = fs.readFileSync(path.join(process.cwd(), 'lib/email/send.ts'), 'utf8')
    expect(send).toContain('getAllSettings')
    expect(send).toContain('getDefaultEmailTemplate')
    expect(send).toContain('applyEmailTemplate')
    expect(send).toContain('email_log')
    expect(send).toContain("input.html !== undefined ? { html: input.html }")
    const gmail = fs.readFileSync(path.join(process.cwd(), 'lib/email/gmailSend.ts'), 'utf8')
    expect(gmail).toContain('gmail/v1/users/me/messages/send')
  })

  it('exposes admin email settings API and UI tab', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/email/route.ts'),
      'utf8',
    )
    const settings = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/StaffSettingsClient.tsx'),
      'utf8',
    )
    const nav = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/settings/settingsNav.ts'),
      'utf8',
    )
    expect(route).toContain("from('email_settings')")
    expect(route).toContain('emailLogoHeader')
    expect(nav).toContain("tab: 'email'")
    expect(settings).toContain('EmailSettingsSection')
  })

  it('exposes template CRUD API', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/email/templates/route.ts'),
      'utf8',
    )
    expect(route).toContain("from('email_templates')")
    expect(route).toContain('sanitizeEmailHtml')
  })

  it('includes migration for firm_settings and email_templates', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260719000000_lite_email_settings.sql'),
      'utf8',
    )
    expect(migration).toContain('firm_settings')
    expect(migration).toContain('email_templates')
    expect(migration).not.toContain('email_triage')
  })

  it('defines firm signatures and owner-scoped durable email drafts', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260729173000_email_signatures_and_drafts.sql'),
      'utf8',
    )
    expect(migration).toContain('email_signature_html')
    expect(migration).toContain('email_signature_default')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.email_drafts')
    expect(migration).toContain('user_id = auth.uid()')
    const signatureRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/email/signature/route.ts'),
      'utf8',
    )
    const draftRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email/draft/route.ts'),
      'utf8',
    )
    expect(signatureRoute).toContain('requireAdministrator')
    expect(signatureRoute).toContain('sanitizeEmailHtml')
    expect(draftRoute).toContain(".eq('user_id', userId)")
  })

  it('defines the scheduled email queue, cancellation API, and cron worker', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260729190000_scheduled_emails.sql'),
      'utf8',
    )
    const scheduleRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email/scheduled/route.ts'),
      'utf8',
    )
    const cancelRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/email/scheduled/[id]/route.ts'),
      'utf8',
    )
    const cronRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/cron/scheduled-emails/route.ts'),
      'utf8',
    )
    const vercel = fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.scheduled_emails')
    expect(migration).toContain("status IN ('pending', 'processing', 'sent', 'suppressed', 'failed', 'cancelled')")
    expect(scheduleRoute).toContain('scheduledFor')
    expect(scheduleRoute).toContain('Resolve or remove all template variables')
    expect(cancelRoute).toContain(".eq('status', 'pending')")
    expect(cronRoute).toContain('CRON_SECRET')
    expect(vercel).toContain('/api/cron/scheduled-emails')
  })
})
