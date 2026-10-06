// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), query: {} as Record<string, ReturnType<typeof vi.fn>> }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
import { GET } from '@/app/api/admin/matters/[id]/activity/route'
import { MatterActivityTab, groupActivityByDay } from '@/app/admin/matters/[id]/MatterActivityTab'
import { MATTER_ACTIVITY_PAGE, completeActivity, olderActivityCursor } from '@/lib/matters/activityPage'
import type { MatterActivity } from '@/types/database'

const MATTER = '123e4567-e89b-42d3-a456-426614174000'
function event(id: string, created_at: string, extra: Partial<MatterActivity> = {}): MatterActivity {
  return { id, matter_id: MATTER, event_type: 'note_added', actor_id: null, actor_email: null, actor_name: null, title: id, detail: null, metadata: null, created_at, ...extra } as MatterActivity
}

afterEach(cleanup)

describe('activity paging helpers', () => {
  it('has a cursor only when the page was full', () => {
    const full = Array.from({ length: MATTER_ACTIVITY_PAGE }, (_, i) => event(`e${i}`, new Date(Date.UTC(2026, 8, 30) - i * 3_600_000).toISOString()))
    expect(olderActivityCursor(full)).toBe(full[full.length - 1].created_at)
    expect(olderActivityCursor(full.slice(1))).toBeNull()
  })

  it('stops the timeline at the cursor, so older lead history waits for the matter rows beside it', () => {
    const rows = [event('new', '2026-09-30T12:00:00Z'), event('lead-old', '2026-01-01T12:00:00Z', { metadata: { origin: 'lead' } })]
    expect(completeActivity(rows, '2026-09-01T00:00:00Z').map(row => row.id)).toEqual(['new'])
    expect(completeActivity(rows, null)).toHaveLength(2)
  })
})

describe('matter activity tab', () => {
  it('groups by the firm’s day, not the viewer’s', () => {
    // 03:30 UTC on Oct 5 is 11:30 PM on Oct 4 in Boston.
    const [day] = groupActivityByDay([event('late', '2026-10-05T03:30:00Z')])
    expect(day.label).toBe('Sunday, October 4, 2026')
  })

  it('shows only the time under the day heading, and offers older activity while there is more', () => {
    const onLoadOlder = vi.fn()
    render(
      <MatterActivityTab
        activity={[event('kept', '2026-10-05T03:30:00Z', { actor_name: 'AT' }), event('lead-old', '2026-01-01T12:00:00Z', { metadata: { origin: 'lead' } })]}
        loading={false}
        olderCursor="2026-09-01T00:00:00Z"
        onLoadOlder={onLoadOlder}
      />,
    )
    expect(screen.getByText('kept').closest('article')!.querySelector('time')!.textContent).toBe('11:30 PM')
    expect(screen.queryByText('lead-old')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('has no button once everything is loaded', () => {
    render(<MatterActivityTab activity={[event('only', '2026-10-01T12:00:00Z')]} loading={false} olderCursor={null} onLoadOlder={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Show older activity' })).toBeNull()
  })
})

describe('GET /api/admin/matters/[id]/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ err: null })
    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const name of ['select', 'eq', 'lt', 'order']) chain[name] = vi.fn(() => chain)
    chain.limit = vi.fn(async () => ({ data: [event('older', '2026-08-01T00:00:00Z')], error: null }))
    mocks.query = chain
    mocks.from.mockReturnValue(chain)
  })

  it('returns the page older than the cursor and says when nothing older remains', async () => {
    const response = await GET(new Request(`http://local/api/admin/matters/${MATTER}/activity?before=2026-09-01T00:00:00Z`), { params: Promise.resolve({ id: MATTER }) })
    expect(response.status).toBe(200)
    expect(mocks.query.eq).toHaveBeenCalledWith('matter_id', MATTER)
    expect(mocks.query.lt).toHaveBeenCalledWith('created_at', '2026-09-01T00:00:00Z')
    expect(mocks.query.limit).toHaveBeenCalledWith(MATTER_ACTIVITY_PAGE)
    expect(await response.json()).toMatchObject({ activity: [{ id: 'older' }], cursor: null })
  })

  it('refuses a missing cursor or a bad id', async () => {
    expect((await GET(new Request(`http://local/x`), { params: Promise.resolve({ id: MATTER }) })).status).toBe(400)
    expect((await GET(new Request(`http://local/x?before=2026-09-01`), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400)
  })
})
