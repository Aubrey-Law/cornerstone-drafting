// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { GeneratedDatabase } from '@/types/supabase'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))

const auth = vi.hoisted(() => ({
  claims: { id: 'staff-1' } as { id: string } | null,
  role: 'attorney' as string | null,
  client: null as unknown,
}))
vi.mock('@/lib/supabaseServer', () => ({
  getCachedClaims: vi.fn(async () => auth.claims),
  getCachedUserRole: vi.fn(async () => auth.role),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => auth.client) }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound')
  }),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import SavedScanPage from '@/app/admin/review/scans/[scanId]/page'
import ReviewHistoryPage from '@/app/admin/review/page'
import { loadScan, scanStatusLabel } from '@/lib/review/scans'

const UPLOAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SCAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const STALE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const asClient = (client: ReturnType<typeof makeFakeClient>) => client as unknown as SupabaseClient<GeneratedDatabase>

function seed() {
  return makeFakeClient({
    review_uploads: [{ id: UPLOAD, label: 'Chawla plan', filename: 'chawla.docx', matter_id: null, origin: 'word' }],
    workflow_runs: [
      {
        id: 'run-1',
        kind: 'review',
        review_upload_id: UPLOAD,
        matter_id: null,
        document_version_id: null,
        status: 'completed',
        rule_total: 2,
        finding_count: 2,
        failed_count: 0,
        started_at: '2026-09-28T10:00:00Z',
        finished_at: '2026-09-28T10:01:00Z',
      },
    ],
    document_scans: [
      {
        id: SCAN,
        kind: 'proofread',
        status: 'partial',
        item_count: 2,
        section_total: 3,
        section_completed: 2,
        failures: [{ section: 3, reason: 'timeout' }],
        review_upload_id: UPLOAD,
        started_at: '2026-09-28T10:00:05Z',
        finished_at: '2026-09-28T10:02:00Z',
      },
      {
        id: STALE,
        kind: 'issues',
        status: 'running',
        item_count: 0,
        section_total: null,
        section_completed: 0,
        failures: [],
        review_upload_id: UPLOAD,
        started_at: '2026-09-27T09:00:00Z',
        finished_at: null,
      },
    ],
    document_scan_items: [
      {
        id: 'i-minor',
        scan_id: SCAN,
        sequence: 0,
        category: 'Punctuation & formatting',
        importance: 'minor',
        title: 'Space before comma',
        explanation: '',
        replacement: null,
        block_index: 9,
        char_start: 10,
        char_end: 19,
        quote: 'Trustee ,',
        citation_refusal: null,
        attempted_quote: null,
      },
      {
        id: 'i-important',
        scan_id: SCAN,
        sequence: 1,
        category: 'Internal annotations',
        importance: 'important',
        title: 'Unresolved successor-trustee placeholder',
        explanation: '[TBD] left in Article 4.',
        replacement: null,
        block_index: null,
        char_start: null,
        char_end: null,
        quote: null,
        citation_refusal: 'not_found',
        attempted_quote: 'shall be [TBD]',
      },
    ],
  })
}

beforeEach(() => {
  auth.claims = { id: 'staff-1' }
  auth.role = 'attorney'
  auth.client = asClient(seed())
})
afterEach(() => cleanup())

describe('saved checks', () => {
  it('read back most important first, with the document they checked', async () => {
    const scan = await loadScan(asClient(seed()), SCAN)
    expect(scan).toMatchObject({ kind: 'proofread', documentName: 'Chawla plan', failures: [{ section: 3, reason: 'timeout' }] })
    expect(scan?.items.map(i => i.id)).toEqual(['i-important', 'i-minor'])
    expect(scan?.items[1].citation).toEqual({ blockIndex: 9, charStart: 10, charEnd: 19, quote: 'Trustee ,' })
    expect(scan?.items[0].citation).toBeNull()
  })

  it('never read as clean when they did not finish', async () => {
    const stale = await loadScan(asClient(seed()), STALE)
    expect(scanStatusLabel(stale!, new Date('2026-09-28T12:00:00Z'))).toBe('did not finish')
    expect(scanStatusLabel(stale!, new Date('2026-09-27T09:02:00Z'))).toBe('in progress')
  })
})

describe('the saved check page', () => {
  it('sends anyone who is not staff to login', async () => {
    auth.role = 'client'
    await expect(SavedScanPage({ params: Promise.resolve({ scanId: SCAN }) })).rejects.toThrow('redirect:/auth/login')
  })

  it('404s a malformed or unknown id', async () => {
    await expect(SavedScanPage({ params: Promise.resolve({ scanId: 'x' }) })).rejects.toThrow('notFound')
    await expect(SavedScanPage({ params: Promise.resolve({ scanId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) })).rejects.toThrow('notFound')
  })

  it('shows every item, names the section that did not run, and links to the review it ran with', async () => {
    render(await SavedScanPage({ params: Promise.resolve({ scanId: SCAN }) }))
    expect(screen.getByRole('heading', { name: 'Proofread' })).toBeInTheDocument()
    expect(screen.getByTestId('scan-counts')).toHaveTextContent('1 important · 0 notable · 1 minor · some sections not checked')
    expect(screen.getByText(/Not checked: section 3 \(timeout\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'The review it ran with' })).toHaveAttribute('href', '/admin/review/run-1')
    const items = within(screen.getByTestId('scan-items')).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Unresolved successor-trustee placeholder')
    expect(items[0]).toHaveTextContent('was not found in the document')
    expect(items[1]).toHaveTextContent('Trustee ,')
  })
})

describe('review history', () => {
  it('lists saved checks beside the reviews', async () => {
    render(await ReviewHistoryPage())
    const links = within(screen.getByTestId('scan-history')).getAllByRole('link')
    expect(links.map(l => l.getAttribute('href')).sort()).toEqual([`/admin/review/scans/${SCAN}`, `/admin/review/scans/${STALE}`].sort())
    expect(screen.getByTestId('scan-history')).toHaveTextContent('Proofread')
  })
})
