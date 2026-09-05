import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOURCE_ALLOW_LIST, resolveInputs, unknownSources } from '@aubrey-law/citations/prompt/inputs'

const declarations = [
  { key: 'concerns', source: 'design_sheet.concerns', required: true },
  { key: 'notes', source: 'design_sheet.goals_notes', required: false },
]

describe('resolving a prompt’s declared inputs', () => {
  it('reads each declared source from the row it names', () => {
    const resolved = resolveInputs(declarations, {
      design_sheet: { concerns: 'Provide for my son', goals_notes: null },
      matter: { name: 'Smith Family Trust' },
    })
    expect(resolved).toEqual({ ok: true, values: { concerns: 'Provide for my son', notes: null } })
  })

  it('refuses when a required input has no value, naming the field', () => {
    // A plan reviewed against facts that were not supplied reads exactly like
    // one that was. The run has to stop, and it has to say which field.
    const resolved = resolveInputs(declarations, {
      design_sheet: { concerns: null, goals_notes: 'x' },
      matter: { name: 'Smith Family Trust' },
    })
    expect(resolved).toEqual({ ok: false, missing: ['design_sheet.concerns'] })
  })

  it('names a source that is not on the allow-list', () => {
    expect(unknownSources([{ key: 'x', source: 'design_sheet.not_a_column', required: true }]))
      .toEqual(['design_sheet.not_a_column'])
    expect(unknownSources(declarations)).toEqual([])
  })

  it('allows only columns that exist on the tables it names', () => {
    for (const path of Object.keys(SOURCE_ALLOW_LIST)) {
      expect(path).toMatch(/^(design_sheet|matter)\.[a-z_]+$/)
    }
  })

  it('names only columns the generated types actually have', () => {
    // The matters.title lesson: a list of column names is an assumption until
    // something compares it to the schema.
    const generated = fs.readFileSync(
      path.resolve(__dirname, '../../../packages/db-types/src/supabase.generated.ts'),
      'utf8',
    )
    const rowBlock = (table: string) =>
      generated.slice(generated.indexOf(`      ${table}: {`)).split('        }')[0]
    const designSheet = rowBlock('design_sheets')
    const matters = rowBlock('matters')

    for (const [pathName, entry] of Object.entries(SOURCE_ALLOW_LIST)) {
      const block = entry.table === 'design_sheet' ? designSheet : matters
      expect(block, `${pathName} names a column that does not exist`).toContain(`\n          ${entry.column}:`)
    }
  })
})
