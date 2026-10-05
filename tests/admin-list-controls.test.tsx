// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadsClient, type LeadRow } from '@/app/admin/leads/LeadsClient'
import { MAX_LEAD_PAGE_SIZE } from '@/lib/leads/listParams'
import MattersClient from '@/app/admin/matters/MattersClient'
import { matterPageParams } from '@/lib/matters/pageParams'
import type { MatterListRow } from '@/lib/queries/matters'

const replace = vi.fn()
const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace }),
  usePathname: () => '/admin/leads',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

afterEach(() => {
  cleanup()
  replace.mockClear()
  push.mockClear()
})

const LEAD_PARAMS = {
  status: 'open' as const, card: null, search: '', practice: 'all',
  progress: 'all' as const, sort: 'newest' as const, show: 50,
}

/**
 * The lead list is filtered, sorted and paged by the database now, so a render
 * shows exactly the page it was handed and each control's job is to ask the
 * server for a different one. These assert the request; what comes back is
 * `lib/queries/leadList.ts` and `v_lead_list`.
 */
function renderLeads(rows: LeadRow[]) {
  return render(
    <LeadsClient
      initialLeads={rows}
      params={LEAD_PARAMS}
      total={rows.length}
      hasMore={false}
      summary={{
        open: rows.length, lost: 0, declined: 0, all: rows.length,
        attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
      }}
      esignEnabled
    />,
  )
}

const leadRows: LeadRow[] = [
  {
    id: 'zoe', full_name: 'Zoe Beta', first_name: 'Zoe', last_name: 'Beta', email: 'zoe@example.com', phone: '617-555-0101',
    practice_area: 'EP', status: 'draft', lead_status: 'lead', matter_id: null, intake_sent_at: '2026-07-20T00:00:00Z', intake_completed_at: null,
    engagement_status: null, engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 2500,
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z', lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'jane', full_name: 'Jane Alpha', first_name: 'Jane', last_name: 'Alpha', email: 'jane@example.com', phone: '617-555-0102',
    practice_area: 'EP', status: 'draft', lead_status: 'lead', matter_id: null, intake_sent_at: null, intake_completed_at: null,
    engagement_status: null, engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 1500,
    created_at: '2026-07-19T00:00:00Z', updated_at: '2026-07-19T00:00:00Z', lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-19T00:00:00Z',
  },
  {
    id: 'aaron', full_name: 'Aaron Gamma', first_name: 'Aaron', last_name: 'Gamma', email: 'aaron@example.com', phone: '617-555-0103',
    practice_area: 'Probate', status: 'draft', lead_status: 'lead', matter_id: null, intake_sent_at: null, intake_completed_at: null,
    engagement_status: null, engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 1000,
    created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z', lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-18T00:00:00Z',
  },
]

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function visibleLeadNames(): string[] {
  return screen.getAllByRole('link')
    .filter(link => link.getAttribute('href')?.startsWith('/admin/crm/opportunities/'))
    .map(link => link.textContent ?? '')
}

describe('lead list controls', () => {
  it('asks the server for a filtered page rather than narrowing the loaded one', async () => {
    const user = userEvent.setup()
    renderLeads(leadRows)

    await user.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'jane')
    // The field keeps up with typing; the query follows a beat later.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/leads?q=jane', { scroll: false }))
    // Every row it was given stays on screen — narrowing is the server's job.
    expect(visibleLeadNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])

    replace.mockClear()
    await selectOption(user, 'Filter leads by progress', 'Intake pending')
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(replace.mock.calls.at(-1)?.[0]).toContain('progress=intake_pending')
  })

  it('drops the page size when the question changes, so a narrower list starts at the top', async () => {
    const user = userEvent.setup()
    renderLeads(leadRows)

    await selectOption(user, 'Sort leads by', 'Name Z-A')
    await waitFor(() => expect(replace).toHaveBeenCalled())
    const url = replace.mock.calls.at(-1)?.[0] as string
    expect(url).toContain('sort=name_desc')
    expect(url).not.toContain('show=')
  })

  it('clear filters clears every filter param at once', async () => {
    const user = userEvent.setup()
    render(
      <LeadsClient
        initialLeads={leadRows}
        params={{ ...LEAD_PARAMS, search: 'jane', practice: 'EP', progress: 'intake_pending' }}
        total={leadRows.length}
        hasMore={false}
        summary={{
          open: 3, lost: 0, declined: 0, all: 3,
          attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
        }}
        esignEnabled
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/leads', { scroll: false }))
  })

  it('reports the page against the pipeline total and offers the next page', async () => {
    const user = userEvent.setup()
    render(
      <LeadsClient
        initialLeads={leadRows}
        params={LEAD_PARAMS}
        total={120}
        hasMore
        summary={{
          open: 120, lost: 0, declined: 0, all: 120,
          attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
        }}
        esignEnabled
      />,
    )

    expect(screen.getByText(/Showing 3 of 120 leads/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Load \d+ more/ }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/leads?show=53', { scroll: false }))
  })

  it('asks for a narrower question rather than a bigger page at the request ceiling', () => {
    // 500 rows is the most one request returns, so past it "load more" would
    // be a button that does nothing.
    const many = Array.from({ length: MAX_LEAD_PAGE_SIZE }, (_, index) => ({
      ...leadRows[0], id: `lead-${index}`, full_name: `Lead ${index}`,
    }))
    render(
      <LeadsClient
        initialLeads={many}
        params={LEAD_PARAMS}
        total={900}
        hasMore
        summary={{
          open: 900, lost: 0, declined: 0, all: 900,
          attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
        }}
        esignEnabled
      />,
    )

    expect(screen.queryByRole('button', { name: /Load \d+ more/ })).toBeNull()
    expect(screen.getByText('Search or filter to reach the rest')).toBeTruthy()
  })
})

const matterRows: MatterListRow[] = [
  {
    matter_id: 'zoe', matter_name: 'Zoe Estate Plan', matter_number: '2026-EP-003', stage: 'design', status: 'open', flags: null,
    matter_created: '2026-07-20T00:00:00Z', client_name: 'Zoe Beta', client_email: 'zoe@example.com', client_phone: '617-555-0101',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null, spouse_phone: null, spouse_dob: null, spouse_address: null,
    plan_type: null, marital_status: null, has_minor_children: null, taxable_estate: null, intake_status: 'submitted', design_status: null,
    intake_submitted_at: '2026-07-20T00:00:00Z', drafts_sent_at: null, signing_date: null, documents_executed_at: null,
    next_appointment: null, next_appointment_type: null, referral_source: null, fee_amount: null, opened_at: null, practice_area: 'EP',
  },
  {
    matter_id: 'jane', matter_name: 'Jane Estate Plan', matter_number: '2026-EP-002', stage: 'design', status: 'open', flags: null,
    matter_created: '2026-07-19T00:00:00Z', client_name: 'Jane Alpha', client_email: 'jane@example.com', client_phone: '617-555-0102',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null, spouse_phone: null, spouse_dob: null, spouse_address: null,
    plan_type: null, marital_status: null, has_minor_children: null, taxable_estate: null, intake_status: 'submitted', design_status: null,
    intake_submitted_at: '2026-07-19T00:00:00Z', drafts_sent_at: null, signing_date: null, documents_executed_at: null,
    next_appointment: null, next_appointment_type: null, referral_source: null, fee_amount: null, opened_at: null, practice_area: 'EP',
  },
  {
    matter_id: 'aaron', matter_name: 'Aaron Probate Matter', matter_number: '2026-PB-001', stage: 'intake', status: 'open', flags: null,
    matter_created: '2026-07-18T00:00:00Z', client_name: 'Aaron Gamma', client_email: 'aaron@example.com', client_phone: '617-555-0103',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null, spouse_phone: null, spouse_dob: null, spouse_address: null,
    plan_type: null, marital_status: null, has_minor_children: null, taxable_estate: null, intake_status: null, design_status: null,
    intake_submitted_at: null, drafts_sent_at: null, signing_date: null, documents_executed_at: null,
    next_appointment: null, next_appointment_type: null, referral_source: null, fee_amount: null, opened_at: null, practice_area: 'Probate',
  },
]

/**
 * Names in the desktop table. Phones get the same rows as a stacked list, and
 * jsdom applies no media queries, so both are in the DOM; read one of them.
 */
function visibleMatterNames(list: 'table' | 'phone' = 'table'): string[] {
  const container = list === 'table' ? screen.getByRole('table') : screen.getByRole('list', { name: 'Matters' })
  return within(container).getAllByRole('link')
    .filter(link => link.getAttribute('href')?.startsWith('/admin/matters/'))
    .map(link => link.textContent ?? '')
    .filter(Boolean)
}

describe('matter list controls', () => {
  it('sorts the filtered matter rows from the Sort by control', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)

    await selectOption(user, 'Sort matters by', 'Client Z-A')
    expect(visibleMatterNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
    // The phone list shows the same rows in the same order, without a link inside a link.
    expect(visibleMatterNames('phone')).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
    expect(document.querySelector('a a')).toBeNull()
  })

  it('keeps closed matters out of the list until the Closed chip is pressed', async () => {
    const user = userEvent.setup()
    // Closed along each axis the firm uses: the stage, and the status.
    const closedByStage = { ...matterRows[0], matter_id: 'ended', client_name: 'Cora Closed', stage: 'closed' as const }
    const closedByStatus = { ...matterRows[1], matter_id: 'shut', client_name: 'Dana Done', status: 'closed' }
    render(<MattersClient matters={[...matterRows, closedByStage, closedByStatus]} />)

    expect(visibleMatterNames()).not.toContain('Cora Closed')
    expect(visibleMatterNames()).not.toContain('Dana Done')

    await user.click(screen.getByRole('button', { name: 'Include closed' }))

    expect(visibleMatterNames()).toContain('Cora Closed')
    expect(visibleMatterNames()).toContain('Dana Done')
  })

  it('counts an archived matter as closed, the same as one closed outright', async () => {
    const user = userEvent.setup()
    const archived = { ...matterRows[0], matter_id: 'filed', client_name: 'Eli Archived', status: 'archived' }
    render(<MattersClient matters={[...matterRows, archived]} />)

    expect(visibleMatterNames()).not.toContain('Eli Archived')

    await user.click(screen.getByRole('button', { name: 'Include closed' }))

    expect(visibleMatterNames()).toContain('Eli Archived')
  })

  /**
   * The list the firm actually loads is paged by the database, and that path
   * renders the page it was handed without running the client-side filter at
   * all. So what keeps a closed matter off the screen there is the chip
   * reaching `firm_matter_page_v1` as `closed=1` — the rows come back already
   * filtered. Press it again and the parameter has to go, or there would be no
   * way back to the working list.
   */
  function serverPaged(matters: MatterListRow[], query: Record<string, string> = {}) {
    return {
      rows: matters, total: matters.length, page: 1, pageSize: 50, groups: {}, columns: {},
      insights: { open: 0, attention: 0, signing: 0, intakePending: 0, unreviewed: 0 },
      params: matterPageParams(query),
    }
  }

  it('asks the database for closed matters rather than filtering the page it holds', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} pagination={serverPaged(matterRows)} />)

    await user.click(screen.getByRole('button', { name: 'Include closed' }))

    expect(String(push.mock.calls.at(-1)?.[0])).toContain('closed=1')
  })

  it('shows what the database sends back, and gives the chip up on a second press', async () => {
    const user = userEvent.setup()
    const closed = { ...matterRows[0], matter_id: 'ended', client_name: 'Cora Closed', stage: 'closed' as const }
    const page = [...matterRows, closed]
    render(<MattersClient matters={page} pagination={serverPaged(page, { closed: '1' })} />)

    expect(visibleMatterNames()).toContain('Cora Closed')

    await user.click(screen.getByRole('button', { name: 'Include closed' }))

    expect(String(push.mock.calls.at(-1)?.[0])).not.toContain('closed=1')
  })

  it('clear filters preserves matter sort order and visible-row selection', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)

    await selectOption(user, 'Sort matters by', 'Client Z-A')
    await selectOption(user, 'Filter by practice area', 'Estate Planning')
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible matters' }))
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(visibleMatterNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
    expect(screen.getByText('2 selected')).toBeTruthy()
  })
})
