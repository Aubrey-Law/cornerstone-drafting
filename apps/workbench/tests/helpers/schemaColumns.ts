import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const generated = path.resolve(__dirname, '../../../../packages/db-types/src/supabase.generated.ts')

/** `Database['public']['Tables'][table]['Row']` property names, read from the AST. */
export function schemaColumns(): Map<string, Set<string>> {
  const source = ts.createSourceFile(
    generated,
    fs.readFileSync(generated, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const columns = new Map<string, Set<string>>()

  const database = source.statements.find(
    (s): s is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(s) && s.name.text === 'Database',
  )
  if (!database || !ts.isTypeLiteralNode(database.type)) {
    throw new Error('Could not find the generated `Database` type')
  }

  const member = (node: ts.TypeLiteralNode, name: string): ts.TypeLiteralNode | undefined => {
    for (const m of node.members) {
      if (!ts.isPropertySignature(m) || !m.type || !ts.isTypeLiteralNode(m.type)) continue
      const key = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : null
      if (key === name) return m.type
    }
    return undefined
  }

  const publicSchema = member(database.type, 'public')
  const tables = publicSchema && member(publicSchema, 'Tables')
  if (!tables) throw new Error('Could not find `public.Tables` in the generated types')

  for (const table of tables.members) {
    if (!ts.isPropertySignature(table) || !table.type || !ts.isTypeLiteralNode(table.type)) continue
    const name =
      ts.isIdentifier(table.name) || ts.isStringLiteral(table.name) ? table.name.text : null
    const row = name ? member(table.type, 'Row') : undefined
    if (!name || !row) continue
    const names = new Set<string>()
    for (const column of row.members) {
      if (!ts.isPropertySignature(column)) continue
      if (ts.isIdentifier(column.name) || ts.isStringLiteral(column.name)) {
        names.add(column.name.text)
      }
    }
    columns.set(name, names)
  }
  return columns
}
