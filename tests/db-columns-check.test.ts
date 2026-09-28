import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyMigrationSql,
  classifyMissingReferences,
  migrationDefinedSchema,
} from '@/scripts/lib/migrationSchema.mjs'
import { collectQueryReferences, CHECKED_ROOTS } from '@/scripts/lib/queryReferences.mjs'

/**
 * The column check has to tell "this column vanished from the database" from
 * "this column is new in this branch and not deployed yet" — the distinction
 * checkDbRpcs.mjs already draws for functions (see db-rpc-check.test.ts).
 * Without it a pull request that adds a column and reads it fails a required
 * check it can never pass before merging; drawn wrong, it lets an invented
 * column like `matters.title` through.
 */

describe('applyMigrationSql', () => {
  it('reads create table columns, skipping table-level clauses', () => {
    const schema = applyMigrationSql(
      new Map(),
      `create table if not exists public.things (
        id uuid primary key,
        -- a comment, with, commas
        amount numeric(10, 2) not null,
        kind text check (kind in ('a', 'b')),
        constraint things_kind_check check (kind is not null),
        unique (id, kind)
      );`,
    )
    expect([...schema.get('things')!].sort()).toEqual(['amount', 'id', 'kind'])
  })

  it('applies added and dropped columns and dropped tables', () => {
    const schema = new Map([['runs', new Set(['id', 'old'])], ['gone', new Set(['id'])]])
    applyMigrationSql(
      schema,
      `alter table public.runs add column if not exists fresh uuid, drop column if exists old;
       ALTER TABLE ONLY public.runs ADD COLUMN second text;
       drop table if exists public.gone;`,
    )
    expect([...schema.get('runs')!].sort()).toEqual(['fresh', 'id', 'second'])
    expect(schema.has('gone')).toBe(false)
  })

  it('replays files in filename order, so a later drop wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'columns-check-'))
    writeFileSync(join(dir, '2_drop.sql'), 'alter table public.t drop column x;')
    writeFileSync(join(dir, '1_create.sql'), 'create table public.t (id uuid, x text);')
    writeFileSync(join(dir, 'notes.md'), 'create table public.not_sql (id uuid);')
    const schema = migrationDefinedSchema(dir)
    expect([...schema.get('t')!]).toEqual(['id'])
    expect(schema.has('not_sql')).toBe(false)
  })
})

describe('the repo migrations', () => {
  const defined = migrationDefinedSchema()

  it('define this branch’s upload review schema', () => {
    expect(defined.get('review_uploads')?.has('label')).toBe(true)
    expect(defined.get('workflow_runs')?.has('review_upload_id')).toBe(true)
  })

  it('never defined matters.title, so reading it is never excused', () => {
    expect(classifyMissingReferences([{ table: 'matters', column: 'title' }], defined)).toEqual({
      undefined: [{ table: 'matters', column: 'title' }],
      pendingDeploy: [],
    })
  })

  it('no longer define a column a later migration dropped', () => {
    expect(defined.get('workflow_runs')?.has('playbook_slug')).toBe(false)
  })
})

/** End to end against a stub PostgREST, because the exit code is what CI consumes. */
describe('checkDbColumns exit codes', () => {
  let server: Server
  let url = ''

  beforeAll(async () => {
    // Everything the checked code reads, minus exactly what this branch's
    // migration adds — the state of the shared database before it merges.
    const { references } = collectQueryReferences({ roots: CHECKED_ROOTS, repoRoot: process.cwd() })
    const definitions: Record<string, { properties: Record<string, unknown> }> = {}
    for (const { table, column } of references) {
      if (table === 'review_uploads' || column === 'review_upload_id') continue
      definitions[table] ??= { properties: {} }
      definitions[table].properties[column] = {}
    }
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ definitions }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    url = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function run(eventName: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('node', ['scripts/checkDbColumns.mjs'], {
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'stub', GITHUB_EVENT_NAME: eventName },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    })
  }

  it('passes on a pull request when the only gap is a migration in this branch', async () => {
    const result = await run('pull_request')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('review_uploads')
    expect(result.stdout).toContain('not deployed yet')
  })

  it('fails on a push to main for the same gap', async () => {
    const result = await run('push')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('review_uploads')
  })

  it('fails on the scheduled run', async () => {
    expect((await run('schedule')).code).toBe(1)
  })
})
