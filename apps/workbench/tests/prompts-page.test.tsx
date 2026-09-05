// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Mocked the same way tests/stored-findings.test.tsx mocks recordDisposition:
// this is a component test for what the workspace renders, not for the server
// action it submits to.
const { runAudit } = vi.hoisted(() => ({
  runAudit: vi.fn(async () => ({
    ok: null,
    message: null,
    runId: null,
    findingCount: null,
    tasksCreated: null,
  })),
}))
vi.mock('@/app/prompts/actions', () => ({ runAudit }))

import { PromptsWorkspace } from '@/app/prompts/PromptsWorkspace'

afterEach(() => {
  cleanup()
  runAudit.mockClear()
})

describe('PromptsWorkspace', () => {
  it('names each published prompt and how many checks it will run', () => {
    render(
      <PromptsWorkspace
        prompts={[
          { slug: 'ma-design-sheet-audit', title: 'Massachusetts design sheet — issue spotter', checkCount: 6 },
          { slug: 'other-audit', title: 'Another audit', checkCount: 1 },
        ]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
      />,
    )

    const list = screen.getByTestId('prompt-list')
    expect(list.textContent).toContain('Massachusetts design sheet — issue spotter')
    expect(list.textContent).toContain('6 checks')
    expect(list.textContent).toContain('Another audit')
    // Singular, not "1 checks" — the count is meant to be read, not just present.
    expect(list.textContent).toContain('1 check')
    expect(list.textContent).not.toContain('1 checks')
  })

  it('offers the matter and prompt pickers when both exist', () => {
    render(
      <PromptsWorkspace
        prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Prompt' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Matter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /run audit/i })).toBeTruthy()
  })

  /**
   * An attorney opening this page with nothing to run it against should be
   * told that plainly, not shown an empty or broken-looking picker.
   */
  it('says plainly when there are no matters to run against', () => {
    render(
      <PromptsWorkspace prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]} matters={[]} />,
    )

    expect(screen.getByTestId('no-matters').textContent).toMatch(/no matter has a design sheet/i)
    expect(screen.queryByRole('combobox', { name: 'Matter' })).toBeNull()
  })

  it('says plainly when no prompt is published', () => {
    render(<PromptsWorkspace prompts={[]} matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]} />)

    expect(screen.getByTestId('no-prompts').textContent).toMatch(/no field-audit prompt is published/i)
  })
})
