// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Mocked the same way tests/stored-findings.test.tsx mocks recordDisposition:
// this is a component test for what the workspace renders, not for the server
// action it submits to.
const { runAudit } = vi.hoisted(() => ({
  runAudit: vi.fn(async () => ({
    ok: null,
    message: null,
    runId: null,
  })),
}))
vi.mock('@/app/admin/field-audits/actions', () => ({ runAudit }))

import { FieldAuditWorkspace } from '@/app/admin/field-audits/FieldAuditWorkspace'

afterEach(() => {
  cleanup()
  runAudit.mockClear()
})

describe('FieldAuditWorkspace', () => {
  it('names each published prompt and how many checks it will run', () => {
    render(
      <FieldAuditWorkspace
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
      <FieldAuditWorkspace
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
      <FieldAuditWorkspace prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]} matters={[]} />,
    )

    expect(screen.getByTestId('no-matters').textContent).toMatch(/no matter has a design sheet/i)
    expect(screen.queryByRole('combobox', { name: 'Matter' })).toBeNull()
  })

  it('says plainly when no prompt is published', () => {
    render(<FieldAuditWorkspace prompts={[]} matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]} />)

    expect(screen.getByTestId('no-prompts').textContent).toMatch(/no field-audit prompt is published/i)
  })

  /**
   * A field-audit run used to have nowhere to be seen: this page ran one and
   * reported a count, and that was the end of it. Each recorded run now links
   * to its own page.
   */
  it('links each recorded run to its own page', () => {
    render(
      <FieldAuditWorkspace
        prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
        runs={[
          {
            runId: 'run-1',
            matterTitle: 'Smith Family Trust',
            promptTitle: 'Issue spotter',
            status: 'completed',
            findingCount: 3,
            failedCount: 0,
            finishedAt: '2026-09-05T12:00:00Z',
          },
        ]}
      />,
    )

    const link = screen.getByRole('link', { name: /issue spotter/i })
    expect(link).toHaveAttribute('href', '/admin/field-audits/run-1')
  })
})

describe('FieldAuditWorkspace: unresolved blockers', () => {
  /**
   * The whole point of reusing `disposition`: an attorney who has already
   * accepted or rejected a blocker as a false positive should not keep
   * seeing it here. That is proven at the data layer in
   * tests/run-advisory.test.ts; this only proves the section renders what
   * it is given.
   */
  it('lists a matter with an open blocker, linking to the run that raised it', () => {
    render(
      <FieldAuditWorkspace
        prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
        unresolvedBlockers={[
          { matterId: 'm-1', matterTitle: 'Smith Family Trust', runId: 'run-9', ruleNumbers: ['2'] },
        ]}
      />,
    )

    const section = screen.getByTestId('unresolved-blockers')
    expect(section.textContent).toContain('Smith Family Trust')
    const link = screen.getByRole('link', { name: /smith family trust/i })
    expect(link).toHaveAttribute('href', '/admin/field-audits/run-9')
  })

  /**
   * The failure this branch fixes: a matter with three runs of the same
   * prompt used to show six near-identical rows, two per run. One matter
   * with several unresolved checks must render as one row naming every
   * check, not one row per finding.
   */
  it('renders one row per matter, naming every unresolved check on it', () => {
    render(
      <FieldAuditWorkspace
        prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
        unresolvedBlockers={[
          { matterId: 'm-1', matterTitle: 'Smith Family Trust', runId: 'run-9', ruleNumbers: ['1', '2'] },
        ]}
      />,
    )

    const section = screen.getByTestId('unresolved-blockers')
    // One row for the matter, not one per check.
    expect(section.querySelectorAll('li')).toHaveLength(1)
    expect(section.textContent).toContain('Check 1')
    expect(section.textContent).toContain('Check 2')
  })

  it('says nothing when there are none', () => {
    render(
      <FieldAuditWorkspace
        prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
        unresolvedBlockers={[]}
      />,
    )

    expect(screen.queryByTestId('unresolved-blockers')).toBeNull()
  })

  /**
   * A list of blockers with no explanation invites the reader to assume a
   * transition was prevented. It was not — a hard gate was rejected on the
   * evidence of real false positives (see the design doc) — so the section's
   * own text must not claim a transition was blocked or stopped.
   */
  it('does not claim anything was blocked', () => {
    render(
      <FieldAuditWorkspace
        prompts={[{ slug: 'ma-design-sheet-audit', title: 'Issue spotter', checkCount: 6 }]}
        matters={[{ matterId: 'm-1', title: 'Smith Family Trust' }]}
        unresolvedBlockers={[
          { matterId: 'm-1', matterTitle: 'Smith Family Trust', runId: 'run-9', ruleNumbers: ['2'] },
        ]}
      />,
    )

    const section = screen.getByTestId('unresolved-blockers')
    expect(section.textContent).not.toMatch(/was blocked/i)
    expect(section.textContent).not.toMatch(/prevented/i)
    expect(section.textContent).not.toMatch(/stopped/i)
    expect(section.textContent).toMatch(/does not block anything/i)
  })
})
