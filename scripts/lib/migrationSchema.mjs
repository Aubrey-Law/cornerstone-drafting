// Which tables and columns the repo's migrations create, read from the SQL
// files themselves.
//
// For checkDbColumns.mjs, and for the reason checkDbRpcs.mjs has
// `migrationDefinedRpcs`: a column missing from the shared database is drift
// only if nothing in the repo creates it. When a migration in this branch
// creates it, the column is simply not deployed yet — migrations reach the
// shared database on merge to main — so a pull request that adds a column and
// reads it would otherwise fail a required check it could never pass before
// merging.
//
// Read from the files rather than from migration history: history says what
// was *applied*, and a migration in an unmerged branch has no history row.
//
// Files are replayed in filename order, the order they apply in, so a column a
// later migration drops is no longer "defined". Without that, a read of a
// dropped column would pass as pending on every pull request.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS_DIR = 'supabase/migrations'

/** Words that open a table-level clause in `create table (...)`, not a column. */
const NOT_A_COLUMN = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like'])

const TABLE_NAME = String.raw`(?:if\s+not\s+exists\s+)?(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of a parenthesised list starting at `open`, honouring nesting. */
function parenthesised(sql, open) {
  let depth = 0
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1
    else if (sql[i] === ')') {
      depth -= 1
      if (depth === 0) return sql.slice(open + 1, i)
    }
  }
  return ''
}

/** Top-level comma-separated items of a column list. */
function splitTopLevel(body) {
  const items = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '(') depth += 1
    else if (body[i] === ')') depth -= 1
    else if (body[i] === ',' && depth === 0) {
      items.push(body.slice(start, i))
      start = i + 1
    }
  }
  items.push(body.slice(start))
  return items.map((item) => item.trim()).filter(Boolean)
}

/**
 * Applies one migration's DDL to `schema` (table → Set of columns), in place.
 * Understands the forms these migrations use: `create table`, `drop table`,
 * and `alter table ... add column / drop column`, with or without
 * `if [not] exists` and a `public.` qualifier.
 */
export function applyMigrationSql(schema, rawSql) {
  const sql = stripComments(rawSql).toLowerCase()

  for (const match of sql.matchAll(new RegExp(String.raw`create\s+table\s+${TABLE_NAME}\s*\(`, 'g'))) {
    const table = match[1]
    const columns = schema.get(table) ?? new Set()
    const body = parenthesised(sql, match.index + match[0].length - 1)
    for (const item of splitTopLevel(body)) {
      const word = item.match(/^"?([a-z_][a-z0-9_]*)"?/)?.[1]
      if (word && !NOT_A_COLUMN.has(word)) columns.add(word)
    }
    schema.set(table, columns)
  }

  for (const match of sql.matchAll(new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`, 'g'))) {
    schema.delete(match[1])
  }

  for (const match of sql.matchAll(new RegExp(String.raw`alter\s+table\s+${TABLE_NAME}([^;]*)`, 'g'))) {
    const table = match[1]
    const actions = match[2]
    const columns = schema.get(table) ?? new Set()
    for (const add of actions.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/g)) {
      columns.add(add[1])
    }
    for (const drop of actions.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/g)) {
      columns.delete(drop[1])
    }
    schema.set(table, columns)
  }

  return schema
}

/** Every table and column the repo's migrations leave in place, replayed in filename order. */
export function migrationDefinedSchema(dir = MIGRATIONS_DIR) {
  const schema = new Map()
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return schema
  }
  for (const name of names.filter((n) => n.endsWith('.sql')).sort()) {
    applyMigrationSql(schema, readFileSync(join(dir, name), 'utf8'))
  }
  return schema
}

/**
 * Splits references the database does not have into the case that is a bug
 * anywhere (`undefined`: nothing in the repo creates it) and the case that is
 * normal on a pull request and a genuine problem anywhere else
 * (`pendingDeploy`: a migration creates it and has not reached the database).
 *
 * `matters.title` — the invented column this check was written for — lands in
 * `undefined` on every event, because no migration has ever created it.
 */
export function classifyMissingReferences(missing, defined) {
  const result = { undefined: [], pendingDeploy: [] }
  for (const reference of missing) {
    const columns = defined.get(reference.table)
    const isDefined = reference.column === undefined ? Boolean(columns) : Boolean(columns?.has(reference.column))
    ;(isDefined ? result.pendingDeploy : result.undefined).push(reference)
  }
  return result
}
