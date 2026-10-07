import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

/**
 * Document requests: what the firm asks the client to send, listed in the
 * portal with an upload each, proposed by the meeting follow-up, and tracked
 * from requested to accepted. These pin the rules and the wiring.
 */

vi.mock('server-only', () => ({}))

import {
  awaitsClient,
  awaitsStaff,
  clientStatusLabel,
  findMatchingRequest,
  normaliseRequestTitle,
  requestTitlesFromClientItems,
  summariseDocumentRequests,
  type DocumentRequest,
} from '@/lib/documentRequests/model'
import { computePortalNextAction } from '@/lib/portal/nextActions'
import { getActionDefinition } from '@/lib/actions/registry'
import { ACTION_CATALOG, autonomyCeilingForRisk } from '@/lib/actions/autonomy'

const MATTER = '00000000-0000-0000-0000-000000000060'

function request(over: Partial<DocumentRequest> & Pick<DocumentRequest, 'id' | 'status'>): DocumentRequest {
  return {
    matterId: MATTER, title: 'The deed to the lake house', description: null, dueOn: null, source: 'staff',
    requestedAt: '2026-10-01T12:00:00Z', receivedDocumentId: null, receivedAt: null, acceptedAt: null, waivedAt: null, waivedReason: null,
    section: null, templateKey: null,
    ...over,
  }
}

describe('what a request is', () => {
  it('cleans a title however it was typed or extracted', () => {
    expect(normaliseRequestTitle('  send the deed   to the lake house. ')).toBe('Send the deed to the lake house')
    expect(normaliseRequestTitle('confirm the successor trustee;')).toBe('Confirm the successor trustee')
    expect(normaliseRequestTitle('   ')).toBe('')
    expect(normaliseRequestTitle('x'.repeat(200))).toHaveLength(158)
  })

  it('turns what the client agreed to send into one request each, deduplicated and capped', () => {
    expect(requestTitlesFromClientItems(['Send the deed', 'send the deed.', 'Confirm the trustee', ''])).toEqual(['Send the deed', 'Confirm the trustee'])
    expect(requestTitlesFromClientItems(Array.from({ length: 14 }, (_, i) => `Item ${i}`))).toHaveLength(10)
  })

  it('knows whose move it is', () => {
    expect(awaitsClient(request({ id: 'a', status: 'requested' }))).toBe(true)
    expect(awaitsClient(request({ id: 'a', status: 'received' }))).toBe(false)
    expect(awaitsStaff(request({ id: 'a', status: 'received' }))).toBe(true)
    expect(awaitsStaff(request({ id: 'a', status: 'accepted' }))).toBe(false)
  })

  it('tells the client where each item stands, including an overdue one', () => {
    expect(clientStatusLabel(request({ id: 'a', status: 'requested' }))).toBe('Requested')
    expect(clientStatusLabel(request({ id: 'a', status: 'requested', dueOn: '2026-10-20' }), '2026-10-05')).toBe('Due 2026-10-20')
    expect(clientStatusLabel(request({ id: 'a', status: 'requested', dueOn: '2026-10-01' }), '2026-10-05')).toBe('Overdue (was due 2026-10-01)')
    expect(clientStatusLabel(request({ id: 'a', status: 'received' }))).toBe('Received, being reviewed')
    expect(clientStatusLabel(request({ id: 'a', status: 'accepted' }))).toBe('Accepted')
    expect(clientStatusLabel(request({ id: 'a', status: 'waived' }))).toBe('No longer needed')
  })

  it('finds the request already open for the same ask, and ignores a waived one', () => {
    const rows = [request({ id: 'w', status: 'waived' }), request({ id: 'r', status: 'received' })]
    expect(findMatchingRequest(rows, 'the deed to the lake house.')?.id).toBe('r')
    expect(findMatchingRequest([request({ id: 'w', status: 'waived' })], 'The deed to the lake house')).toBeNull()
    expect(findMatchingRequest(rows, 'A death certificate')).toBeNull()
  })

  it('summarises a list for the staff card and the next due date for the client', () => {
    expect(summariseDocumentRequests([
      request({ id: 'a', status: 'requested', dueOn: '2026-10-20' }),
      request({ id: 'b', status: 'requested', dueOn: '2026-10-12' }),
      request({ id: 'c', status: 'received' }),
      request({ id: 'd', status: 'accepted' }),
      request({ id: 'e', status: 'waived' }),
    ])).toEqual({ open: 3, awaitingClient: 2, awaitingStaff: 1, accepted: 1, nextDueOn: '2026-10-12' })
  })
})

describe('the portal', () => {
  const complete = {
    hasMatter: true, intakeComplete: true, matterStatus: 'active', matterStage: 'drafting' as const, sharedDocumentCount: 0,
    unreadFirmMessageCount: 0, hasUpcomingAppointment: false, outstandingInvoiceCount: 0, factsAvailable: true,
  }

  it('puts what the firm asked for ahead of unread messages, and says nothing when nothing is owed', () => {
    expect(computePortalNextAction({ ...complete, openDocumentRequestCount: 1, unreadFirmMessageCount: 2 })).toMatchObject({
      kind: 'requests', label: 'See what we need', href: '/documents#requests',
      message: 'The firm has asked you for one document. Upload it from Documents when you have it.',
    })
    expect(computePortalNextAction({ ...complete, openDocumentRequestCount: 3 }).message).toContain('3 documents')
    expect(computePortalNextAction({ ...complete, openDocumentRequestCount: 0 }).kind).toBe('clear')
    expect(computePortalNextAction({ ...complete }).kind).toBe('clear')
  })

  it('leaves a closed matter alone', () => {
    expect(computePortalNextAction({ ...complete, matterStatus: 'closed', openDocumentRequestCount: 2 }).kind).toBe('closed')
  })

  it('lists the requests with an upload each and marks the request received through the upload route', () => {
    const page = fs.readFileSync('app/(portal)/documents/page.tsx', 'utf8')
    expect(page).toContain('fetchPortalDocumentRequests(matter.id)')
    expect(page).toContain('<RequestedDocuments matterId={matter.id}')
    const list = fs.readFileSync('app/(portal)/documents/RequestedDocuments.tsx', 'utf8')
    expect(list).toContain("uploadDocument(file, matterId, undefined, { requestId: request.id })")
    expect(list).toContain('id="requests"')
    const dashboard = fs.readFileSync('app/(portal)/dashboard/page.tsx', 'utf8')
    expect(dashboard).toContain('openDocumentRequestCount: openRequests.length')
    expect(dashboard).toContain('What we need from you')
    const upload = fs.readFileSync('app/api/documents/upload/route.ts', 'utf8')
    expect(upload).toContain("form.get('requestId')")
    expect(upload).toContain('markDocumentRequestReceived({ requestId, matterId, documentId: String(data.id) })')
    // The request is marked after the ownership check and the document insert, never before.
    expect(upload.indexOf('markDocumentRequestReceived({')).toBeGreaterThan(upload.indexOf("from('matter_documents')"))
  })
})

describe('the firm’s side', () => {
  it('is an internal record the dial may add unattended, with an undo for an unanswered request', () => {
    const definition = getActionDefinition('document_request.create')!
    expect(definition.risk).toBe('internal_write')
    expect(autonomyCeilingForRisk('internal_write')).toBe('act_silent')
    expect(typeof definition.undo).toBe('function')
    expect(ACTION_CATALOG['document_request.create']?.group).toBe('matters')
    expect(definition.validate({ matterId: MATTER, title: '  The deed ', description: 'A photo is fine', dueOn: '2026-10-20', source: 'meeting_notes' }, { id: 'u' }))
      .toEqual({ matterId: MATTER, title: 'The deed', description: 'A photo is fine', dueOn: '2026-10-20', source: 'meeting_notes' })
    expect(() => definition.validate({ title: 'The deed' }, { id: 'u' })).toThrow('needs a matter')
    expect(() => definition.validate({ matterId: MATTER, title: 'The deed', dueOn: '10/20/2026' }, { id: 'u' })).toThrow('YYYY-MM-DD')
    expect(definition.validate({ matterId: MATTER, title: 'The deed', source: 'nonsense' }, { id: 'u' })).toMatchObject({ source: 'staff' })
  })

  it('reuses an open request for the same ask instead of adding a second row', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const block = source.slice(source.indexOf("key: 'document_request.create'"), source.indexOf("key: 'signing.kit.prepare'"))
    expect(block).toContain('findMatchingRequest(await listDocumentRequests(input.matterId, context.admin), input.title)')
    expect(block).toContain("if (existing && existing.status !== 'accepted') return { ...existing, reused: true }")
    expect(block).toContain('deleteUnansweredDocumentRequest(requestId, context.admin)')
  })

  it('has staff routes that are admin-only and a card on the Documents tab', () => {
    const list = fs.readFileSync('app/api/admin/matters/[id]/document-requests/route.ts', 'utf8')
    expect(list).toContain('requireAdmin(req)')
    expect(list).toContain("source: 'staff'")
    expect(list).toContain('notifyClientOfDocumentRequest(id, title)')
    const one = fs.readFileSync('app/api/admin/matters/[id]/document-requests/[requestId]/route.ts', 'utf8')
    expect(one).toContain('requireAdmin(req)')
    expect(one).toContain("case 'accept'")
    expect(one).toContain("case 'waive'")
    expect(one).toContain("case 'reopen'")
    const detail = fs.readFileSync('app/admin/matters/[id]/MatterDetailClient.tsx', 'utf8')
    expect(detail).toContain('<RequestedDocumentsCard matterId={matterId} onChanged={loadDocuments} probate={showProbate} />')
  })

  it('keeps the table staff-writable and client-readable, and describes it in the generated types', () => {
    const migration = fs.readFileSync('supabase/migrations/20270112090000_document_requests.sql', 'utf8')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.document_requests')
    expect(migration).toMatch(/CHECK \(status IN \('requested', 'received', 'accepted', 'waived'\)\)/)
    expect(migration).toContain('document_requests_client_select')
    expect(migration).toContain('FOR SELECT TO authenticated')
    expect(migration).not.toMatch(/document_requests_client_(insert|update|delete)/)
    const generated = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    expect(generated).toContain('document_requests: {')
    expect(generated).toContain('received_document_id: string | null')
  })
})
