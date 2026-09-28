import { describe, expect, it } from 'vitest'
import { SOURCE_ALLOW_LIST, resolveInputs, unknownSources } from '@aubrey-law/citations/prompt/inputs'
import { schemaColumns } from './helpers/schemaColumns'
import { DESIGN_SHEET_SELECT } from '@/lib/prompts/designSheet'

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
    expect(resolved).toEqual({ ok: false, missing: ['design_sheet.concerns'], unresolvable: [] })
  })

  it('reports an unresolvable optional source separately from a missing required one', () => {
    // An optional input pointing at a vanished column is still a broken
    // prompt, just a quieter one — it stays unresolvable regardless of
    // `required`, and it must never land in `missing`, which a caller reads
    // as "a person can fix this by filling in the design sheet."
    const resolved = resolveInputs(
      [{ key: 'notes', source: 'design_sheet.not_a_column', required: false }],
      { design_sheet: { concerns: 'x' }, matter: { name: 'Smith Family Trust' } },
    )
    expect(resolved).toEqual({ ok: false, missing: [], unresolvable: ['design_sheet.not_a_column'] })
  })

  it('names a source that is not on the allow-list', () => {
    expect(unknownSources([{ key: 'x', source: 'design_sheet.not_a_column', required: true }]))
      .toEqual(['design_sheet.not_a_column'])
    expect(unknownSources(declarations)).toEqual([])
  })

  it('allows only columns that exist on the tables it names', () => {
    // `[a-z0-9_]`, not `[a-z_]`: real fiduciary-slot columns are numbered
    // (guardian_alt1, trustee_alt1), and a pattern that rejected digits would
    // only be testing this file's own assumption, not the schema.
    for (const path of Object.keys(SOURCE_ALLOW_LIST)) {
      expect(path).toMatch(/^(design_sheet|matter)\.[a-z0-9_]+$/)
    }
  })

  it('agrees with itself about what each path means', () => {
    // The key and the value restate each other, so they can disagree. A
    // transposed entry names two real columns and would pass every other test
    // here while feeding a prompt the wrong fact. A `jsonKey` entry's source
    // names the key inside the blob, not the blob's own column — `decisions`
    // in that case — so the agreement is with `jsonKey` when one is present.
    for (const [source, entry] of Object.entries(SOURCE_ALLOW_LIST)) {
      expect(source).toBe(`${entry.table}.${entry.jsonKey ?? entry.column}`)
    }
  })

  it('names only columns the generated types actually have', () => {
    // The matters.title lesson: a list of column names is an assumption until
    // something compares it to the schema. Read through the compiler rather
    // than by slicing text, because the file it reads is regenerated.
    const schema = schemaColumns()
    const tables = { design_sheet: 'design_sheets', matter: 'matters' } as const
    for (const [source, entry] of Object.entries(SOURCE_ALLOW_LIST)) {
      const columns = schema.get(tables[entry.table])
      expect(columns, `no table for ${source}`).toBeDefined()
      expect(columns!, `${source} names a column that does not exist`).toContain(entry.column)
    }
  })
})

/**
 * An input that lives inside the `decisions` blob rather than in a column.
 *
 * The residuary is written there by `ResiduarySection.tsx`. Before this, the
 * allow-list could only name a column, so the audit resolved
 * `design_sheet.residuary_beneficiary` — always empty — and reported no
 * residuary on matters that had one.
 */
describe('inputs that resolve through decisions', () => {
  it('reads the named key out of the decisions blob', () => {
    const resolved = resolveInputs(
      [{ key: 'residuary_spouse_survives', source: 'design_sheet.residuary_spouse_survives', required: false }],
      { design_sheet: { decisions: { residuary_spouse_survives: 'to my spouse outright' } }, matter: {} },
    )
    expect(resolved).toEqual({ ok: true, values: { residuary_spouse_survives: 'to my spouse outright' } })
  })

  it('treats a missing key as absent, not as a broken prompt', () => {
    // Absent is an answer — the attorney has not recorded it yet.
    // Unresolvable means the prompt names something the allow-list does not
    // have, which is a different and louder failure.
    const resolved = resolveInputs(
      [{ key: 'residuary_no_spouse', source: 'design_sheet.residuary_no_spouse', required: false }],
      { design_sheet: { decisions: {} }, matter: {} },
    )
    expect(resolved).toEqual({ ok: true, values: { residuary_no_spouse: null } })
  })

  it('reports a required decisions key that is missing', () => {
    const resolved = resolveInputs(
      [{ key: 'residuary_no_spouse', source: 'design_sheet.residuary_no_spouse', required: true }],
      { design_sheet: { decisions: {} }, matter: {} },
    )
    expect(resolved).toEqual({ ok: false, missing: ['design_sheet.residuary_no_spouse'], unresolvable: [] })
  })

  it('survives a null decisions column rather than throwing', () => {
    // `decisions` is nullable, and 4 of 45 sheets have no blob at all.
    const resolved = resolveInputs(
      [{ key: 'residuary_no_spouse', source: 'design_sheet.residuary_no_spouse', required: false }],
      { design_sheet: { decisions: null }, matter: {} },
    )
    expect(resolved).toEqual({ ok: true, values: { residuary_no_spouse: null } })
  })

  it('still selects the decisions column, or every such read returns null', () => {
    // designSheet.ts's literal select must carry `decisions`, otherwise the
    // row handed to resolveInputs has no such property and every jsonKey
    // input resolves to null — indistinguishable from an empty field.
    expect(DESIGN_SHEET_SELECT).toContain('decisions')
  })
})
