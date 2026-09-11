import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function triageMigration(): string {
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(migrationsDir).find(name => name.endsWith('_email_triage.sql'))
  if (!filename) throw new Error('email triage migration not found')
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

describe('email triage migration', () => {
  it('keeps the queue idempotent across rescans', () => {
    // Without this unique index every morning's scan appends the whole inbox
    // again. It is the conflict target for the upsert and the single most
    // load-bearing line in the migration.
    const sql = triageMigration()
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS email_triage_threads_mailbox_thread_key')
    expect(sql).toContain('ON public.email_triage_threads (connection_email, gmail_thread_id)')
  })

  it('stores no message body, only Gmail’s snippet', () => {
    const sql = triageMigration()
    const table = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.email_triage_threads'),
      sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS email_triage_threads_mailbox_thread_key'),
    )

    expect(table).toContain('snippet')
    // The privacy decision, pinned. Persisting inbound bodies would make this
    // database a second copy of the mailbox — the same confidentiality duty
    // with none of Gmail's retention controls, holding mail from third parties
    // who never consented to it. Adding such a column should have to argue with
    // this test rather than pass unnoticed in review.
    for (const forbidden of ['body_text', 'body_html', 'message_body', 'raw_message', 'full_body']) {
      expect(table).not.toContain(forbidden)
    }
    // `draft_body` is the firm's own drafted reply, which is the product.
    expect(table).toContain('draft_body')
  })

  it('covers every status the scan and the page can write', () => {
    const sql = triageMigration()
    for (const status of [
      'needs_reply', 'drafting', 'drafted', 'approved', 'dismissed', 'replied', 'failed',
    ]) {
      expect(sql).toContain(`'${status}'`)
    }
  })

  it('constrains classification to the four kinds that reach the queue', () => {
    const sql = triageMigration()
    expect(sql).toContain("classification IN ('client', 'lead', 'contact', 'possible_lead')")
  })

  it('enables row level security with a staff policy on every new table', () => {
    // RLS without a policy is a table nobody can read; a table without RLS is
    // one the anon key can read straight through PostgREST. Both new tables
    // hold mailbox metadata, so neither may be left open.
    const sql = triageMigration()
    for (const table of [
      'email_triage_threads',
      'email_triage_ignore_rules',
      'email_triage_scans',
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
      expect(sql).toContain(`ON public.${table} FOR`)
    }
    expect(sql).toContain("u.role IN ('attorney', 'admin')")
  })

  it('ships switched off, so the feature can be disabled without a redeploy', () => {
    const sql = triageMigration()
    expect(sql).toContain('email_triage_enabled boolean NOT NULL DEFAULT false')
  })

  it('reloads the PostgREST schema cache', () => {
    // Documented in AGENTS.md: without this PostgREST keeps serving the old
    // schema and reports that the new columns do not exist.
    expect(triageMigration()).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it('sorts after the migration that last touched email', () => {
    const names = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations'))
      .filter(name => name.endsWith('.sql'))
      .sort()
    const triage = names.findIndex(name => name.endsWith('_email_triage.sql'))
    const provider = names.findIndex(name => name.endsWith('_email_provider_gmail.sql'))
    expect(triage).toBeGreaterThan(provider)
  })
})

describe('the legal-vendor seed migration', () => {
  function vendorSeed(): string {
    const dir = path.join(process.cwd(), 'supabase/migrations')
    const name = fs.readdirSync(dir).find(f => f.endsWith('_email_triage_legal_vendor_seed.sql'))
    if (!name) throw new Error('vendor seed migration not found')
    return fs.readFileSync(path.join(dir, name), 'utf8')
  }

  it('seeds the plan administrators this firm actually bills through', () => {
    // LegalEASE alone was seven of the seventeen rows the first production
    // scan queued, every one of them read as a possible new lead.
    const sql = vendorSeed()
    for (const domain of ['legaleaseplan.com', 'legalplans.com', 'clcadvantage.com']) {
      expect(sql).toContain(domain)
    }
  })

  it('seeds the recording and payment systems that mail notices, not people', () => {
    const sql = vendorSeed()
    for (const domain of ['simplifile.com', 'squareup.com', 'clio.com']) {
      expect(sql).toContain(domain)
    }
  })

  it('adds rows without disturbing the ones already there', () => {
    // The attorney's own dismissals wrote rules into this table before this
    // migration ran. A seed that clobbered them would silently un-ignore
    // senders he had already silenced.
    const sql = vendorSeed()
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/i)
  })

  it('sorts after the migration that created the table', () => {
    const names = fs.readdirSync(path.join(process.cwd(), 'supabase/migrations'))
      .filter(n => n.endsWith('.sql')).sort()
    expect(names.findIndex(n => n.endsWith('_email_triage_legal_vendor_seed.sql')))
      .toBeGreaterThan(names.findIndex(n => n.endsWith('_email_triage.sql')))
  })
})
