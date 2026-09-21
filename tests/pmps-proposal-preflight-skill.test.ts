import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  clearSystemSkillBodyCache,
  listBundledSystemSkills,
  loadSystemSkillBody,
} from '@/lib/works/systemSkills'

const SLUG = 'pmps-proposal-preflight'

function repoFile(...parts: string[]) {
  return fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8')
}

async function skillBody() {
  clearSystemSkillBodyCache()
  return loadSystemSkillBody(SLUG)
}

describe('PMPS proposal preflight workflow', () => {
  it('ships in the bundled tree as a matter-scoped chat workflow with design-sheet context', () => {
    const skill = listBundledSystemSkills().find(candidate => candidate.slug === SLUG)
    expect(skill, `${SLUG} is not in the bundled tree`).toBeDefined()
    expect(skill?.parsed.metadata.type).toBe('assistant')
    expect(skill?.parsed.metadata.execution_mode).toBe('chat')
    expect(skill?.parsed.metadata.allowed_context).toEqual(
      expect.arrayContaining(['matter', 'intake', 'design_sheet']),
    )
  })

  it('carries no {{PLACEHOLDER}} tokens, because the composer loads it without substitution vars', async () => {
    // loadAttachedWorkflow() calls loadSystemSkillBody(slug) with no vars, so
    // anything written as {{KEY}} would reach the model literally.
    expect(await skillBody()).not.toMatch(/\{\{[A-Z0-9_]+\}\}/)
  })
})

describe('the preflight workflow describes the generator that actually exists', () => {
  it('names the same conditional-section thresholds as the proposal template', async () => {
    const template = repoFile('lib', 'pmps', 'templates', 'pmps-proposal.js')
    const federal = template.match(/FEDERAL_SECTION_THRESHOLD:\s*(\d+)/)?.[1]
    const maExemption = template.match(/MA_EXEMPTION_NUM:\s*(\d+)/)?.[1]
    expect(federal).toBe('7000000')
    expect(maExemption).toBe('2000000')
    // The young-adult section gate lives in the template, not in config.
    expect(template).toMatch(/age\s*<\s*30/)

    const body = await skillBody()
    expect(body).toContain('> $2M')
    expect(body).toContain('≥ **$7M**')
    expect(body).toContain('under 30')
  })

  it('offers only plan structures the run input validator accepts', async () => {
    const assemble = repoFile('lib', 'pmps', 'assemble.ts')
    const accepted = assemble
      .match(/\[([^\]]*)\]\.includes\(String\(value\)\)/)?.[1]
      .match(/'([a-z_]+)'/g)
      ?.map(quoted => quoted.replace(/'/g, ''))
    expect(accepted).toEqual([
      'joint_outright',
      'joint_disclaimer',
      'separate_clayton',
      'individual_single',
    ])

    const body = await skillBody()
    for (const structure of accepted ?? []) {
      expect(body, `plan structure ${structure} is missing from the workflow`).toContain(structure)
    }
  })

  it('lists the asset categories the design sheet actually stores', async () => {
    const database = repoFile('types', 'database.ts')
    const categories = database
      .match(/category:\s*((?:'[a-z_]+'\s*\|\s*)+'[a-z_]+')/)?.[1]
      .match(/'([a-z_]+)'/g)
      ?.map(quoted => quoted.replace(/'/g, '').replace(/_/g, ' '))
    expect(categories).toEqual([
      'real property', 'financial', 'retirement', 'life insurance', 'business', 'other',
    ])

    const body = await skillBody()
    // Section D quotes the categories in prose, so the attorney is asked for
    // the lines the sheet can hold rather than a shape it cannot store.
    for (const category of categories ?? []) {
      expect(body.toLowerCase(), `asset category "${category}" is missing`).toContain(category)
    }
  })

  it('still warns about the missing document descriptions, while they are still missing', async () => {
    // Section G's trap: the proposal renders per-document `description` text,
    // but documentList() never supplies one, so plan-specific terms fall back
    // to boilerplate. If documentList starts setting descriptions, the warning
    // becomes wrong and this test should fail so the workflow is updated.
    const generate = repoFile('lib', 'pmps', 'generate.ts')
    const documentList = generate.slice(
      generate.indexOf('function documentList('),
      generate.indexOf('function fiduciarySet('),
    )
    expect(documentList).not.toContain('description')
    expect(repoFile('lib', 'pmps', 'templates', 'pmps-proposal.js')).toContain('doc.description')

    const body = await skillBody()
    expect(body).toContain('`description`')
  })

  it('points at the Library run instead of claiming it generates the package', async () => {
    const body = await skillBody()
    expect(body).toContain('Prepare PMPS Package')
    expect(body).toMatch(/does not generate the proposal/i)
    expect(body).toContain('[VERIFY:')
  })
})

describe('the preflight workflow can find its own record', () => {
  it('uses the firm-record tools, and handles a lead having no design sheet', async () => {
    const body = await skillBody()
    expect(body).toContain('find_matter')
    expect(body).toContain('read_matter_record')
    expect(body).toContain('read_design_sheet_status')
    expect(body).toMatch(/there is no design sheet/i)
  })
})
