import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function migration(): string {
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(migrationsDir).find(name => name.includes('attorney_mail_desk'))
  if (!filename) throw new Error('attorney_mail_desk migration not found')
  return fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
}

describe('attorney mail desk migration', () => {
  it('adds snooze, follow-up, and Gmail sort audit columns', () => {
    const sql = migration()
    for (const column of [
      'snoozed_until',
      'follow_up_at',
      'follow_up_note',
      'claimed_by',
      'thread_note',
      'gmail_sorted_at',
      'gmail_sort_label',
    ]) {
      expect(sql).toContain(column)
    }
  })

  it('links tasks back to triage threads', () => {
    const sql = migration()
    expect(sql).toContain('email_triage_thread_id')
    expect(sql).toContain('gmail_thread_id')
    expect(sql).toContain('REFERENCES public.email_triage_threads')
  })

  it('defaults archive-non-client on and reloads PostgREST', () => {
    const sql = migration()
    expect(sql).toContain('email_triage_archive_non_client boolean NOT NULL DEFAULT true')
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
