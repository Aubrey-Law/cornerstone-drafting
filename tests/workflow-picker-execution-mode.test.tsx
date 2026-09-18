// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { WorkflowPickerContent } from '@/components/works/WorkflowPickerContent'
import { WorkflowDetail } from '@/app/admin/works/components/WorkflowDetail'
import type { WorkSkill } from '@/components/works/types'

function skill(overrides: Partial<WorkSkill>): WorkSkill {
  return {
    id: 'wf',
    name: 'Workflow',
    description: 'A description long enough to show.',
    version: '1.0.0',
    skill_md: '---\nname: Workflow\ndescription: d\nversion: 1.0.0\ntype: assistant\nexecution_mode: chat\n---\n\nBody',
    skill_type: 'assistant',
    execution_mode: 'chat',
    practice: null,
    jurisdictions: [],
    is_system: true,
    is_active: true,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the composer picker offers only workflows the chat can run', () => {
  it('hides run-mode workflows when asked for chat ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      skills: [
        skill({ id: 'chat-wf', name: 'Matter Next Steps', execution_mode: 'chat' }),
        skill({ id: 'run-wf', name: 'Prepare PMPS Package', execution_mode: 'run' }),
      ],
    }), { headers: { 'Content-Type': 'application/json' } }))

    render(<WorkflowPickerContent typeFilter="assistant" executionMode="chat" onPick={() => {}} />)

    await waitFor(() => expect(screen.getByText('Matter Next Steps')).toBeTruthy())
    expect(screen.queryByText('Prepare PMPS Package')).toBeNull()
  })
})

describe('the Library sends each workflow to the surface that can run it', () => {
  it('offers "Use in assistant" for a chat workflow', () => {
    render(<WorkflowDetail skill={skill({ execution_mode: 'chat' })} onEdit={() => {}} onShare={() => {}} onChanged={() => {}} />)
    expect(screen.getByRole('button', { name: /use in assistant/i })).toBeTruthy()
  })

  it('offers only the dedicated run for a run-mode workflow', () => {
    render(<WorkflowDetail skill={skill({ execution_mode: 'run' })} onEdit={() => {}} onShare={() => {}} onChanged={() => {}} />)
    expect(screen.queryByRole('button', { name: /use in assistant/i })).toBeNull()
    expect(screen.getByRole('button', { name: /dedicated run/i })).toBeTruthy()
  })
})

describe('the picker says which workflows need a matter', () => {
  it('badges a matter-scoped workflow', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      skills: [skill({ id: 'wf', name: 'Matter Next Steps', allowed_context: ['matter'] } as Partial<WorkSkill>)],
    }), { headers: { 'Content-Type': 'application/json' } }))

    render(<WorkflowPickerContent typeFilter="assistant" onPick={() => {}} />)

    await waitFor(() => expect(screen.getByText('Matter Next Steps')).toBeTruthy())
    expect(screen.getByText(/needs a matter/i)).toBeTruthy()
  })
})
