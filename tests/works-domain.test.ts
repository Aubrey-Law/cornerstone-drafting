import { describe, expect, it } from 'vitest'
import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
  type WorkSkillMetadata,
} from '@/lib/works/skill'
import { canLaunchSkill, canTransitionRun, type WorkRunStatus } from '@/lib/works/run'

describe('Works skill markdown', () => {
  it('parses required metadata and preserves the instruction body', () => {
    const skill = parseSkillMarkdown(`---
name: intake-summary
description: Summarize an approved intake
version: 1.0.0
type: assistant
execution_mode: chat
practice: Estate Planning
jurisdictions:
  - Massachusetts
---

Use only approved matter facts.`)

    expect(skill.metadata).toMatchObject({
      name: 'intake-summary',
      type: 'assistant',
      execution_mode: 'chat',
      practice: 'Estate Planning',
      jurisdictions: ['Massachusetts'],
    })
    expect(skill.body).toBe('Use only approved matter facts.')
  })

  it('rejects malformed or incomplete frontmatter', () => {
    expect(() => parseSkillMarkdown('Summarize this matter.')).toThrow(/frontmatter/i)
    expect(() => parseSkillMarkdown(`---
name: missing-description
---
body`)).toThrow(/description/i)
    expect(() => parseSkillMarkdown(`---
name: bad-type
description: x
version: 1
type: something
execution_mode: chat
---
body`)).toThrow(/type/i)
  })

  it('round-trips canonical metadata and body', () => {
    const metadata: WorkSkillMetadata = {
      name: 'review-documents',
      description: 'Review selected documents',
      version: '1.0.0',
      type: 'tabular',
      execution_mode: 'run',
      practice: null,
      jurisdictions: ['Massachusetts'],
      allowed_context: ['matter', 'documents'],
      columns_config: [{ index: 0, name: 'Issue', prompt: 'Identify the issue', format: 'text' }],
    }
    const parsed = parseSkillMarkdown(serializeSkillMarkdown(metadata, 'Review only the selected documents.'))
    expect(parsed.metadata).toEqual(metadata)
    expect(parsed.body).toBe('Review only the selected documents.')
  })
})

describe('Works run safety', () => {
  it('does not launch inactive skills', () => {
    expect(canLaunchSkill({ is_active: false, is_owner: true })).toEqual({ ok: false, reason: 'inactive' })
    expect(canLaunchSkill({ is_active: true, is_owner: false })).toEqual({ ok: true })
  })

  it('allows only safe run transitions', () => {
    const allowed: Array<[WorkRunStatus, WorkRunStatus]> = [
      ['draft', 'running'],
      ['running', 'completed'],
      ['running', 'failed'],
      ['completed', 'awaiting_confirmation'],
      ['awaiting_confirmation', 'confirmed'],
      ['draft', 'cancelled'],
      ['running', 'cancelled'],
    ]
    for (const [from, to] of allowed) expect(canTransitionRun(from, to)).toBe(true)
    expect(canTransitionRun('confirmed', 'running')).toBe(false)
    expect(canTransitionRun('cancelled', 'completed')).toBe(false)
  })
})
