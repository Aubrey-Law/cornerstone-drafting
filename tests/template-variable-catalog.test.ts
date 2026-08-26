import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASELINE_UNKNOWN_ROOTS,
  UNDRAFTED_TRUST_PROVISIONS,
  buildDesignAnswerCoverage,
  buildTemplateVariableCatalog,
  extractTemplateVariables,
} from '@/lib/estateGenerator/templateVariables'

const catalog = buildTemplateVariableCatalog()

describe('template variable catalog', () => {
  it('covers every bundled DOCX template', () => {
    const templatesDir = path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates')
    const docxCount = fs.readdirSync(templatesDir).filter(name => name.endsWith('.docx')).length
    expect(catalog.length).toBe(docxCount)
    expect(catalog.length).toBeGreaterThan(0)
  })

  it('finds no variable roots that nothing populates (beyond the baseline)', () => {
    const offenders = catalog
      .map(entry => ({
        template: entry.template,
        unknownRoots: entry.unknownRoots.filter(
          root => !(BASELINE_UNKNOWN_ROOTS[entry.template] ?? []).includes(root),
        ),
      }))
      .filter(entry => entry.unknownRoots.length > 0)
    expect(offenders).toEqual([])
  })

  it('finds no include_clause ids missing from the clause library', () => {
    const offenders = catalog
      .filter(entry => entry.unknownClauses.length > 0)
      .map(entry => `${entry.template}: ${entry.unknownClauses.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('keeps the baseline honest — grandfathered issues still exist', () => {
    for (const [template, roots] of Object.entries(BASELINE_UNKNOWN_ROOTS)) {
      const entry = catalog.find(item => item.template === template)
      expect(entry, `${template} disappeared — remove it from the baseline`).toBeTruthy()
      for (const root of roots) {
        expect(
          entry!.unknownRoots,
          `${template} no longer references ${root} — remove it from the baseline`,
        ).toContain(root)
      }
    }
  })

  it('extracts variables, clauses, and loop locals from real templates', () => {
    const pourover = catalog.find(entry => entry.template === 'pourover-will.docx')!
    expect(pourover.variables).toContain('client.full_name')
    expect(pourover.clauses.length).toBeGreaterThan(0)

    const buffer = fs.readFileSync(
      path.join(process.cwd(), 'tools/aubreylaw-docgeneration/templates/pourover-will.docx'),
    )
    const report = extractTemplateVariables(buffer)
    expect(report.variables).toEqual(pourover.variables)
  })

  it('keeps the generated catalog file in sync', () => {
    const generatedPath = path.join(
      process.cwd(),
      'tools/aubreylaw-docgeneration/schemas/template-variables.generated.json',
    )
    expect(fs.existsSync(generatedPath), 'run: npx tsx scripts/extract-template-variables.ts').toBe(true)
    const generated = JSON.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      templates: Record<string, { variables: string[] }>
    }
    for (const entry of catalog) {
      expect(
        generated.templates[entry.template]?.variables,
        `${entry.template} is stale — run: npx tsx scripts/extract-template-variables.ts`,
      ).toEqual(entry.variables)
    }
  })
})

describe('design answer coverage', () => {
  const coverage = buildDesignAnswerCoverage()

  it('classifies every documented path exactly once', () => {
    const total = coverage.drafted.length + coverage.worksheetOnly.length + coverage.unreferenced.length
    const dictionary = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'tools/aubreylaw-docgeneration/schemas/data-dictionary.json'),
        'utf8',
      ),
    ) as Record<string, unknown>

    expect(total).toBe(Object.keys(dictionary).length)
    expect(coverage.drafted.length).toBeGreaterThan(0)
  })

  it('holds the undrafted trust provisions to a list that only shrinks', () => {
    // trust.provisions.* is the one root where this measurement is exact:
    // buildNodeEstateContext derives no flag from it, and no clause condition
    // names it, so a provision missing here really is read by nothing.
    const undrafted = coverage.worksheetOnly
      .concat(coverage.unreferenced)
      .filter(dataPath => dataPath.startsWith('trust.provisions.'))
      .sort()

    expect(
      undrafted.filter(dataPath => !UNDRAFTED_TRUST_PROVISIONS.includes(dataPath)),
      'a new trust provision is captured but drafted by nothing — add the clause, or add it to UNDRAFTED_TRUST_PROVISIONS with a reason',
    ).toEqual([])

    expect(
      UNDRAFTED_TRUST_PROVISIONS.filter(dataPath => !undrafted.includes(dataPath)),
      'a listed provision now reaches a drafted document — remove it from UNDRAFTED_TRUST_PROVISIONS',
    ).toEqual([])
  })
})
