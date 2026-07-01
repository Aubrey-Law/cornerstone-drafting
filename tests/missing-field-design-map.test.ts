import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { designTargetForMissingField, isKnownDesignSection } from '@/lib/estateGenerator/missingFieldDesignMap'

function allRequiredFieldPaths(): string[] {
  const dir = path.join(process.cwd(), 'tools/aubreylaw-docgeneration/packages')
  const paths = new Set<string>()
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { required_fields?: string[] }
    for (const p of pkg.required_fields ?? []) paths.add(p)
  }
  return [...paths]
}

describe('designTargetForMissingField', () => {
  it('resolves every package required-field path to a known design-sheet section', () => {
    const unresolved: string[] = []
    for (const fieldPath of allRequiredFieldPaths()) {
      const target = designTargetForMissingField(fieldPath)
      if (!isKnownDesignSection(target.sectionId)) unresolved.push(`${fieldPath} → ${target.sectionId}`)
    }
    expect(unresolved).toEqual([])
  })

  it('maps trustee fiduciary paths to the trust section', () => {
    expect(designTargetForMissingField('fiduciaries.trustee.successor.full_name'))
      .toEqual({ path: 'fiduciaries.trustee.successor.full_name', label: 'Successor trustee', sectionId: 'trust', sectionLabel: 'Trust', targetField: null })
  })

  it('maps scalar client fields to a focusable personal-section input', () => {
    expect(designTargetForMissingField('client.county'))
      .toEqual({ path: 'client.county', label: 'County', sectionId: 'personal', sectionLabel: 'Personal', targetField: 'county' })
  })

  it('degrades unknown paths to a section-level link without throwing', () => {
    const target = designTargetForMissingField('something.brand_new.field')
    expect(isKnownDesignSection(target.sectionId)).toBe(true)
    expect(target.targetField).toBeNull()
  })
})
