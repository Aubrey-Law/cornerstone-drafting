/** @vitest-environment jsdom */

import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EstateClauseLibrarySection } from '@/app/admin/settings/estate-clauses/EstateClauseLibrarySection'
import type { EstateClauseListResponse } from '@/app/admin/settings/estate-clauses/types'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))

const publishedRevision = {
  id: '11111111-1111-4111-8111-111111111111',
  clauseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revisionNumber: 1,
  authorId: 'original-author',
  basePublishedRevisionId: null,
  text: 'A beneficiary who contests this instrument forfeits the gift.',
  requiredFields: ['client.full_name'],
  nestedClauseKeys: [],
  conditionField: null,
  changeSummary: 'Initial approved language',
  contentHash: 'a'.repeat(64),
  validationStatus: 'valid',
  validationReport: [],
  submittedAt: '2026-07-14T12:00:00Z',
  latestReviewEvent: null,
}

const proposedRevision = {
  ...publishedRevision,
  id: '22222222-2222-4222-8222-222222222222',
  revisionNumber: 2,
  authorId: 'author-other',
  basePublishedRevisionId: publishedRevision.id,
  text: 'A beneficiary who contests this instrument without probable cause forfeits the gift.',
  changeSummary: 'Adds the probable-cause limitation requested by the drafting team.',
  submittedAt: '2026-07-15T12:00:00Z',
  latestReviewEvent: { event_type: 'submitted' },
}

const fixture: EstateClauseListResponse = {
  clauses: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clauseKey: 'trust.no_contest',
      title: 'No Contest',
      jurisdiction: 'MA',
      documentTypes: ['trust'],
      isActive: true,
      createdAt: '2026-07-14T12:00:00Z',
      updatedAt: '2026-07-15T12:00:00Z',
      workingDraft: null,
      latestChangeRequest: null,
      submittedRevisions: [proposedRevision],
      currentPublication: {
        clause_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        current_revision_id: publishedRevision.id,
        published_by: 'publisher',
        published_at: '2026-07-14T13:00:00Z',
        updated_at: '2026-07-14T13:00:00Z',
        revision: publishedRevision,
      },
      reviewEvents: [],
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      clauseKey: 'will.disclaimer',
      title: 'Disclaimer',
      jurisdiction: 'MA',
      documentTypes: ['will'],
      isActive: true,
      createdAt: '2026-07-14T12:00:00Z',
      updatedAt: '2026-07-15T12:00:00Z',
      workingDraft: null,
      latestChangeRequest: null,
      submittedRevisions: [],
      currentPublication: null,
      reviewEvents: [],
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      clauseKey: 'will.tangible_property',
      title: 'Tangible Property',
      jurisdiction: 'MA',
      documentTypes: ['will'],
      isActive: true,
      createdAt: '2026-07-14T12:00:00Z',
      updatedAt: '2026-07-15T12:00:00Z',
      workingDraft: {
        id: '33333333-3333-4333-8333-333333333333',
        clauseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        authorId: 'reviewer',
        basePublishedRevisionId: null,
        text: 'I give my tangible personal property as directed below.',
        requiredFields: ['client.full_name'],
        nestedClauseKeys: [],
        conditionField: null,
        changeSummary: 'Creates tangible property provision.',
        contentHash: 'b'.repeat(64),
        validationStatus: 'invalid',
        validationReport: ['Unsupported field: client.full_name'],
        updatedAt: '2026-07-15T12:00:00Z',
      },
      latestChangeRequest: null,
      submittedRevisions: [],
      currentPublication: null,
      reviewEvents: [],
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      clauseKey: 'trust.self_authored',
      title: 'Self Authored',
      jurisdiction: 'MA',
      documentTypes: ['trust'],
      isActive: true,
      createdAt: '2026-07-14T12:00:00Z',
      updatedAt: '2026-07-15T12:00:00Z',
      workingDraft: null,
      latestChangeRequest: null,
      submittedRevisions: [{ ...proposedRevision, id: '44444444-4444-4444-8444-444444444444', clauseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', authorId: 'reviewer' }],
      currentPublication: null,
      reviewEvents: [],
    },
  ],
}

function response(body: unknown, ok = true, status = ok ? 200 : 409) {
  return { ok, status, json: async () => body } as Response
}

const matterSearchResponse = {
  matters: [{
    id: '99999999-9999-4999-8999-999999999999',
    label: 'Jane Q. Client',
    matterName: 'Client Revocable Trust',
    email: 'jane@example.com',
    stage: 'design',
  }],
}

describe('estate clause administrator UI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(fixture)))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('searches and filters the dense clause list by workflow status', async () => {
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await screen.findByRole('button', { name: 'Review No Contest' })

    await user.type(screen.getByRole('searchbox', { name: 'Search clauses' }), 'tangible')
    expect(screen.getByRole('button', { name: 'Edit Tangible Property' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review No Contest' })).toBeNull()

    await user.clear(screen.getByRole('searchbox', { name: 'Search clauses' }))
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'awaiting_review')
    expect(screen.getByRole('button', { name: 'Review No Contest' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Tangible Property' })).toBeNull()
  })

  it('preserves the working text and shows a visible error after a failed save', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(response(fixture)).mockResolvedValueOnce(response({ error: 'Draft save conflict; reload and compare.' }, false))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    const editor = screen.getByRole('region', { name: 'Clause editor' })
    const text = within(editor).getByLabelText('Structured clause text')
    await user.clear(text)
    await user.type(text, 'Keep this unsaved attorney draft exactly.')
    await user.click(within(editor).getByRole('button', { name: 'Save draft' }))

    expect((await within(editor).findByRole('alert')).textContent).toContain('Draft save conflict')
    expect((text as HTMLTextAreaElement).value).toBe('Keep this unsaved attorney draft exactly.')
  })

  it('requires a change summary but not validation before submission', async () => {
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    const editor = screen.getByRole('region', { name: 'Clause editor' })
    const summary = within(editor).getByLabelText('Change summary')
    const submit = within(editor).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await user.clear(summary)
    expect((within(editor).getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect(submit.disabled).toBe(true)
  })

  it('blocks submission when a valid saved draft has unsaved local edits', async () => {
    const validFixture = structuredClone(fixture)
    validFixture.clauses[2].workingDraft!.validationStatus = 'valid'
    validFixture.clauses[2].workingDraft!.validationReport = []
    vi.mocked(fetch).mockResolvedValue(response(validFixture))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    const editor = screen.getByRole('region', { name: 'Clause editor' })
    const submit = within(editor).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await user.type(within(editor).getByLabelText('Structured clause text'), ' Unsaved change')
    expect(submit.disabled).toBe(true)
  })

  it('describes submission as deliberate attorney review', async () => {
    const validFixture = structuredClone(fixture)
    validFixture.clauses[2].workingDraft!.validationStatus = 'valid'
    validFixture.clauses[2].workingDraft!.validationReport = []
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(validFixture))
      .mockResolvedValueOnce(response({ revisionId: 'submitted-revision' }))
      .mockResolvedValueOnce(response(validFixture))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByText('Revision submitted for deliberate attorney review.')).toBeTruthy()
    expect(screen.queryByText(/independent review/i)).toBeNull()
  })

  it('preserves unsaved edits across an unrelated clause-list refresh', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response({ clause: { id: 'new-clause' } }, true, 201))
      .mockResolvedValueOnce(response(structuredClone(fixture)))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    const text = screen.getByLabelText('Structured clause text') as HTMLTextAreaElement
    await user.type(text, ' Unsaved and preserved.')
    await user.click(screen.getByRole('button', { name: 'New clause' }))
    await user.type(screen.getByLabelText('Stable clause key'), 'trust.second_clause')
    await user.type(screen.getByLabelText('Clause title'), 'Second Clause')
    await user.click(screen.getByLabelText('Trust'))
    await user.click(screen.getByRole('button', { name: 'Create working clause' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(text.value).toContain('Unsaved and preserved.')
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('locks editor inputs while a save request is in flight', async () => {
    let finishSave!: (value: Response) => void
    const pendingSave = new Promise<Response>(resolve => { finishSave = resolve })
    vi.mocked(fetch).mockResolvedValueOnce(response(fixture)).mockReturnValueOnce(pendingSave)
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    const text = screen.getByLabelText('Structured clause text') as HTMLTextAreaElement
    await user.type(text, ' Save this version.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(text.disabled).toBe(true)
    expect((screen.getByLabelText('Change summary') as HTMLInputElement).disabled).toBe(true)
    finishSave(response({ error: 'Draft save conflict' }, false))
    expect((await screen.findByRole('alert')).textContent).toContain('Draft save conflict')
    expect(text.disabled).toBe(false)
    expect(text.value).toContain('Save this version.')
  })

  it('creates a stable clause identity through the Task 4 POST contract', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response({ clause: { id: 'new-clause' } }, true, 201))
      .mockResolvedValueOnce(response(fixture))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'New clause' }))
    await user.type(screen.getByLabelText('Stable clause key'), 'trust.special_distribution')
    await user.type(screen.getByLabelText('Clause title'), 'Special Distribution')
    await user.click(screen.getByLabelText('Trust'))
    await user.click(screen.getByRole('button', { name: 'Create working clause' }))
    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/admin/settings/estate-clauses',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clauseKey: 'trust.special_distribution', title: 'Special Distribution', documentTypes: ['trust'] }),
      }),
    ))
  })

  it('does not carry an AI proposal into a different clause', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(response(fixture)).mockResolvedValueOnce(response({ proposal: { text: 'AI language for tangible property only.' } }))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tangible Property' }))
    await user.type(screen.getByLabelText('AI drafting instructions'), 'Clarify allocation')
    await user.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(await screen.findByDisplayValue('AI language for tangible property only.')).toBeTruthy()
    expect((screen.getByLabelText('Structured clause text') as HTMLTextAreaElement).value).not.toBe('AI language for tangible property only.')
    await user.click(screen.getByRole('button', { name: 'Accept draft' }))
    expect((screen.getByLabelText('Structured clause text') as HTMLTextAreaElement).value).toBe('AI language for tangible property only.')
    await user.click(screen.getByRole('button', { name: 'Edit Disclaimer' }))
    expect(screen.queryByDisplayValue('AI language for tangible property only.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept draft' })).toBeNull()
  })

  it('shows published and proposed text side-by-side and requires only the exact clause key', async () => {
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
    const panel = screen.getByRole('region', { name: 'Clause review' })
    expect(within(panel).getByText('Published revision')).toBeTruthy()
    expect(within(panel).getByText('Proposed revision')).toBeTruthy()
    expect(within(panel).getByText(proposedRevision.changeSummary)).toBeTruthy()
    const publish = within(panel).getByRole('button', { name: 'Approve and publish' })
    expect((publish as HTMLButtonElement).disabled).toBe(true)
    await user.type(within(panel).getByLabelText('Type trust.no_contest to confirm'), 'trust.no_contest')
    expect((publish as HTMLButtonElement).disabled).toBe(false)
    expect(within(panel).queryByText(/successful current representative-matter preview is required/i)).toBeNull()
  })

  it('offers an exact review control for every concurrently submitted revision', async () => {
    const concurrent = structuredClone(fixture)
    concurrent.clauses[0].submittedRevisions.push({
      ...proposedRevision,
      id: '55555555-5555-4555-8555-555555555555',
      revisionNumber: 3,
      authorId: 'second-author',
    })
    vi.mocked(fetch).mockResolvedValue(response(concurrent))
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    expect(await screen.findByRole('button', { name: 'Review No Contest revision 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review No Contest revision 3' })).toBeTruthy()
  })

  it('shows reviewer comments with the restored author working draft', async () => {
    const continuation = structuredClone(fixture)
    continuation.clauses[0].submittedRevisions = []
    continuation.clauses[0].workingDraft = {
      ...continuation.clauses[2].workingDraft!,
      id: '66666666-6666-4666-8666-666666666666',
      clauseId: continuation.clauses[0].id,
      authorId: 'author-other',
      basePublishedRevisionId: publishedRevision.id,
      text: proposedRevision.text,
      changeSummary: proposedRevision.changeSummary,
      validationStatus: 'valid',
      validationReport: [],
    }
    Object.assign(continuation.clauses[0], {
      latestChangeRequest: {
        revisionId: proposedRevision.id,
        revisionNumber: 2,
        comment: 'Narrow the probable-cause exception and explain the Massachusetts rationale.',
        reviewerId: 'reviewer',
        createdAt: '2026-07-16T12:00:00Z',
      },
    })
    vi.mocked(fetch).mockResolvedValue(response(continuation))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="author-other" />)
    await user.click(await screen.findByRole('button', { name: 'Edit No Contest' }))
    expect(screen.getByText('Changes requested on revision 2')).toBeTruthy()
    expect(screen.getByText(/Narrow the probable-cause exception/)).toBeTruthy()
    expect((screen.getByLabelText('Structured clause text') as HTMLTextAreaElement).value).toBe(proposedRevision.text)
  })

  it('allows deliberate publication of a self-authored revision', async () => {
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)

    await user.click(await screen.findByRole('button', { name: 'Review Self Authored' }))

    expect(screen.getByText('Self-authored revision')).toBeTruthy()
    expect(screen.getByLabelText('Reviewer comments')).toBeTruthy()
    expect(screen.getByLabelText(/Type .* to confirm/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeTruthy()
    expect(screen.queryByText(/different attorney or administrator/i)).toBeNull()
  })

  it('generates downloadable in-memory preview files for the selected revision', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response(matterSearchResponse))
      .mockResolvedValueOnce(response({
        files: [{ filename: 'Trust Preview.docx', base64: 'cHJldmlldw==' }],
        validationReport: { warnings: [] },
        evidenceId: 'evidence-1',
      }))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
    await user.type(screen.getByLabelText('Representative matter for preview'), 'Client Revocable')
    await user.click(await screen.findByText('Jane Q. Client'))
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    const download = await screen.findByRole('link', { name: 'Trust Preview.docx' })
    expect(download.getAttribute('download')).toBe('Trust Preview.docx')
    expect(download.getAttribute('href')).toContain('base64,cHJldmlldw==')
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/settings/estate-clauses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ revisionId: proposedRevision.id, matterId: '99999999-9999-4999-8999-999999999999' }),
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Choose a different matter' }))
    expect(screen.queryByRole('link', { name: 'Trust Preview.docx' })).toBeNull()
    expect(screen.queryByText(/"warnings"/)).toBeNull()
  })

  it('ignores an obsolete preview response after the representative matter changes', async () => {
    let finishPreview!: (value: Response) => void
    const pendingPreview = new Promise<Response>(resolve => { finishPreview = resolve })
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response(matterSearchResponse))
      .mockReturnValueOnce(pendingPreview)
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
    await user.type(screen.getByLabelText('Representative matter for preview'), 'Client Revocable')
    await user.click(await screen.findByText('Jane Q. Client'))
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await user.click(screen.getByRole('button', { name: 'Choose a different matter' }))
    finishPreview(response({ files: [{ filename: 'Wrong Matter.docx', base64: 'YmFk' }], validationReport: { warnings: ['stale'] } }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Wrong Matter.docx' })).toBeNull())
    expect(screen.queryByText(/stale/)).toBeNull()
    expect(screen.queryByText('Preview generated in memory. No document was saved.')).toBeNull()
  })

  it('lets reviewers choose a representative matter by name before previewing', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response(matterSearchResponse))
      .mockResolvedValueOnce(response({
        files: [{ filename: 'Trust Preview.docx', base64: 'cHJldmlldw==' }],
        validationReport: { warnings: [] },
        evidenceId: 'evidence-1',
      }))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))

    await user.type(screen.getByLabelText('Representative matter for preview'), 'Client Revocable')
    await user.click(await screen.findByText('Jane Q. Client'))
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('link', { name: 'Trust Preview.docx' })).toBeTruthy()
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/admin/settings/document-templates/matters?q=Client%20Revocable',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    )
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/settings/estate-clauses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ revisionId: proposedRevision.id, matterId: '99999999-9999-4999-8999-999999999999' }),
      }),
    )
  })

  it('surfaces optimistic publication conflicts without clearing confirmation', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(response(matterSearchResponse))
      .mockResolvedValueOnce(response({ files: [], validationReport: {}, evidenceId: 'evidence-1' }))
      .mockResolvedValueOnce(response({ error: 'The current publication changed; reload before publishing' }, false))
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
    const panel = screen.getByRole('region', { name: 'Clause review' })
    await user.type(within(panel).getByLabelText('Representative matter for preview'), 'Client Revocable')
    await user.click(await within(panel).findByText('Jane Q. Client'))
    await user.click(within(panel).getByRole('button', { name: 'Preview' }))
    await within(panel).findByText(/Immutable validation evidence was recorded/i)
    const confirmation = within(panel).getByLabelText('Type trust.no_contest to confirm')
    await user.type(confirmation, 'trust.no_contest')
    await user.click(within(panel).getByRole('button', { name: 'Approve and publish' }))

    expect((await within(panel).findByRole('alert')).textContent).toContain('current publication changed')
    expect((confirmation as HTMLInputElement).value).toBe('trust.no_contest')
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/admin/settings/estate-clauses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review?revisionId=${proposedRevision.id}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'publish', expectedCurrentRevisionId: publishedRevision.id }),
      }),
    ))
  })

  it('does not require representative preview evidence before publication', async () => {
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
    const panel = screen.getByRole('region', { name: 'Clause review' })
    await user.type(within(panel).getByLabelText('Type trust.no_contest to confirm'), 'trust.no_contest')
    expect((within(panel).getByRole('button', { name: 'Approve and publish' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(panel).queryByText(/successful current representative-matter preview is required/i)).toBeNull()
  })

  it('clears exact-key confirmation when switching review candidates', async () => {
    const user = userEvent.setup()
    render(<EstateClauseLibrarySection currentUserId="reviewer" />)
    await user.click(await screen.findByRole('button', { name: 'Review No Contest' }))
    await user.type(screen.getByLabelText('Type trust.no_contest to confirm'), 'trust.no_contest')
    await user.click(screen.getByRole('button', { name: 'Review Self Authored' }))
    await user.click(screen.getByRole('button', { name: 'Review No Contest' }))
    expect((screen.getByLabelText('Type trust.no_contest to confirm') as HTMLInputElement).value).toBe('')
  })
})
