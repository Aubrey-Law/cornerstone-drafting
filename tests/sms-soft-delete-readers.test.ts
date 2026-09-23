import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A deleted text must disappear everywhere staff or the assistant can see it.
 * Each file that reads sms_messages for display has to exclude soft-deleted
 * rows; a new reader added without the filter would quietly resurrect them.
 */
const DISPLAY_READERS = [
  'app/api/admin/leads/[id]/sms-messages/route.ts',
  'app/api/admin/matters/[id]/sms-messages/route.ts',
  'app/api/admin/contacts/[id]/sms-messages/route.ts',
  'app/api/admin/contacts/[id]/draft-reply/route.ts',
  'app/admin/leads/[id]/page.tsx',
  'lib/matterKnowledge.ts',
  'lib/queries/smsThreads.ts',
]

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('soft-deleted texts stay hidden', () => {
  it.each(DISPLAY_READERS)('%s excludes deleted rows', path => {
    expect(source(path)).toContain(".is('deleted_at', null)")
  })

  it('the conversations view excludes deleted rows', () => {
    expect(source('supabase/migrations/20261225090000_sms_soft_delete_and_mark_old_read.sql'))
      .toMatch(/FROM public\.sms_messages sm\s+WHERE sm\.deleted_at IS NULL/)
  })

  it('deletes are soft: no route hard-deletes a text', () => {
    for (const path of [
      'lib/queries/smsThreads.ts',
      'app/api/admin/texts/messages/[id]/route.ts',
      'app/api/admin/texts/threads/[phone]/route.ts',
    ]) {
      expect(source(path)).not.toMatch(/from\('sms_messages'\)\s*\.delete\(/)
    }
  })
})
