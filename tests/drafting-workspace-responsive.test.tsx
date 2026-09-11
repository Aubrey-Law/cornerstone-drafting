// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesignSheet, PipelineMatter } from '@/types/database'

const recovery = vi.hoisted(() => ({ active: false }))
const router = vi.hoisted(() => ({ replace: vi.fn() }))
const params = vi.hoisted(() => ({ current: new URLSearchParams('step=design') }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => params.current,
}))

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

vi.mock('@/lib/designSheet/useDesignSheetState', () => ({
  useDesignSheetState: () => ({
    conflict: recovery.active ? { local: {}, latest: {}, base: null } : null,
    resolveConflict: vi.fn(),
    reloadConflictLatest: vi.fn(),
    sheet: {} as DesignSheet,
    contactsState: [],
    lpDataState: null,
  }),
}))

vi.mock('@/lib/designSheetReadiness', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/designSheetReadiness')>()
  return {
    ...actual,
    computeDesignSheetReadiness: () => ({ complete: false, blockers: [] }),
  }
})

vi.mock('@/app/admin/drafting/[matterId]/design/DesignSheetPage', () => ({
  default: () => <div>Design sheet</div>,
}))

import DraftingWorkspace from '@/app/admin/drafting/[matterId]/DraftingWorkspace'

afterEach(() => {
  cleanup()
  recovery.active = false
  router.replace.mockReset()
  params.current = new URLSearchParams('step=design')
})

describe('drafting workspace responsive navigation', () => {
  it('advances with the compact mobile step controls while preserving URL state', async () => {
    const user = userEvent.setup()
    const matter = {
      matter_id: 'matter-1',
      client_name: 'Jane Doe',
      practice_area: 'EP',
    } as PipelineMatter

    render(
      <DraftingWorkspace
        matterId="matter-1"
        matter={matter}
        contacts={[]}
        sheet={null}
        lpData={null}
        intakeSnapshot={null}
        hubMatter={null}
        sharedDrafts={[]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Drafting actions' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Next drafting step' }))

    expect(router.replace).toHaveBeenCalledWith('/admin/drafting/matter-1?step=generate', { scroll: false })
  })
  it.each(['generate', 'review'])('keeps recovery reachable on %s without disabling step navigation', async step => {
    recovery.active = true
    params.current = new URLSearchParams(`step=${step}`)
    render(<DraftingWorkspace matterId="matter-1" matter={{ matter_id: 'matter-1', client_name: 'Jane Doe', practice_area: 'EP' } as PipelineMatter} contacts={[]} sheet={null} lpData={null} intakeSnapshot={null} hubMatter={null} sharedDrafts={[]} />)
    expect(screen.getByRole('dialog', { name: 'Resolve design sheet changes' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Review later' }))
    expect(screen.getByRole('button', { name: 'Review versions' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous drafting step' }) as HTMLButtonElement).disabled).toBe(false)
    if (step === 'generate') expect(screen.getByText('Resolve the saved versions before generating drafts.')).toBeTruthy()
  })

})
