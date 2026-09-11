// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const router = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('@/lib/matterActivity', () => ({ logMatterActivity: vi.fn() }))
vi.mock('@/app/admin/drafting/[matterId]/ClauseOverridesPanel', () => ({ ClauseOverridesPanel: () => null }))
import GenerateStep from '@/app/admin/drafting/[matterId]/GenerateStep'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { PipelineMatter } from '@/types/database'
const beforePreflight = vi.fn(async () => true)
const onAdvance = vi.fn()
const props = { matterId: 'm', hubMatter: { designSheet: { id: 's' }, includedDocumentLabels: ['Will', 'Trust'], recentDrafts: [] } as unknown as DraftingHubMatter, sourcePreview: { matter: { client_name: 'Test' } as PipelineMatter, sheet: null, contacts: [], intakeSnapshot: null }, beforePreflight, onAdvance }
const preflight = { matterId: 'm', sourceRevision: 'rev', canGenerate: true, documentsToGenerate: [{ title: 'Will', filename: 'will', packageName: 'will' }, { title: 'Trust', filename: 'trust', packageName: 'trust' }], missing: [], warnings: [] }
const json = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals() })
beforeEach(() => { vi.clearAllMocks(); beforePreflight.mockResolvedValue(true) })
describe('generation workflow', () => {
  it('waits for the save barrier before fetching preflight and exposes failure persistently', async () => {
    beforePreflight.mockResolvedValue(false)
    const fetcher = vi.fn(async (_url: string) => json({ run: null }))
    vi.stubGlobal('fetch', fetcher)
    render(<GenerateStep {...props} />)
    await screen.findByText(/Save your latest decisions/)
    expect(fetcher.mock.calls.some(call => String(call[0]).includes('preflight'))).toBe(false)
  })
  it('generates clean selections with one action, bound to the checked revision, without auto-navigation', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('preflight') ? json(preflight) : init?.method === 'POST' ? json({ documents: ['Will'], documentRefs: [], success: true }) : json({ run: null }))
    vi.stubGlobal('fetch', fetcher)
    render(<GenerateStep {...props} />)
    const save = await screen.findByRole('button', { name: 'Save 2 Drafts' })
    fireEvent.click(save)
    await waitFor(() => expect(fetcher.mock.calls.some(([,init]) => init?.method === 'POST')).toBe(true))
    const request = fetcher.mock.calls.find(([,init]) => init?.method === 'POST')!
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({ sourceRevision: 'rev', documents: ['will', 'trust'], mode: 'save' })
    expect(onAdvance).not.toHaveBeenCalled()
  })
  it('preserves deliberate selections through a fix-and-return remount', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.endsWith('preflight') ? preflight : { run: null })))
    const first = render(<GenerateStep {...props} />)
    await screen.findByRole('button', { name: 'Save 2 Drafts' })
    const choices = screen.getAllByRole('checkbox')
    fireEvent.click(choices[0])
    await screen.findByRole('button', { name: 'Save 1 Draft' })
    first.unmount()
    render(<GenerateStep {...props} />)
    await screen.findByRole('button', { name: 'Save 1 Draft' })
  })
})
