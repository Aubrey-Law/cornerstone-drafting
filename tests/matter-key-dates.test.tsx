// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/clientApi', () => ({ apiRequest: mocks.request }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
import { MatterKeyDates } from '@/app/admin/matters/[id]/MatterKeyDates'
const anchors = { discoveryCallAt: '2026-10-01', pmpsAt: null, recommendationsSentAt: null, engagementSignedAt: '2026-10-01', fitDecision: 'fit' }
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.request.mockResolvedValue({ anchors }) })
it('shows editable dates without the lead fit decision', async () => {
  render(<MatterKeyDates matterId="m1" details={null} onSaveField={vi.fn()} />)
  expect(await screen.findByLabelText(/Engagement Signed/)).toBeTruthy()
  expect(screen.queryByLabelText('Fit decision')).toBeNull()
})
it('uses the existing rescheduling endpoint and refreshes after saving', async () => {
  render(<MatterKeyDates matterId="m1" details={null} onSaveField={vi.fn()} />)
  const field = await screen.findByLabelText(/Engagement Signed/)
  mocks.request.mockResolvedValueOnce({ anchors: { ...anchors, engagementSignedAt: '2026-10-02' }, rescheduled: 3 })
  fireEvent.change(field, { target: { value: '2026-10-02' } })
  expect(mocks.request).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenLastCalledWith('/api/admin/matters/m1/sla-anchors', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ engagementSignedAt: '2026-10-02' }) }))
})
it('restores the saved date and explains a failed request', async () => {
  render(<MatterKeyDates matterId="m1" details={null} onSaveField={vi.fn()} />)
  const field = await screen.findByLabelText(/Engagement Signed/)
  mocks.request.mockRejectedValueOnce(new Error('offline'))
  fireEvent.change(field, { target: { value: '2026-10-02' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  await screen.findByRole('alert')
  expect((screen.getByLabelText(/Engagement Signed/) as HTMLInputElement).value).toBe('2026-10-01')
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it('accepts past dates typed in US format only after Save', async () => {
  render(<MatterKeyDates matterId="m1" details={null} onSaveField={vi.fn()} />)
  const field = await screen.findByLabelText(/Engagement Signed/)
  fireEvent.change(field, { target: { value: '3/15/2020' } })
  expect(mocks.request).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ engagementSignedAt: '2020-03-15' }) }))
})
it('rejects impossible dates and lets the user cancel without saving', async () => {
  render(<MatterKeyDates matterId="m1" details={null} onSaveField={vi.fn()} />)
  const field = await screen.findByLabelText(/Engagement Signed/)
  fireEvent.change(field, { target: { value: '2/30/2020' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(mocks.request).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect((field as HTMLInputElement).value).toBe('2026-10-01')
})

it('shows only matter milestones and saves the target through the existing details handler', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<MatterKeyDates matterId="m1" details={{ design_meeting_date: '2026-10-02', signing_date: '2026-10-06' }} onSaveField={save} />)
  await screen.findByLabelText('Engagement Signed')
  for (const name of ['Discovery call', 'Planning session', 'Recommendations sent']) expect(screen.queryByLabelText(name)).toBeNull()
  expect((screen.getByLabelText('Design Meeting') as HTMLInputElement).value).toBe('2026-10-02')
  expect((screen.getByLabelText('Signing Date') as HTMLInputElement).value).toBe('2026-10-06')
  fireEvent.change(screen.getByLabelText('Target Signing Date'), { target: { value: '10/20/2026' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('scheduled_signing_date', '2026-10-20T12:00:00.000Z'))
})
