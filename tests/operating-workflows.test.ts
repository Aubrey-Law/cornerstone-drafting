import { describe, expect, it } from 'vitest'
import { loadSystemSkillBody } from '@/lib/works/systemSkills'

describe('Cornerstone operating workflow skills', () => {
  for (const slug of [
    'morning-plan', 'focus-next', 'lead-triage', 'matter-readiness',
    'communication-batch', 'end-of-day-close',
  ]) {
    it(`bundles ${slug}`, async () => {
      const body = await loadSystemSkillBody(slug)
      expect(body.length).toBeGreaterThan(150)
    })
  }

  it('keeps ranking deterministic and external communications confirm-first', async () => {
    expect(await loadSystemSkillBody('morning-plan')).toContain('Do not substitute your own ranking')
    expect(await loadSystemSkillBody('communication-batch')).toContain('explicit confirmation before sending')
  })
})
