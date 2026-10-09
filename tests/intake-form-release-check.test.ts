import { expect, it } from 'vitest'
import { checkIntakeFormRelease, type ReleaseCatalog } from '@/scripts/checkIntakeFormRelease'
import { ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM } from '@/lib/intake/forms/definitions'
import { hashIntakeFormDefinition } from '@/lib/intake/forms/hash'
import type { IntakeFormTemplateRow, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'

function fixture() {
  const templates: IntakeFormTemplateRow[] = []
  const versions: IntakeFormVersionRow[] = []
  for (const definition of [ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM]) {
    templates.push({ id: definition.key, key: definition.key, name: definition.title, purpose: 'client_intake', archived_at: null,
      description: null, created_by: 'actor', created_at: 'now', updated_at: 'now' })
    versions.push({ id: `${definition.key}-1`, template_id: definition.key, version: 1, status: 'published',
      definition: structuredClone(definition), definition_hash: hashIntakeFormDefinition(definition), lock_version: 0,
      created_by: 'actor', published_by: 'actor', published_at: 'now', created_at: 'now', updated_at: 'now' })
  }
  const catalog: ReleaseCatalog = {
    getTemplateRowByKey: async key => templates.find(row => row.key === key) ?? null,
    listVersionRows: async id => versions.filter(row => row.template_id === id),
  }
  return { templates, versions, catalog }
}

it('reports the latest published customized version, ignoring drafts and retired versions', async () => {
  const { catalog, versions } = fixture()
  const latest = structuredClone(versions[0])
  latest.id = 'estate-2'; latest.version = 2; latest.definition.title = 'Reviewed firm questionnaire'
  latest.definition_hash = hashIntakeFormDefinition(latest.definition)
  versions.push({ ...latest, id: 'retired', version: 3, status: 'retired' }, latest,
    { ...latest, id: 'draft', version: 4, status: 'draft' })
  expect(await checkIntakeFormRelease(catalog)).toEqual([
    { track: 'estate', templateId: 'estate', versionId: 'estate-2', version: 2, definitionHash: latest.definition_hash },
    { track: 'college_prep', templateId: 'college_prep', versionId: 'college_prep-1', version: 1, definitionHash: versions[1].definition_hash },
  ])
})

it.each(['missing', 'archived', 'purpose', 'unpublished', 'hash', 'compiler', 'definition purpose', 'publication metadata'])(
  'fails closed for %s in either required track', async defect => {
    for (const index of [0, 1]) {
      const { templates, versions, catalog } = fixture()
      const row = versions[index]
      if (defect === 'missing') templates.splice(index, 1)
      if (defect === 'archived') templates[index].archived_at = 'now'
      if (defect === 'purpose') templates[index].purpose = 'client_form'
      if (defect === 'unpublished') row.status = 'retired'
      if (defect === 'hash') row.definition_hash = '0'.repeat(64)
      if (defect === 'compiler') {
        row.definition.sections = []
        row.definition_hash = hashIntakeFormDefinition(row.definition)
      }
      if (defect === 'definition purpose') row.definition.purpose = 'discovery_call'
      if (defect === 'publication metadata') row.published_by = null
      await expect(checkIntakeFormRelease(catalog)).rejects.toThrow()
    }
  },
)

it('propagates unreadable catalog failures rather than returning a passing partial report', async () => {
  const { catalog } = fixture()
  catalog.listVersionRows = async () => { throw new Error('unreadable') }
  await expect(checkIntakeFormRelease(catalog)).rejects.toThrow('unreadable')
})
