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
