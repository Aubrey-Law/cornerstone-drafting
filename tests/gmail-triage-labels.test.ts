import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyTriageLabel, triageLabelName } from '@/lib/email/gmailLabels'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('triageLabelName', () => {
  it('labels clients, leads and possible leads', () => {
    expect(triageLabelName('client')).toBe('Client')
    expect(triageLabelName('lead')).toBe('Lead')
    expect(triageLabelName('possible_lead')).toBe('Lead')
    expect(triageLabelName('contact')).toBeNull()
  })
})

describe('applyTriageLabel', () => {
  it('reuses an existing label, matched case-insensitively', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ labels: [{ id: 'Label_7', name: 'client' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const applied = await applyTriageLabel({ token: 't', threadId: 'thread-1', classification: 'client' })

    expect(applied).toBe('Client')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toContain('/threads/thread-1/modify')
    expect(JSON.parse(init.body)).toEqual({ addLabelIds: ['Label_7'] })
  })

  it('creates the label when the mailbox has none', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ labels: [{ id: 'INBOX', name: 'INBOX' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'Label_9', name: 'Lead' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-2' }))
    vi.stubGlobal('fetch', fetchMock)

    await applyTriageLabel({ token: 't', threadId: 'thread-2', classification: 'lead' })

    const [createUrl, createInit] = fetchMock.mock.calls[1]
    expect(createUrl).toMatch(/\/labels$/)
    expect(createInit.method).toBe('POST')
    expect(JSON.parse(createInit.body).name).toBe('Lead')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ addLabelIds: ['Label_9'] })
  })

  it('makes no Gmail calls for an unlabelled classification', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await applyTriageLabel({ token: 't', threadId: 'x', classification: 'contact' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a Gmail error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: 'nope' } }, 403)))
    await expect(
      applyTriageLabel({ token: 't', threadId: 'x', classification: 'client' }),
    ).rejects.toThrow('nope')
  })
})

describe('where labels are applied', () => {
  it('labels a thread the scan finds answered from Gmail', async () => {
    const { readFileSync } = await import('node:fs')
    const scan = readFileSync('lib/emailTriage/scan.ts', 'utf-8')
    const resolve = scan.slice(scan.indexOf("action.kind === 'resolve'"))
    expect(resolve.slice(0, resolve.indexOf('continue\n', resolve.indexOf('applyTriageLabel')))).toContain(
      'classification: existing!.classification',
    )
  })
})

describe('removeTriageLabels', () => {
  it('removes only the triage labels the mailbox has, on every thread', async () => {
    const { removeTriageLabels } = await import('@/lib/email/gmailLabels')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        labels: [
          { id: 'Label_C', name: 'Client' },
          { id: 'Label_L', name: 'lead' },
          { id: 'Label_X', name: 'Billing' },
        ],
      }))
      .mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    expect(await removeTriageLabels({ token: 't', threadIds: ['a', 'b'] })).toBe(2)

    const modifies = fetchMock.mock.calls.slice(1)
    expect(modifies.map(([url]) => url)).toEqual([
      expect.stringContaining('/threads/a/modify'),
      expect.stringContaining('/threads/b/modify'),
    ])
    for (const [, init] of modifies) {
      expect(JSON.parse(init.body)).toEqual({ removeLabelIds: ['Label_C', 'Label_L'] })
    }
  })

  it('makes no changes when the mailbox has no triage labels', async () => {
    const { removeTriageLabels } = await import('@/lib/email/gmailLabels')
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ labels: [{ id: 'INBOX', name: 'INBOX' }] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await removeTriageLabels({ token: 't', threadIds: ['a'] })).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('never this sender / domain', () => {
  it('cleans up Gmail for the sender and domain scopes, not a plain dismiss', async () => {
    const { readFileSync } = await import('node:fs')
    const route = readFileSync('app/api/admin/email-triage/[id]/dismiss/route.ts', 'utf-8')
    expect(route).toContain("scope === 'thread'\n    ? null\n    : await cleanUpInGmail(")
    expect(route).toContain("{ column: 'sender_domain', value: emailDomain(row.sender_email) }")
    expect(route).toContain(".eq(match.column, match.value)")
    expect(route).toContain('removeTriageLabels')
    expect(route).toContain('deleteGmailDraft')
  })
})
