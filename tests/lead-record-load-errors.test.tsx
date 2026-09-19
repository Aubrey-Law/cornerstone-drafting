// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLeadDocuments, LeadDocumentsTab } from '@/components/leads/LeadDocumentsTab'
import { RecordTasksTab } from '@/components/tasks/RecordTasksTab'

const mocks = vi.hoisted(() => ({ documents: vi.fn(), folders: vi.fn(), signatureRequests: vi.fn(), token: 'token' }))
vi.mock('@/lib/documents', () => ({ listDocuments: mocks.documents, listDocumentFolders: mocks.folders, listSignatureRequests: mocks.signatureRequests }))
vi.mock('@/app/admin/matters/[id]/MatterDocumentsTab', () => ({ MatterDocumentsTab: ({ documents }: { documents: { id: string }[] }) => <div>{documents.length ? 'Loaded documents' : 'No documents'}</div> }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => mocks.token }))
vi.mock('@/components/tasks/TaskDetailSheet', () => ({ TaskDetailSheet: () => null }))
vi.mock('@/components/tasks/TaskPlanView', () => ({ TaskPlanView: () => null }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('retains previously loaded documents after a failed refresh and recovers on retry', async () => {
  mocks.documents.mockResolvedValue([{ id: 'doc-1' }])
  mocks.folders.mockResolvedValue([])
  mocks.signatureRequests.mockResolvedValue([])
  const { result } = renderHook(() => useLeadDocuments('matter-1'))
  await waitFor(() => expect(result.current.documents).toHaveLength(1))
  mocks.documents.mockRejectedValueOnce(new Error('Unavailable'))
  await act(() => result.current.reload())
  expect(result.current.error).toBeTruthy()
  expect(result.current.documents).toHaveLength(1)
  await act(() => result.current.reload())
  expect(result.current.error).toBeNull()
})

it('shows a document failure with retry instead of an empty document list', () => {
  const retry = vi.fn()
  render(<LeadDocumentsTab documents={[]} loading={false} matterId="matter-1" agreementId={null} error="Could not load documents." onDocumentsChanged={retry} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load documents.')
  expect(screen.queryByText('No documents')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
})

it('shows failed tasks as unavailable and retries into a loaded task', async () => {
  let failed = true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('?status=all')) return failed
      ? { ok: false, json: async () => ({}) }
      : { ok: true, json: async () => ({ tasks: [{ id: 'task-1', title: 'Call the client', status: 'open', source: 'manual', stage_key: null, checklist: [], priority: 'normal', recurrence: null }] }) }
    return { ok: true, json: async () => ({ templates: [], assignees: [] }) }
  }))
  render(<RecordTasksTab recordId="lead-1" recordKind="lead" recordName="Jane" />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load tasks'))
  expect(screen.queryByText('Nothing open on this record')).not.toBeInTheDocument()
  failed = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('Call the client')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('retains loaded tasks when a token refresh triggers a failed reload', async () => {
  mocks.token = 'first-token'
  let failed = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('?status=all')) return failed
      ? { ok: false, json: async () => ({}) }
      : { ok: true, json: async () => ({ tasks: [{ id: 'task-1', title: 'Existing task', status: 'open', source: 'manual', stage_key: null, checklist: [], priority: 'normal', recurrence: null }] }) }
    return { ok: true, json: async () => ({ templates: [], assignees: [] }) }
  }))
  const { rerender } = render(<RecordTasksTab recordId="lead-1" recordKind="lead" recordName="Jane" />)
  await screen.findByText('Existing task')
  failed = true
  mocks.token = 'refreshed-token'
  rerender(<RecordTasksTab recordId="lead-1" recordKind="lead" recordName="Jane" />)
  await screen.findByRole('alert')
  expect(screen.getByText('Existing task')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Showing previously loaded tasks.')
})
