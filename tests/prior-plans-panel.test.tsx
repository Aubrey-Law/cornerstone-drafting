// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PriorPlan } from '@/lib/documents/priorPlans'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/documents', () => ({ listPriorPlans: vi.fn(), filePriorPlan: vi.fn() }))

import { filePriorPlan, listPriorPlans } from '@/lib/documents'
import { PriorPlansPanel } from '@/app/admin/matters/[id]/PriorPlansPanel'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function plan(overrides: Partial<PriorPlan> & { id: string }): PriorPlan {
  return {
    label: 'Smith 2019 will',
    filename: 'smith-will.docx',
    fileKind: 'docx',
    sizeBytes: 4096,
    reviewedAt: '2026-09-20T12:00:00.000Z',
    linkedAt: '2026-09-25T12:00:00.000Z',
    filedDocumentId: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PriorPlansPanel', () => {
  it('offers only plans not yet filed, and files one as an unshared document', async () => {
    vi.mocked(listPriorPlans).mockResolvedValue([
      plan({ id: 'u1' }),
      plan({ id: 'u2', label: 'Already filed trust', filedDocumentId: 'doc-9' }),
    ])
    vi.mocked(filePriorPlan).mockResolvedValue({ id: 'doc-1', name: 'Smith 2019 will.docx' } as never)
    const onFiled = vi.fn()

    render(<PriorPlansPanel matterId={MATTER} onFiled={onFiled} />)

    expect(await screen.findByText('Smith 2019 will')).toBeTruthy()
    expect(screen.queryByText('Already filed trust')).toBeNull()
    expect(screen.getByText(/not shared with the\s+client until you share it/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /add to documents/i }))

    expect(filePriorPlan).toHaveBeenCalledWith(MATTER, 'u1')
    await waitFor(() => expect(onFiled).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Added Smith 2019 will.docx to the documents, not shared with the client')
    // Nothing left to file: the panel goes away.
    await waitFor(() => expect(screen.queryByTestId('prior-plans-panel')).toBeNull())
  })

  it('renders nothing when there is nothing to file or the list cannot load', async () => {
    vi.mocked(listPriorPlans).mockRejectedValue(new Error('Could not load prior plans (500)'))
    render(<PriorPlansPanel matterId={MATTER} onFiled={vi.fn()} />)
    await waitFor(() => expect(listPriorPlans).toHaveBeenCalled())
    expect(screen.queryByTestId('prior-plans-panel')).toBeNull()
  })

  it('keeps the row and says why when filing fails', async () => {
    vi.mocked(listPriorPlans).mockResolvedValue([plan({ id: 'u1' })])
    vi.mocked(filePriorPlan).mockRejectedValue(new Error('Matter is closed; documents cannot be added.'))
    const onFiled = vi.fn()
    render(<PriorPlansPanel matterId={MATTER} onFiled={onFiled} />)

    await userEvent.click(await screen.findByRole('button', { name: /add to documents/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Matter is closed; documents cannot be added.'))
    expect(onFiled).not.toHaveBeenCalled()
    expect(screen.getByText('Smith 2019 will')).toBeTruthy()
  })
})
