import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_VERSION_SOURCES } from '@/lib/documentVersions'

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')

function migrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()
}

/** The live definition is whichever migration last redefined it. */
function newestMigrationWith(needle: string): string {
  for (const name of migrationFiles().reverse()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    if (sql.toLowerCase().includes(needle)) return sql
  }
  throw new Error(`no migration defines ${needle}`)
}

/** The values `document_versions_source_check` currently allows. */
function checkedSources(): string[] {
  const sql = newestMigrationWith('constraint document_versions_source_check\n  check')
  const start = sql.toLowerCase().indexOf('check (source = any (array[')
  const body = sql.slice(start, sql.indexOf(']))', start))
  return [...body.matchAll(/'([a-z_]+)'/g)].map(match => match[1])
}

/**
 * `source` is a CHECK-constrained text column, so the generated types call it
 * `string` and nothing else compares the two vocabularies. A value TypeScript
 * believes in and the database rejects fails at insert time — by which point
 * `createDocumentVersion` has already put the bytes in R2, so the attorney's
 * save is lost and the object is orphaned.
 */
describe('document_versions.source', () => {
  it('allows every source the code writes', () => {
    expect(checkedSources().sort()).toEqual([...DOCUMENT_VERSION_SOURCES].sort())
  })

  it('names the Word add-in distinctly from a browser upload', () => {
    // The add-in save was 'user_upload' until 20261130000000. It is its own
    // event: the attorney's tracked changes coming back out of Word, not a file
    // arriving from outside the app.
    expect(checkedSources()).toContain('word_addin')
    expect(checkedSources()).toContain('user_upload')
  })
})
