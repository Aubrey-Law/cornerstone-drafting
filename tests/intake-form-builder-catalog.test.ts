import { describe, expect, it } from 'vitest'
import { BUILDER_FIELD_IDS, getBuilderField } from '@aubrey-law/estate-fields/core'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import { INTAKE_BLOCK_REGISTRY, getIntakeBlock } from '@/lib/intake/forms/blockRegistry'

describe('intake form builder catalog', () => {
  it('offers every approved field exactly once and no unapproved fields', () => {
    const { fields } = getIntakeFormBuilderCatalog()
    expect(fields.map(field => field.id)).toEqual(BUILDER_FIELD_IDS)
    expect(new Set(fields.map(field => field.id)).size).toBe(fields.length)
    for (const field of fields) {
      const canonical = getBuilderField(field.id)
      expect(field).toMatchObject({
        label: canonical.label,
        control: canonical.control,
        baselineRequirement: canonical.baselineRequirement,
        validationProfile: canonical.validationProfile,
        audiences: ['client_and_staff', 'staff_only'],
      })
    }
  })

  it('offers every approved block once with code-owned audiences', () => {
    const { blocks } = getIntakeFormBuilderCatalog()
    expect(blocks.map(block => block.id).sort()).toEqual(Object.keys(INTAKE_BLOCK_REGISTRY).sort())
    expect(new Set(blocks.map(block => block.id)).size).toBe(blocks.length)
    for (const block of blocks) expect(block.audiences).toEqual(getIntakeBlock(block.id).audiences)
    expect(blocks.find(block => block.id === 'attorney_documents')).toMatchObject({
      label: 'Documents to prepare', group: 'Attorney only', audiences: ['staff_only'],
    })
  })

  it('exposes only serializable display metadata without executable or storage details', () => {
    const catalog = getIntakeFormBuilderCatalog()
    expect(structuredClone(catalog)).toEqual(catalog)
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog)
    const forbidden = /intakeKey|designKey|householdKey|read|write|evaluate|persist/i
    JSON.stringify(catalog, (key, value) => {
      expect(key).not.toMatch(forbidden)
      expect(typeof value).not.toBe('function')
      return value
    })
    for (const field of catalog.fields) {
      expect(Object.keys(field).sort()).toEqual([
        'id', 'label', 'description', 'group', 'control', 'baselineRequirement',
        'validationProfile', 'audiences', ...(field.options ? ['options'] : []),
      ].sort())
    }
    for (const block of catalog.blocks) {
      expect(Object.keys(block).sort()).toEqual(['id', 'label', 'description', 'group', 'audiences', 'configControls'].sort())
    }
  })

  it('groups identity, address, estate, college, and background fields for the drawer', () => {
    const { fields } = getIntakeFormBuilderCatalog()
    for (const id of ['client_first_name', 'client_email', 'client_citizenship', 'street', 'county', 'marital_status', 'marriage_date']) {
      expect(fields.find(field => field.id === id)?.group).toBe('Client and household')
    }
    for (const id of ['estate_value', 'asset_types', 'planning_goals', 'special_notes']) {
      expect(fields.find(field => field.id === id)?.group).toBe('Estate planning')
    }
    expect(fields.find(field => field.id === 'referral_source')?.group).toBe('Background')
    for (const field of fields.filter(field => field.id.startsWith('college_'))) expect(field.group).toBe('College preparation')
    expect(fields.find(field => field.id === 'county')).toMatchObject({
      control: 'select', baselineRequirement: 'recommended', group: 'Client and household',
      validationProfile: 'ma_county', description: 'Choose one approved option.',
    })
  })

  it('copies approved option values and labels without sharing registry objects or extra option keys', () => {
    const catalog = getIntakeFormBuilderCatalog()
    for (const field of catalog.fields) {
      const canonical = getBuilderField(field.id)
      if (!canonical.options) { expect(field.options).toBeUndefined(); continue }
      expect(field.options).toEqual(canonical.options.map(option => ({ value: option.value, label: option.label })))
      expect(field.options).not.toBe(canonical.options)
      expect(field.options?.[0]).not.toBe(canonical.options[0])
    }
    const county = catalog.fields.find(field => field.id === 'county')!
    const originalLabel = getBuilderField('county').options![0].label
    county.options![0].label = 'Changed in editor'
    expect(getBuilderField('county').options![0].label).toBe(originalLabel)
    expect(getIntakeFormBuilderCatalog().fields.find(field => field.id === 'county')?.options?.[0].label).toBe(originalLabel)
  })

  it('exposes only the two approved address configuration controls', () => {
    const catalog = getIntakeFormBuilderCatalog()
    expect(catalog.blocks.find(block => block.id === 'address')?.configControls).toEqual([
      { key: 'profile', label: 'Address profile', control: 'select', options: [
        { value: 'estate', label: 'Estate planning' },
        { value: 'college', label: 'College preparation' },
      ] },
      { key: 'includeCounty', label: 'Ask for Massachusetts county', control: 'boolean' },
    ])
    for (const block of catalog.blocks.filter(block => block.id !== 'address')) expect(block.configControls).toEqual([])
    catalog.blocks.find(block => block.id === 'address')!.configControls[0].label = 'Changed'
    expect(getIntakeFormBuilderCatalog().blocks.find(block => block.id === 'address')?.configControls[0].label).toBe('Address profile')
  })
})
