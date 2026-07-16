import { describe, expect, it, vi } from 'vitest'

const FIXTURE_SKILLS = [
  {
    id: 'skill-1',
    name: 'Trust Drafting Intake',
    description: 'Two-pass trust interview',
    skill_type: 'assistant',
    practice: 'Estate Planning',
    skill_md: '---\nname: Trust Drafting Intake\ndescription: Two-pass trust interview\nversion: 1.0.0\ntype: assistant\nexecution_mode: chat\n---\n\nTRUST DRAFTING INTAKE: run the interview.',
    is_active: true,
  },
  {
    id: 'skill-2',
    name: 'Broken Frontmatter',
    description: 'Malformed stored skill',
    skill_type: 'assistant',
    practice: null,
    skill_md: 'no frontmatter here at all',
    is_active: true,
  },
]

vi.mock('@/lib/works/list', () => ({
  // The real listWorkSkillsForUser already applies visibility + active filters;
  // the executors see only what the user could see in the library.
  listWorkSkillsForUser: vi.fn(async () => FIXTURE_SKILLS),
}))

import { workflowToolExecutors, workflowSystemPromptNote } from '@/lib/adminChat/workflowTools'

const user = { userId: 'user-1', email: 'scott@example.com' }

function collectEmits() {
  const events: Record<string, unknown>[] = []
  return { events, emit: (data: Record<string, unknown>) => events.push(data) }
}

describe('workflow chat tools', () => {
  it('documents the [Workflow:] handoff convention in the system prompt note', () => {
    const note = workflowSystemPromptNote()
    expect(note).toContain('[Workflow: <title> (id: <id>)]')
    expect(note).toContain('read_workflow')
    expect(note).toContain('list_workflows')
  })

  it('list_workflows returns id/name/description/type for visible skills', async () => {
    const [listTool] = workflowToolExecutors(user)
    const { events, emit } = collectEmits()
    const result = await listTool.execute({}, { toolUseId: 't1', emit })

    const parsed = JSON.parse(result.content) as { ok: boolean; workflows: { id: string; name: string }[] }
    expect(parsed.ok).toBe(true)
    expect(parsed.workflows).toHaveLength(2)
    expect(parsed.workflows[0]).toMatchObject({ id: 'skill-1', name: 'Trust Drafting Intake', type: 'assistant' })
    expect(events.some(event => event.status === 'done')).toBe(true)
  })

  it('read_workflow returns the skill body and emits workflow_applied', async () => {
    const [, readTool] = workflowToolExecutors(user)
    const { events, emit } = collectEmits()
    const result = await readTool.execute({ workflow_id: 'skill-1' }, { toolUseId: 't2', emit })

    const parsed = JSON.parse(result.content) as { ok: boolean; instructions: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.instructions).toContain('TRUST DRAFTING INTAKE')
    expect(parsed.instructions).not.toContain('---') // frontmatter stripped
    const applied = events.find(event => event.workflow_applied) as { workflow_applied: { workflow_id: string; title: string } }
    expect(applied.workflow_applied).toEqual({ workflow_id: 'skill-1', title: 'Trust Drafting Intake' })
  })

  it('read_workflow falls back to raw markdown when frontmatter is malformed', async () => {
    const [, readTool] = workflowToolExecutors(user)
    const { emit } = collectEmits()
    const result = await readTool.execute({ workflow_id: 'skill-2' }, { toolUseId: 't3', emit })

    const parsed = JSON.parse(result.content) as { ok: boolean; instructions: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.instructions).toBe('no frontmatter here at all')
  })

  it('read_workflow rejects unknown ids and missing input', async () => {
    const [, readTool] = workflowToolExecutors(user)
    const { events, emit } = collectEmits()

    const missing = await readTool.execute({}, { toolUseId: 't4', emit })
    expect(missing.isError).toBe(true)

    const notFound = await readTool.execute({ workflow_id: 'nope' }, { toolUseId: 't5', emit })
    expect(notFound.isError).toBe(true)
    expect(events.some(event => event.status === 'error')).toBe(true)
  })
})
