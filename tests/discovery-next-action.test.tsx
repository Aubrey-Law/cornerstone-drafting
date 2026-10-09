// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { DiscoveryNextAction } from '@/components/discovery/DiscoveryNextAction'
import type { DiscoveryCall } from '@/lib/discovery/contracts'
import type { TaskComposer } from '@/components/tasks/TaskComposer'
const mocks = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('@/components/tasks/useTaskActions', () => ({ useTaskActions: () => ({ create: mocks.create }) }))
vi.mock('@/components/scheduling/BookCalendlyDialog', () => ({ BookCalendlyDialog: () => null }))
vi.mock('@/components/tasks/TaskComposer', () => ({ TaskComposer: ({ onCreate, initialTitle, defaultRecord }: ComponentProps<typeof TaskComposer>) => <>
  <button onClick={() => void onCreate({ title: initialTitle!, lead_id: defaultRecord!.id })}>Missing owner</button>
  <button onClick={() => void onCreate({ title: initialTitle!, lead_id: defaultRecord!.id, assignee_id: 'owner', due_at: '2026-10-12T12:00:00Z' })}>Create</button>
</> }))
const call = (action: string): DiscoveryCall => ({ id: 'call', lead_id: 'lead', form_version_id: 'version', status: 'completed', answers: { discovery_next_action: action, discovery_action_reason: 'Confirm details' }, revision: 1, summary: null, created_by: 'staff', updated_by: 'staff', created_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z', completed_at: '2026-10-09T12:00:00Z', activity_id: 'activity' })
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('discovery next action', () => {
  it('does nothing until explicitly requested and keeps suppressed delivery retryable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ email: 'suppressed' })).mockResolvedValueOnce(Response.json({ email: 'sent' }))
    render(<DiscoveryNextAction call={call('send_organizer')} name="Pat" email="pat@example.test" />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send organizer' }))
    expect(await screen.findByRole('status')).toHaveTextContent('No email sent.')
    fireEvent.click(screen.getByRole('button', { name: 'Send organizer' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Organizer email sent.'))
    expect(screen.queryByRole('button', { name: 'Send organizer' })).not.toBeInTheDocument()
  })
  it('requires owner and due date and links an equivalent task without creating another', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ tasks: [{ id: 'existing', title: 'Existing task', description: 'Discovery call: /admin/crm/opportunities/lead/discovery/call' }] }))
    render(<DiscoveryNextAction call={call('attorney_review')} name="Pat" email="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare follow-up task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Missing owner' }))
    expect(mocks.error).toHaveBeenCalledWith('Choose an owner and a due date.')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/admin/tasks?focus=existing')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('creates a requested task with the call reference only after checking existing tasks', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ tasks: [] }))
    mocks.create.mockResolvedValue({ id: 'new-task' })
    render(<DiscoveryNextAction call={call('attorney_review')} name="Pat" email="" />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare follow-up task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/admin/tasks?focus=new-task')
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ lead_id: 'lead', assignee_id: 'owner', due_at: '2026-10-12T12:00:00Z', description: 'Discovery call: /admin/crm/opportunities/lead/discovery/call\nConfirm details' }))
  })
})
