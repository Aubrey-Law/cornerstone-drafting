// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('next/dynamic', () => ({ default: () => function Viewer({ documentId, versionId, readOnly }: { documentId: string; versionId?: string; readOnly?: boolean }) { return <div>{documentId}:{versionId}:{readOnly ? 'read-only' : 'editable'}</div> } }))
import { DocumentComparisonDialog } from '@/components/drafting/DocumentComparisonDialog'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('pins both sides to version identities and disables editing in the comparison', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ current_version_id: 'v2', versions: [{ id: 'orphan', version_number: 3 }, { id: 'v2', version_number: 2 }, { id: 'v1', version_number: 1 }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<DocumentComparisonDialog current={{ id: 'doc', name: 'Trust.docx' }} onClose={() => {}} />)
  expect(await screen.findByText('doc:v1:read-only')).toBeInTheDocument()
  expect(screen.getByText('doc:v2:read-only')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc/versions', { headers: { Authorization: 'Bearer token' } })
})
it('compares an explicitly chosen older generation rather than silently substituting a newer revision', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ current_version_id: 'v2', versions: [{ id: 'v2', version_number: 2 }, { id: 'v1', version_number: 1 }] }), { status: 200 })))
  render(<DocumentComparisonDialog current={{ id: 'doc', name: 'Trust.docx' }} previous={{ id: 'old-generation', name: 'Trust.docx' }} onClose={() => {}} />)
  expect(await screen.findByText('old-generation::read-only')).toBeInTheDocument()
  expect(screen.queryByText('doc:v1:read-only')).toBeNull()
})
