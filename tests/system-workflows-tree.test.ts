import { describe, expect, it } from 'vitest'

import {
  listBundledSystemSkills,
  loadSystemSkillBody,
  slugifySkillName,
  clearSystemSkillBodyCache,
} from '@/lib/works/systemSkills'

describe('bundled system workflow tree', () => {
  it('parses every SKILL.md and enforces slug/name/type consistency', () => {
    const skills = listBundledSystemSkills()
    expect(skills.length).toBeGreaterThanOrEqual(5)

    const slugs = skills.map(skill => skill.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    for (const skill of skills) {
      expect(slugifySkillName(skill.parsed.metadata.name)).toBe(skill.slug)
      expect(skill.parsed.metadata.type).toBe(skill.type)
      expect(skill.parsed.metadata.description.length).toBeGreaterThan(10)
      expect(skill.parsed.body.length).toBeGreaterThan(50)
      if (skill.type === 'tabular') {
        expect(skill.parsed.metadata.columns_config?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('includes the drafting prompts consolidated out of the chat route', () => {
    const slugs = listBundledSystemSkills().map(skill => skill.slug)
    expect(slugs).toContain('trust-drafting-intake')
    expect(slugs).toContain('incapacity-design-sheet')
    expect(slugs).toContain('design-sheet-drafting-summary')
  })

  it('loads skill bodies from the bundled tree with template substitution', async () => {
    clearSystemSkillBodyCache()
    const summary = await loadSystemSkillBody('design-sheet-drafting-summary')
    expect(summary).toContain('Claude Drafting Skill Input')
    expect(summary).toContain('Non-invention rule')

    const trust = await loadSystemSkillBody('trust-drafting-intake')
    expect(trust).toContain('TRUST DRAFTING INTAKE')
    expect(trust).toContain('=== TRUST DRAFTING SKILL INPUT ===')

    const incapacity = await loadSystemSkillBody('incapacity-design-sheet', { TODAY: '2026-07-15' })
    expect(incapacity).toContain('INCAPACITY DESIGN SHEET')
    expect(incapacity).toContain('drafting date = today (2026-07-15)')
    expect(incapacity).not.toContain('{{TODAY}}')
  })

  it('rejects unknown slugs', async () => {
    await expect(loadSystemSkillBody('does-not-exist')).rejects.toThrow('System skill not found')
  })
})

describe('matter-scoped assistant workflows can find their matter', () => {
  it('tells the model to read the record when no matter is loaded, instead of assuming one', () => {
    const matterScoped = listBundledSystemSkills().filter(skill =>
      skill.type === 'assistant'
      && skill.parsed.metadata.execution_mode === 'chat'
      && skill.parsed.metadata.allowed_context.includes('matter'),
    )
    expect(matterScoped.length).toBeGreaterThanOrEqual(4)
    for (const skill of matterScoped) {
      expect(skill.parsed.body, skill.slug).toContain('find_matter')
      expect(skill.parsed.body, skill.slug).toContain('read_matter_record')
      expect(skill.parsed.body, skill.slug).not.toMatch(/work only from the matter context shown above/i)
    }
  })
})
