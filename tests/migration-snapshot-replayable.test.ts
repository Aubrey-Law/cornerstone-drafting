import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the repair of 20260806190324_remote_schema.sql — a `db pull` snapshot
 * whose real-timestamped version sorts ahead of the future-dated migrations
 * whose schema it captured, so it could never replay in position. It broke
 * `supabase db reset` for the whole repo until it was reduced to the objects it
 * genuinely owns. These assertions fail if someone restores the original.
 */
const snapshotPath = path.join(
  process.cwd(),
  'supabase/migrations/20260806190324_remote_schema.sql',
)
const snapshot = fs.readFileSync(snapshotPath, 'utf8')
const statements = snapshot
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')

describe('20260806190324 remote_schema snapshot', () => {
  it('still exists, so the remote history has a file behind it', () => {
    // Deleting it makes `db push` refuse to run and checkMigrationDrift report
    // an orphaned remote version.
    expect(fs.existsSync(snapshotPath)).toBe(true)
  })

  it('drops no views — policies on matter_documents depend on v_matter_pipeline', () => {
    expect(statements).not.toMatch(/drop\s+view/i)
  })

  it('defines no views — every one it carried is built by other migrations', () => {
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?view/i)
  })

  it('references no column or table that only exists later in the chain', () => {
    // v_communication_threads selected sms_messages.contact_id (20260828000000)
    // and read public.calls as reshaped by 20260902000001.
    expect(statements).not.toMatch(/v_communication_threads/i)
    expect(statements).not.toMatch(/contact_id/i)
  })

  it('redefines none of the public functions that later migrations own', () => {
    for (const fn of ['calls_autoassign', 'create_billing_item', 'sms_messages_autoassign']) {
      expect(statements).not.toContain(fn)
    }
  })

  it('grants only on the box tables it creates itself', () => {
    const grantTargets = [...statements.matchAll(/^grant[^;]*?on table "public"\."([a-z_]+)"/gim)]
      .map(match => match[1])
    expect(grantTargets.length).toBeGreaterThan(0)
    // Granting on a table another migration creates later fails the replay with
    // `relation "public.communication_thread_state" does not exist`.
    expect([...new Set(grantTargets)].sort()).toEqual(['box_document_exports', 'box_matter_folders'])
  })

  it('still creates the box queue, which no other migration does', () => {
    expect(statements).toMatch(/create schema if not exists "box_private"/i)
    expect(statements).toMatch(/create table "public"\."box_document_exports"/i)
    expect(statements).toMatch(/create table "public"\."box_matter_folders"/i)
    expect(statements).toContain('box_private.enqueue_box_document_export()')
  })

  it('keeps check_function_bodies off ahead of the queue function', () => {
    // enqueue_box_document_export() reads NEW.folder, a matter_documents column
    // dropped by 20260806135231. The trigger is gone so it never runs, but the
    // body is still validated at creation time without this.
    const guardAt = statements.indexOf('set check_function_bodies = off')
    const functionAt = statements.indexOf('box_private.enqueue_box_document_export()')
    expect(guardAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(functionAt)
  })

  it('drops pg_net, which production does not have', () => {
    expect(statements).toMatch(/drop extension if exists "pg_net"/i)
  })
})
