// Every column name the code asks Postgres for, and where it asks.
//
// Shared by two checks that need the same answer from different sources of
// truth: apps/workbench/tests/query-columns.test.ts compares these against the
// generated types (fast, offline, but only as current as the last regeneration),
// and scripts/checkDbColumns.mjs compares them against the live database.
//
// Parsed from the AST rather than matched with a regex. A `.from(...).select(...)`
// chain associates a table with columns several calls away, and a comment or a
// prose string that happens to look like a query must not register as one.

import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build'])
const SOURCE_EXTS = new Set(['.ts', '.tsx'])

/** Methods whose first string argument names a column. */
const COLUMN_FIRST_ARG = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'order',
])

function sourceFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!SOURCE_EXTS.has(extname(entry.name))) return []
    if (entry.name.includes('.test.')) return []
    return [path]
  })
}

/** The table a `.select(...)`/`.eq(...)` call belongs to, by descending its chain. */
function tableOf(call) {
  let node = call
  while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (node.expression.name.text === 'from') {
      const [first] = node.arguments
      return first && ts.isStringLiteral(first) ? first.text : null
    }
    node = node.expression.expression
  }
  return null
}

/** A same-file `const NAME = 'literal'`, so a hoisted select string still gets checked. */
function stringConstants(source) {
  const values = new Map()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      if (ts.isStringLiteral(declaration.initializer)) {
        values.set(declaration.name.text, declaration.initializer.text)
      }
    }
  }
  return values
}

/**
 * @param {{ roots: string[], repoRoot?: string }} options
 * @returns {{
 *   references: Array<{ file: string, line: number, table: string, column: string }>,
 *   embedded: string[],
 * }}
 *   `embedded` holds PostgREST embedding selects (`matter_documents(id, name)`),
 *   which would need their columns split per table. Callers are expected to
 *   fail on a non-empty list rather than skip it, so the check cannot quietly
 *   narrow when one is introduced.
 */
export function collectQueryReferences({ roots, repoRoot = process.cwd() }) {
  const references = []
  const embedded = []

  for (const root of roots) {
    for (const file of sourceFiles(join(repoRoot, root))) {
      const text = readFileSync(file, 'utf8')
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
      const constants = stringConstants(source)
      const name = relative(repoRoot, file)

      const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text
          const [first] = node.arguments
          const table = tableOf(node)
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
          const add = (column) => references.push({ file: name, line, table, column })

          if (table && first) {
            if (method === 'select') {
              const literal = ts.isStringLiteral(first)
                ? first.text
                : ts.isIdentifier(first)
                  ? constants.get(first.text)
                  : undefined
              if (literal !== undefined && literal !== '*') {
                if (literal.includes('(')) embedded.push(`${name}:${line} ${literal}`)
                else for (const column of literal.split(',')) add(column.trim())
              }
            } else if (COLUMN_FIRST_ARG.has(method) && ts.isStringLiteral(first)) {
              add(first.text)
            } else if (
              (method === 'insert' || method === 'update' || method === 'upsert') &&
              ts.isObjectLiteralExpression(first)
            ) {
              for (const property of first.properties) {
                if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
                  continue
                }
                if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
                  add(property.name.text)
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }

  return { references, embedded }
}

/** The directories whose queries both checks cover. */
export const WORKBENCH_ROOTS = ['apps/workbench/lib', 'apps/workbench/app']
