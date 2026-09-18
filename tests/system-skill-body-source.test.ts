import { beforeEach, describe, expect, it, vi } from 'vitest'

// The synced work_skills row is a copy of the bundled SKILL.md that only
// changes when someone presses Sync. In production it sat on a July copy for a
// month while the repo moved on, so the assistant ran superseded instructions.
// The bundled file ships with the code and is therefore always current.
const db = vi.hoisted(() => ({
  staleBody: 'STALE INSTRUCTIONS FROM THE DATABASE',
}))
vi.mock('@/lib/works/data', () => ({
  worksDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  skill_md:
                    '---\nname: Trust Drafting Intake\ndescription: stale\nversion: 1.0.0\ntype: assistant\nexecution_mode: chat\n---\n\n' +
                    db.staleBody,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { clearSystemSkillBodyCache, loadSystemSkillBody } from '@/lib/works/systemSkills'

beforeEach(() => clearSystemSkillBodyCache())

describe('which copy of a system skill the assistant runs', () => {
  it('prefers the bundled SKILL.md over a stale database row', async () => {
    const body = await loadSystemSkillBody('trust-drafting-intake')

    expect(body).toContain('read_design_sheet_status')
    expect(body).not.toContain(db.staleBody)
  })
})
