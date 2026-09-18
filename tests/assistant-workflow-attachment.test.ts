import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/works/data', () => ({
  worksDb: () => { throw new Error('no db in unit tests') },
}))

const list = vi.hoisted(() => ({
  listWorkSkillsForUser: vi.fn(async () => [] as unknown[]),
}))
vi.mock('@/lib/works/list', () => list)

import {
  attachedWorkflowPromptNote,
  loadAttachedWorkflow,
} from '@/lib/adminChat/workflowAttachment'

const user = { userId: 'u1', email: 'a@b.c' }

function systemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-system',
    slug: 'matter-next-steps',
    name: 'Matter Next Steps',
    is_system: true,
    is_active: true,
    skill_type: 'assistant',
    execution_mode: 'chat',
    allowed_context: ['matter'],
    skill_md: '---\nname: Matter Next Steps\ndescription: stale copy from the database\nversion: 0.9.0\ntype: assistant\nexecution_mode: chat\n---\n\nSTALE BODY',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loading an attached workflow', () => {
  it('serves a system workflow from the bundled tree, not the stale database copy', async () => {
    list.listWorkSkillsForUser.mockResolvedValue([systemRow()])

    const workflow = await loadAttachedWorkflow('wf-system', user)

    expect(workflow?.title).toBe('Matter Next Steps')
    expect(workflow?.body).toContain('MATTER NEXT STEPS')
    expect(workflow?.body).not.toContain('STALE BODY')
  })

  it('serves a custom workflow from its stored markdown, frontmatter stripped', async () => {
    list.listWorkSkillsForUser.mockResolvedValue([systemRow({
      id: 'wf-custom',
      slug: null,
      is_system: false,
      name: 'PMPS Prep',
      skill_md: '---\nname: PMPS Prep\ndescription: custom\nversion: 1.0.0\ntype: assistant\nexecution_mode: chat\n---\n\nCUSTOM BODY',
    })])

    const workflow = await loadAttachedWorkflow('wf-custom', user)

    expect(workflow?.body.trim()).toBe('CUSTOM BODY')
    expect(workflow?.body).not.toContain('version:')
  })

  it('returns null for a workflow the attorney cannot see', async () => {
    list.listWorkSkillsForUser.mockResolvedValue([systemRow()])
    expect(await loadAttachedWorkflow('someone-elses', user)).toBeNull()
  })
})

describe('framing an attached workflow for the system prompt', () => {
  const base = {
    id: 'wf',
    title: 'Matter Next Steps',
    body: 'DO THE STEPS',
    executionMode: 'chat' as const,
    allowedContext: ['matter'],
  }

  it('carries the title and the body, and tells the model not to re-read it', () => {
    const note = attachedWorkflowPromptNote(base, { contextType: 'matter' })
    expect(note).toContain('Matter Next Steps')
    expect(note).toContain('DO THE STEPS')
    expect(note).toContain('read_workflow')
  })

  it('tells a general chat to find and read the matter before a matter-scoped workflow', () => {
    const note = attachedWorkflowPromptNote(base, { contextType: 'general' })
    expect(note).toContain('find_matter')
    expect(note).toContain('read_matter_record')
  })

  it('does not ask a matter chat to look the matter up again', () => {
    const note = attachedWorkflowPromptNote(base, { contextType: 'matter' })
    expect(note).not.toContain('find_matter')
  })

  it('does not ask for a matter when the workflow is not matter-scoped', () => {
    const note = attachedWorkflowPromptNote({ ...base, allowedContext: ['documents'] }, { contextType: 'general' })
    expect(note).not.toContain('find_matter')
  })

  it('says a run-mode workflow belongs in the dedicated run', () => {
    const note = attachedWorkflowPromptNote({ ...base, executionMode: 'run' }, { contextType: 'general' })
    expect(note).toContain('Dedicated run')
  })
})
