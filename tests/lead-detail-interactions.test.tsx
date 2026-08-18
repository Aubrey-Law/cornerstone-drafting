// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }))
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/admin/leads/l1',
  useSearchParams: () => searchParams.current,
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))
vi.mock('@/components/crm/MarketingProfileCard', () => ({ MarketingProfileCard: () => null }))

import { LeadDetailClient } from '@/app/admin/leads/[id]/LeadDetailClient'
import { LeadIntakeCard } from '@/app/admin/leads/[id]/LeadIntakeCard'

const lead = { id:'l1', first_name:'Jane', middle_name:null, last_name:'Doe', preferred_name:null, full_name:'Jane Doe', email:'jane@example.com', phone:'617', date_of_birth:null, address_line1:'1 Main', address_line2:null, city:'Boston', state:'MA', zip:'02108', county:'Suffolk', marital_status:'married', practice_area:'EP', lead_source:'Referral', lead_status:'lead', engagement_fee_quoted:4500, created_at:'2026-07-21T12:00:00Z', updated_at:'2026-07-25T10:00:00Z', intake_sent_at:null, intake_completed_at:null, lead_next_action_snoozed_until:null }
const spouse = { first_name:'John', middle_name:null, last_name:'Doe', preferred_name:null, email:'john@example.com', phone:null, date_of_birth:null }

afterEach(() => { cleanup(); vi.restoreAllMocks(); router.push.mockReset(); router.refresh.mockReset(); router.replace.mockReset(); toastError.mockReset(); toastSuccess.mockReset(); searchParams.current = new URLSearchParams() })

/** The workspace is tabbed; most assertions need their tab on screen first. */
function showTab(name: 'Plan' | 'Tasks' | 'Timeline' | 'Intake' | 'Documents' | 'Notes') {
  // Radix tabs activate on mouse down, not click.
  act(() => { fireEvent.mouseDown(screen.getByRole('tab', { name: new RegExp(`^${name}`) })) })
}

/** Overflow actions moved off the 48px header row into the More menu. */
async function openOverflow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }))
}

function header() {
  return screen.getByLabelText('Lead actions')
}

describe('lead detail page', () => {
  it('changes the active record section from the mobile selector', async () => {
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Lead section' }), 'documents')

    expect(router.replace).toHaveBeenCalledWith('/admin/leads/l1?tab=documents', { scroll: false })
  })

  it('renders the intake status strip without duplicate next actions', () => {
    render(<LeadIntakeCard intake={{}} intakeUrl={null} onOpen={vi.fn()} onCopy={vi.fn()} />)

    expect(screen.getByText('Never sent · nothing submitted · 0 of 7 sections')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open intake' })).toBeTruthy()
    // No link prepared yet is not a dead end — copying issues one.
    expect((screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Copy link' }).getAttribute('aria-describedby')).toBeNull()
    expect(screen.getAllByLabelText(/incomplete$/i)).toHaveLength(7)
    for (const duplicate of ['Send intake', 'Resend intake', 'Import intake', 'Summarize intake', 'Analyze MA estate tax']) {
      expect(screen.queryByRole('button', { name: duplicate })).toBeNull()
    }
  })

  it('pins one next-action ribbon above the tabbed workspace beside the field rail', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    const ribbon = screen.getByRole('status')
    const main = ribbon.closest('main')
    expect(main?.firstElementChild?.firstElementChild).toBe(ribbon)
    expect(within(ribbon).getByText('1')).toBeTruthy()
    expect(within(ribbon).getByText('Send intake to get the facts')).toBeTruthy()
    for (const action of ['Send intake', 'Fill it myself', 'Import', 'Snooze']) {
      expect(screen.getAllByRole('button', { name: action })).toHaveLength(1)
    }
    // The rail is a sibling of the workspace, not a column inside it.
    expect(screen.getByRole('complementary', { name: 'Lead details' })).toBeTruthy()
    expect(main?.previousElementSibling).toBe(screen.getByRole('complementary', { name: 'Lead details' }))
    expect(main?.querySelector('.xl\\:grid-cols-\\[1\\.6fr_1fr\\]')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Plan' }).getAttribute('data-state')).toBe('active')
    expect(screen.queryByRole('region', { name: 'Lead intake' })).toBeNull()

    showTab('Intake')
    expect(screen.getByRole('region', { name: 'Lead intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open intake' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('issues a standing link on demand when a booked lead never had one', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/api/admin/intake/link')) {
        return { ok: true, json: async () => ({ url: 'https://portal.test/intake/auth?invite=si1.x' }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    // `userEvent.setup()` installs its own clipboard stub, so replace it after.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(
      <LeadDetailClient
        lead={{ ...lead, intake_track: 'college_prep' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )
    showTab('Intake')
    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://portal.test/intake/auth?invite=si1.x'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/intake/link?intakeId=l1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(toastSuccess).toHaveBeenCalledWith('Intake link copied')
  })

  it('refuses to revive a revoked link behind the copy button', () => {
    render(
      <LeadDetailClient
        lead={lead}
        spouse={spouse}
        initialActivity={[]}
        initialIntakeLinkRevoked
      />,
    )
    showTab('Intake')

    const copy = screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    expect(copy.getAttribute('aria-describedby')).toBe('intake-link-unavailable')
    expect(screen.getByText(/This intake link was revoked/)).toBeTruthy()
  })

  it('refreshes intake progress when the server supplies a newer intake record', () => {
    const { rerender } = render(
      <LeadDetailClient lead={{ ...lead, updated_at: '2026-07-25T00:00:00Z', status: 'draft' }} spouse={spouse} initialActivity={[]} />,
    )
    showTab('Intake')
    expect(screen.getByText('Never sent · nothing submitted · 0 of 7 sections')).toBeTruthy()

    rerender(
      <LeadDetailClient lead={{ ...lead, updated_at: '2026-07-25T00:01:00Z', status: 'submitted' }} spouse={spouse} initialActivity={[]} />,
    )

    expect(screen.getByText('Sent · submitted · 1 of 7 sections')).toBeTruthy()
  })

  it('keeps the returned intake link available to copy after sending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      return { ok: true, json: async () => ({ url: 'https://example.test/intake?invite=abc' }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button', { name: 'Send intake' }))
    showTab('Intake')
    expect((await screen.findByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps a committed intake send successful when the activity refresh fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).includes('/activity')) {
        return { ok: false, json: async () => ({ error: 'activity refresh failed' }) } as Response
      }
      return {
        ok: true,
        json: async () => ({ url: 'https://example.test/intake?invite=abc' }),
      } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Send intake' }))

    showTab('Intake')
    expect((await screen.findByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('activity refresh failed')
    showTab('Timeline')
    expect(screen.getByText('Timeline refresh unavailable: activity refresh failed')).toBeTruthy()
  })

  it('keeps the rail ahead of the workspace and the ribbon ahead of the tabs', () => {
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    const rail = screen.getByRole('complementary', { name: 'Lead details' })
    const ribbon = screen.getByRole('status')
    const tabs = screen.getByRole('tablist')
    const precedes = (first: Element, second: Element) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(precedes(rail, ribbon)).toBe(true)
    expect(precedes(ribbon, tabs)).toBe(true)
  })

  it('fetches nothing while the workspace is on its opening tab', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [], progress: null }),
    } as Response)

    render(<LeadDetailClient lead={{ ...lead, matter_id: 'm1' }} spouse={spouse} initialActivity={[]} />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the matter-owned plan from the tasks tab, not a tab of its own', async () => {
    // The plan and the task queue are one table now, so the plan is the Tasks
    // tab's second view. It still reads the `matters` row the lead owns.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [], progress: null }),
    } as Response)

    searchParams.current = new URLSearchParams('tab=tasks&view=plan')
    render(<LeadDetailClient lead={{ ...lead, matter_id: 'm1' }} spouse={spouse} initialActivity={[]} />)

    expect(screen.queryByRole('tab', { name: /^SLA plan/ })).toBeNull()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/matters/m1/tasks', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }))
    })
  })

  it('integrates every supplied activity row into the unified timeline', () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      id: `a${index}`,
      event_type: 'details_updated',
      title: `Event ${index + 1}`,
      detail: null,
      created_at: `2026-07-${String(13 - index).padStart(2, '0')}T12:00:00Z`,
    }))
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={rows} />)
    showTab('Timeline')
    expect(screen.getByText('Event 9')).toBeTruthy()
  })

  it('shows an actor-loading warning without hiding timeline content', () => {
    render(
      <LeadDetailClient
        lead={lead}
        spouse={spouse}
        actorError="actor lookup failed"
        initialActivity={[{
          id: 'a1',
          event_type: 'details_updated',
          title: 'Phone updated',
          actor_id: 'user-1',
          created_at: '2026-07-24T12:00:00Z',
        }]}
      />,
    )

    showTab('Timeline')
    expect(screen.getByText('Actor names unavailable: actor lookup failed')).toBeTruthy()
    expect(screen.getByText('Phone updated')).toBeTruthy()
    expect(screen.getByText(/System ·/)).toBeTruthy()
  })

  it('renders one record header row with the status pill and the action set, no subtitle', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} activeAgreement={{id:'a1'}} />)
    expect(screen.getAllByText('Lead · day 4')).toHaveLength(1)
    // The two-row header and its subtitle paragraph are gone.
    expect(screen.queryByText(/Estate Planning · Referral/)).toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(within(header()).getByRole('button', { name: 'Call' })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: 'Email' })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: 'Text' })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: 'Intake' })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: 'Resume engagement' })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: 'More actions' })).toBeTruthy()
    expect(within(header()).getByRole('button', { name: 'Toggle details rail' })).toBeTruthy()
    expect(within(header()).queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/Last touch/)).toBeNull()

    await openOverflow(user)
    expect(screen.getByRole('menuitem', { name: 'Hire matter' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Mark lost' })).toBeTruthy()
  })

  it('collapses and restores the field rail from the header toggle', async () => {
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.getByRole('complementary', { name: 'Lead details' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Toggle details rail' }))
    expect(screen.queryByRole('complementary', { name: 'Lead details' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Toggle details rail' }))
    expect(screen.getByRole('complementary', { name: 'Lead details' })).toBeTruthy()
  })

  it('opens one-off email and text composers with the lead contact details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ok:true,json:async()=>({templates:[]})} as Response)
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await user.click(screen.getByRole('button', { name: 'Email' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('jane@example.com')
    expect(screen.getByLabelText('Template')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Text' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('617')
    expect(screen.getByLabelText('Text message')).toBeTruthy()
  })

  it('preserves template links and resolves first_name when sending lead email', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => undefined,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/settings/email/templates')) {
        return {
          ok: true,
          json: async () => ({
            templates: [{
              id: 'welcome',
              name: 'Welcome',
              subject: 'Welcome {{first_name}}',
              body: '<p>Hi {{first_name}},</p><p><a href="https://example.com/intake">Open intake</a></p>',
            }],
          }),
        } as Response
      }
      if (url.endsWith('/activity')) {
        return { ok: true, json: async () => ({ activity: [] }) } as Response
      }
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ success: true }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Email' }))
    await screen.findByRole('option', { name: 'Welcome' })
    await user.selectOptions(screen.getByLabelText('Template'), 'welcome')

    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Welcome Jane')
    const editor = screen.getByRole('textbox', { name: 'Message' })
    expect(editor.innerHTML).toContain('Hi Jane')
    expect(editor.innerHTML).toContain('href="https://example.com/intake"')

    await user.click(screen.getByRole('button', { name: 'Send email' }))
    const sendCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith('/api/admin/email/send') && init?.method === 'POST')
    const form = sendCall?.[1]?.body as FormData
    expect(JSON.parse(String(form.get('payload')))).toMatchObject({
      subject: 'Welcome Jane',
      html: expect.stringContaining('href="https://example.com/intake"'),
    })
  })

  it('renders the optional last-touch pill only when the timestamp prop is supplied', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    render(
      <LeadDetailClient
        lead={lead}
        spouse={spouse}
        initialActivity={[]}
        lastTouchAt="2026-07-23T12:00:00Z"
      />,
    )

    expect(screen.getByText('Last touch 2d ago')).toBeTruthy()
  })

  it('uses current activity as the effective last touch instead of stale loader or lead timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    render(
      <LeadDetailClient
        lead={{ ...lead, intake_sent_at: '2026-07-01T12:00:00Z', updated_at: '2026-07-25T11:59:00Z' }}
        spouse={spouse}
        initialActivity={[{
          id: 'activity-1',
          event_type: 'details_updated',
          title: 'Lead details updated',
          created_at: '2026-07-25T11:00:00Z',
        }]}
        activeAgreement={{ id: 'agreement-1' }}
        lastTouchAt="2026-07-15T12:00:00Z"
      />,
    )

    expect(screen.getByText('Last touch 0d ago')).toBeTruthy()
    expect(screen.queryByText('Follow up with this lead')).toBeNull()
  })

  it('clamps a future last-touch timestamp to zero calendar days ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    render(
      <LeadDetailClient
        lead={lead}
        spouse={spouse}
        initialActivity={[]}
        lastTouchAt="2026-07-27T12:00:00Z"
      />,
    )

    expect(screen.getByText('Last touch 0d ago')).toBeTruthy()
  })

  it('calculates lead age by firm-local calendar day near UTC midnight', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-26T07:30:00Z'))
    render(
      <LeadDetailClient
        lead={{ ...lead, created_at: '2026-07-26T06:30:00Z' }}
        spouse={spouse}
        initialActivity={[]}
        firmTimezone="America/Los_Angeles"
      />,
    )

    expect(screen.getByText('Lead · day 1')).toBeTruthy()
  })

  it.each(['hired', 'lost'])('hides the next-action ribbon for a %s lead', leadStatus => {
    const { rerender } = render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.getByText('Send intake to get the facts')).toBeTruthy()

    rerender(<LeadDetailClient lead={{ ...lead, lead_status: leadStatus, updated_at: '2026-07-25T10:01:00Z' }} spouse={spouse} initialActivity={[]} />)

    expect(screen.queryByText('Send intake to get the facts')).toBeNull()
  })

  it('hides the next-action ribbon while its snooze is in the future', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    const { rerender } = render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    expect(screen.getByText('Send intake to get the facts')).toBeTruthy()

    rerender(
      <LeadDetailClient
        lead={{ ...lead, lead_next_action_snoozed_until: '2026-07-26T12:00:00Z', updated_at: '2026-07-25T10:01:00Z' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    expect(screen.queryByText('Send intake to get the facts')).toBeNull()
  })

  it('clears an active snooze from the header overflow and restores the next action', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        lead: { ...lead, lead_next_action_snoozed_until: null },
        activity: {
          id: 'snooze-clear-1',
          event_type: 'next_action_snooze_cleared',
          title: 'Next action snooze cleared',
          detail: null,
          created_at: '2026-07-25T12:00:01Z',
        },
      }),
    } as Response)
    const user = userEvent.setup()
    render(
      <LeadDetailClient
        lead={{ ...lead, lead_next_action_snoozed_until: '2026-07-26T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Clear snooze' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ nextActionSnoozedUntil: null }),
    }))
    expect(await screen.findByText('Send intake to get the facts')).toBeTruthy()
    showTab('Timeline')
    expect(screen.getByText('Next action snooze cleared')).toBeTruthy()
  })

  it('opens the quoted-fee inline editor from the next-action ribbon', async () => {
    const user = userEvent.setup()
    render(
      <LeadDetailClient
        lead={{ ...lead, engagement_fee_quoted: null, intake_completed_at: '2026-07-24T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Quote fee' }))

    expect(screen.getByRole('spinbutton', { name: 'Quoted fee' })).toBeTruthy()
  })

  it('opens the intake sheet for both fill and review ribbon intents', async () => {
    const user = userEvent.setup()
    const firstRender = render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Fill it myself' }))
    expect(await screen.findByRole('dialog', { name: /Intake — Jane Doe/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    firstRender.unmount()

    render(
      <LeadDetailClient
        lead={{ ...lead, intake_completed_at: '2026-07-24T12:00:00Z', updated_at: '2026-07-25T10:01:00Z' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Review intake' }))
    expect(await screen.findByRole('dialog', { name: /Intake — Jane Doe/ })).toBeTruthy()
  })

  it('opens the existing import dialog from the ribbon', async () => {
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByRole('dialog', { name: 'Import Intake' })).toBeTruthy()
  })

  it('drafts the engagement from the ribbon and opens the returned agreement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ agreementId: 'agreement-1' }),
    } as Response)
    const user = userEvent.setup()
    render(
      <LeadDetailClient
        lead={{ ...lead, intake_completed_at: '2026-07-24T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Draft engagement' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1/engagement-draft', expect.objectContaining({ method: 'POST' }))
    expect(router.push).toHaveBeenCalledWith('/admin/engagements/agreement-1?step=design')
  })

  it('dispatches the shared softphone event from the follow-up ribbon', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    const openPhone = vi.fn()
    window.addEventListener('cornerstone:open-softphone', openPhone)
    const user = userEvent.setup()
    render(
      <LeadDetailClient
        lead={{ ...lead, email: null, phone: '+16175551212', intake_sent_at: '2026-07-20T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
        activeAgreement={{ id: 'a1' }}
        lastTouchAt="2026-07-17T12:00:00Z"
      />,
    )

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Call' }))

    expect(openPhone).toHaveBeenCalledTimes(1)
    window.removeEventListener('cornerstone:open-softphone', openPhone)
  })

  it('reactivates a lost lead through the only overflow transition', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) {
        return { ok: true, json: async () => ({ activity: [] }) } as Response
      }
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ lead: { ...lead, lead_status: 'lead' }, spouse }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={{ ...lead, lead_status: 'lost' }} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivate' }))

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: 'lead' })
  })

  it('marks the lead lost from the header overflow and removes its next action', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, _init) => {
      if (String(input).endsWith('/activity')) {
        return { ok: true, json: async () => ({ activity: [] }) } as Response
      }
      return {
        ok: true,
        json: async () => ({ lead: { ...lead, lead_status: 'lost' }, spouse }),
      } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await openOverflow(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Mark lost' }))

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: 'lost' })
    expect(await screen.findByText('Lost · day 4')).toBeTruthy()
    expect(screen.queryByText('Send intake to get the facts')).toBeNull()
  })

  it('keeps a committed status change successful when its activity refresh fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) {
        return { ok: false, json: async () => ({ error: 'activity refresh failed' }) } as Response
      }
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ lead: { ...lead, lead_status: 'lost' }, spouse }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await openOverflow(user)
    await user.click(await screen.findByRole('menuitem', { name: 'Mark lost' }))

    expect(await screen.findByText('Lost · day 4')).toBeTruthy()
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('activity refresh failed')
    showTab('Timeline')
    expect(screen.getByText('Timeline refresh unavailable: activity refresh failed')).toBeTruthy()
  })

  it('opens the converted matter from the hired lead header', async () => {
    const user = userEvent.setup()
    render(
      <LeadDetailClient
        lead={{ ...lead, lead_status: 'hired', matter_id: 'matter-1' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'View matter' }))

    expect(router.push).toHaveBeenCalledWith('/admin/matters/matter-1')
  })

  it('renders the resend variant once with its fill and snooze actions', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    render(
      <LeadDetailClient
        lead={{ ...lead, intake_sent_at: '2026-07-20T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
        nextAppointmentAt="2026-07-28T12:00:00Z"
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Resend intake' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Fill it myself' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Snooze' })).toHaveLength(1)
  })

  it('snoozes exactly seven days, then uses the returned lead and activity without a refresh', async () => {
    const now = Date.parse('2026-07-25T12:00:00Z')
    const until = '2026-08-01T12:00:00.000Z'
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        lead: { ...lead, lead_next_action_snoozed_until: until },
        activity: {
          id: 'snooze-1',
          event_type: 'next_action_snoozed',
          title: 'Next action snoozed',
          detail: 'Snoozed until Aug 1, 2026 08:00 AM',
          created_at: '2026-07-25T12:00:01Z',
        },
      }),
    } as Response)
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Snooze' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ nextActionSnoozedUntil: until }),
    }))
    expect(screen.queryByText('Send intake to get the facts')).toBeNull()
    showTab('Timeline')
    expect(await screen.findByText('Next action snoozed')).toBeTruthy()
  })

  it('filters unavailable follow-up channels and suppresses an empty follow-up ribbon', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    const { rerender } = render(
      <LeadDetailClient
        lead={{ ...lead, email: 'jane@example.com', phone: 'not callable', intake_sent_at: '2026-07-20T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
        activeAgreement={{ id: 'a1' }}
        lastTouchAt="2026-07-17T12:00:00Z"
      />,
    )

    // The header keeps its own disabled Call; the ribbon drops the channel.
    expect(within(screen.getByRole('status')).queryByRole('button', { name: 'Call' })).toBeNull()
    expect((within(header()).getByRole('button', { name: 'Call' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByRole('button', { name: 'Email' })).toHaveLength(2)

    rerender(
      <LeadDetailClient
        lead={{ ...lead, email: '   ', phone: 'not callable', intake_sent_at: '2026-07-20T12:00:00Z', updated_at: '2026-07-25T10:01:00Z' }}
        spouse={spouse}
        initialActivity={[]}
        activeAgreement={{ id: 'a1' }}
        lastTouchAt="2026-07-17T12:00:00Z"
      />,
    )

    expect(screen.queryByText('Follow up with this lead')).toBeNull()
  })

  it('converts from the header overflow and navigates to the returned matter', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({matterId:'m1'})} as Response)
    const user=userEvent.setup();render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await openOverflow(user)
    await user.click(await screen.findByRole('menuitem',{name:'Hire matter'}))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/admin/leads/l1/convert',expect.objectContaining({method:'POST'}))
    expect(router.push).toHaveBeenCalledWith('/admin/matters/m1')
  })

  it('announces a conversion error and remains on the lead', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,json:async()=>({error:'Conversion failed'})} as Response)
    const user=userEvent.setup();render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)
    await openOverflow(user)
    await user.click(await screen.findByRole('menuitem',{name:'Hire matter'}))
    expect((await screen.findByRole('alert')).textContent).toContain('Conversion failed')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('renders the readiness dial, grouped rows and dashed add pills instead of the meter and chip row', () => {
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    // 9 of 14 fields plus the intake and engagement gates.
    expect(screen.getByLabelText('Lead readiness 56 percent').textContent).toBe('Not ready yet')
    expect(screen.getByText('Missing Intake')).toBeTruthy()
    expect(screen.queryByText('9 of 14 complete')).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Lead details completeness' })).toBeNull()

    const rail = screen.getByRole('complementary', { name: 'Lead details' })
    for (const group of ['Contact', 'Household', 'Qualification']) {
      expect(within(rail).getByRole('heading', { name: group })).toBeTruthy()
    }
    expect(within(rail).getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617')
    // Empty fields keep their row and offer a dashed pill rather than a chip row.
    for (const label of ['Date of birth', 'Urgency', 'Estimated estate value', 'Minor children', 'Qualification notes']) {
      expect(within(rail).getByRole('button', { name: `Add ${label}` }).textContent).toBe('+ Add')
    }
    for (const control of ['Edit', 'Save', 'Cancel']) {
      expect(screen.queryByRole('button', { name: control })).toBeNull()
    }

    expect(within(rail).getByText('Intake answers land here automatically — you rarely need to type these.')).toBeTruthy()
    for (const prompt of ['Summarize intake', 'Analyze MA estate tax', 'Draft a pre-call email']) {
      expect(within(rail).getByRole('button', { name: prompt })).toBeTruthy()
    }
  })

  it('renders one add pill per incomplete field in rail group order', () => {
    const sparseLead = {
      ...lead,
      phone: null,
      address_line1: null,
      city: null,
      state: null,
      zip: null,
      practice_area: null,
      lead_source: null,
      engagement_fee_quoted: null,
      lead_urgency: null,
      taxable_estate: null,
      has_minor_children: null,
      qualification_notes: null,
    }
    render(<LeadDetailClient lead={sparseLead} spouse={null} initialActivity={[]} />)

    const rail = screen.getByRole('complementary', { name: 'Lead details' })
    // Middle and preferred name are optional, so their pills wait behind "+ More"
    // rather than reading as two unfinished fields on every lead.
    expect(within(rail).getAllByRole('button', { name: /^Add / })
      .map(button => button.getAttribute('aria-label'))).toEqual([
      // Secondary addresses sit above the field groups, empty until asked for.
      'Add Client emails',
      'Add Client phones',
      'Add Phone',
      'Add Date of birth',
      'Add Spouse',
      'Add Minor children',
      'Add Practice area',
      'Add Lead source',
      'Add Quoted fee',
      'Add Urgency',
      'Add Estimated estate value',
      'Add Qualification notes',
    ])
  })

  it('repairs a missing last name through the existing lastName partial field', async () => {
    const missingLastNameLead = { ...lead, last_name: null, full_name: 'Jane' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...missingLastNameLead, last_name: 'Doe' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={missingLastNameLead} spouse={spouse} initialActivity={[]} />)

    expect(screen.getAllByRole('button', { name: 'Add Last name' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Add Last name' }))
    const lastName = screen.getByRole('textbox', { name: 'Last name' })
    await user.type(lastName, 'Doe{Enter}')

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'lastName', value: 'Doe' }),
    }))
  })

  it('preserves contact-backed intake projections and synchronizes spouse after a field mutation', async () => {
    const hydratedLead = {
      ...lead,
      has_children: true,
      has_minor_children: false,
      _spouse: { first_name: 'John', last_name: 'Doe', date_of_birth: '1981-01-01' },
      _children: [{ first_name: 'Sam', last_name: 'Doe' }],
      _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Representative' }],
      _fid_poa_client: [{ first_name: 'Alex', last_name: 'Agent' }],
      _fid_hcp_client: [{ first_name: 'Casey', last_name: 'Proxy' }],
      _fid_trustee_client: [{ first_name: 'Taylor', last_name: 'Trustee' }],
      _fid_personal_rep_spouse: [{ first_name: 'Jordan', last_name: 'Representative' }],
      _fid_poa_spouse: [{ first_name: 'Jordan', last_name: 'Agent' }],
      _fid_hcp_spouse: [{ first_name: 'Jordan', last_name: 'Proxy' }],
    }
    const savedSpouse = { ...spouse, first_name: 'Jonathan' }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) {
        return { ok: true, json: async () => ({ activity: [] }) } as Response
      }
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            lead: { ...lead },
            spouse: savedSpouse,
            activity: {
              id: 'activity-1',
              event_type: 'details_updated',
              title: 'Lead details updated',
              created_at: '2026-07-25T12:00:00Z',
            },
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={hydratedLead} spouse={spouse} initialActivity={[]} />)

    showTab('Intake')
    expect(screen.getByLabelText('Household: complete')).toBeTruthy()
    expect(screen.getByLabelText('Fiduciaries: complete')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Save spouse' }))

    expect((await screen.findByRole('button', { name: 'Edit Spouse' })).textContent).toContain('Jonathan Doe')
    expect(screen.getByLabelText('Household: complete')).toBeTruthy()
    expect(screen.getByLabelText('Fiduciaries: complete')).toBeTruthy()
  })

  it('provides separate edit affordances for every populated name component', () => {
    render(
      <LeadDetailClient
        lead={{ ...lead, middle_name: 'Q', preferred_name: 'Janie' }}
        spouse={spouse}
        initialActivity={[]}
      />,
    )

    for (const label of ['First name', 'Middle name', 'Last name', 'Preferred name']) {
      expect(screen.getByRole('button', { name: `Edit ${label}` })).toBeTruthy()
    }
  })

  it('adds a blank middle name through its scalar partial field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, middle_name: 'Quincy' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    expect(within(screen.getByRole('complementary', { name: 'Lead details' })).queryByText('—')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show middle and preferred name' }))
    await user.click(screen.getByRole('button', { name: 'Add Middle name' }))
    await user.type(screen.getByRole('textbox', { name: 'Middle name' }), 'Quincy{Enter}')

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'middleName', value: 'Quincy' }),
    }))
  })

  it('adds a blank preferred name through its scalar partial field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, preferred_name: 'Janie' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    expect(within(screen.getByRole('complementary', { name: 'Lead details' })).queryByText('—')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show middle and preferred name' }))
    await user.click(screen.getByRole('button', { name: 'Add Preferred name' }))
    await user.type(screen.getByRole('textbox', { name: 'Preferred name' }), 'Janie{Enter}')

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'preferredName', value: 'Janie' }),
    }))
  })

  it('opens a populated phone in one click and Enter PATCHes only that field while announcing save state', async () => {
    let resolvePatch!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = resolve })
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '617-555-0111{Enter}')

    expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saving')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'phone', value: '(617) 555-0111' }),
    }))

    resolvePatch({ ok: true, json: async () => ({ lead: { ...lead, phone: '617-555-0111' }, spouse }) } as Response)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saved'))
    expect(screen.getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617-555-0111')
  })

  it('keeps an inline write committed and advances last touch when activity refresh fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) {
        return { ok: false, json: async () => ({ error: 'activity refresh failed' }) } as Response
      }
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            lead: { ...lead, phone: '617-555-0111', intake_sent_at: '2026-07-01T12:00:00Z' },
            spouse,
            activity: {
              id: 'activity-1',
              event_type: 'details_updated',
              title: 'Lead details updated',
              created_at: '2026-07-25T11:59:00Z',
            },
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(
      <LeadDetailClient
        lead={{ ...lead, intake_sent_at: '2026-07-01T12:00:00Z' }}
        spouse={spouse}
        initialActivity={[]}
        activeAgreement={{ id: 'agreement-1' }}
        lastTouchAt="2026-07-15T12:00:00Z"
      />,
    )
    expect(screen.getByText('Follow up with this lead')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '617-555-0111{Enter}')

    await waitFor(() => expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saved'))
    expect(screen.getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617-555-0111')
    expect(screen.getByText('Last touch 0d ago')).toBeTruthy()
    expect(screen.queryByText('Follow up with this lead')).toBeNull()
    showTab('Timeline')
    expect(screen.getByText('Timeline refresh unavailable: activity refresh failed')).toBeTruthy()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('keeps a lead-data refresh warning after a successful timeline refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) {
        return { ok: true, json: async () => ({ activity: [] }) } as Response
      }
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            lead: { ...lead, phone: '617-555-0111' },
            spouse,
            refreshWarning: 'Saved, but refreshed spouse data is unavailable.',
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '617-555-0111{Enter}')

    await waitFor(() => expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saved'))
    showTab('Timeline')
    expect(await screen.findByText(
      'Lead data refresh unavailable: Saved, but refreshed spouse data is unavailable.',
    )).toBeTruthy()
    expect(screen.queryByText(/Timeline refresh unavailable/)).toBeNull()
  })

  it('commits a changed scalar field on blur', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead: { ...lead, phone: '781' }, spouse }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '781')
    await user.click(screen.getByRole('button', { name: 'Summarize intake' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ field: 'phone', value: '(781' }),
    })))
  })

  it('Escape restores the persisted value without sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, 'changed{Escape}')

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    expect(screen.queryByRole('textbox', { name: 'Phone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Phone' }).textContent).toContain('617')
  })

  it('disables other detail triggers and chips while a dirty editor is active', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse }) } as Response
      return { ok: true, json: async () => ({ calls: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '999')

    const emailTrigger = screen.getByRole('button', { name: 'Edit Email' }) as HTMLButtonElement
    const dobChip = screen.getByRole('button', { name: 'Add Date of birth' }) as HTMLButtonElement
    expect(emailTrigger.disabled).toBe(true)
    expect(dobChip.disabled).toBe(true)
    await user.click(emailTrigger)
    await user.click(dobChip)

    expect((screen.getByRole('textbox', { name: 'Phone' }) as HTMLInputElement).value).toBe('(999')
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  it('commits on a later outside blur after a disabled handoff attempt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, phone: '999' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '999')
    await user.click(screen.getByRole('button', { name: 'Edit Email' }))
    await user.click(screen.getByRole('button', { name: 'Summarize intake' }))

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patches).toHaveLength(1)
      expect(patches[0]?.[1]?.body).toBe(JSON.stringify({ field: 'phone', value: '(999' }))
    })
  })

  it('disables every top action during an active edit and its pending save', async () => {
    let resolvePatch!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return new Promise<Response>(resolve => { resolvePatch = resolve })
      return { ok: true, json: async () => ({ calls: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const topControls = ['Call', 'Email', 'Text', 'Intake', 'Draft engagement', 'More actions']
      .map(name => within(header()).getByRole('button', { name })) as HTMLButtonElement[]
    const ribbonControls = ['Send intake', 'Fill it myself', 'Import', 'Snooze']
      .map(name => screen.getByRole('button', { name })) as HTMLButtonElement[]
    for (const control of topControls) expect(control.disabled).toBe(true)
    for (const control of ribbonControls) expect(control.disabled).toBe(true)

    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, '617-555-0111{Enter}')
    expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saving')
    for (const control of topControls) expect(control.disabled).toBe(true)
    for (const control of ribbonControls) expect(control.disabled).toBe(true)

    resolvePatch({ ok: true, json: async () => ({ lead: { ...lead, phone: '617-555-0111' }, spouse }) } as Response)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Phone save status' }).textContent).toBe('Saved'))
  })

  it('disables ribbon actions while a header action is pending', async () => {
    let resolveDraft!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/engagement-draft') && init?.method === 'POST') {
        return new Promise<Response>(resolve => { resolveDraft = resolve })
      }
      return { ok: true, json: async () => ({ activity: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Draft engagement' }))

    for (const name of ['Send intake', 'Fill it myself', 'Import', 'Snooze']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }

    resolveDraft({ ok: true, json: async () => ({ agreementId: 'agreement-1' }) } as Response)
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/engagements/agreement-1?step=design'))
  })

  it('disables header actions while a ribbon action is pending', async () => {
    const until = '2026-08-01T12:00:00.000Z'
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-25T12:00:00Z'))
    let resolveSnooze!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/l1') && init?.method === 'PATCH') {
        return new Promise<Response>(resolve => { resolveSnooze = resolve })
      }
      return { ok: true, json: async () => ({ activity: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Snooze' }))

    for (const name of ['Call', 'Email', 'Text', 'Intake', 'Draft engagement', 'More actions']) {
      expect((within(header()).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }

    resolveSnooze({
      ok: true,
      json: async () => ({
        lead: { ...lead, lead_next_action_snoozed_until: until },
        activity: {
          id: 'snooze-1',
          event_type: 'next_action_snoozed',
          title: 'Next action snoozed',
          detail: 'Snoozed until Aug 1, 2026 08:00 AM',
          created_at: '2026-07-25T12:00:01Z',
        },
      }),
    } as Response)
    await waitFor(() => expect(
      (within(header()).getByRole('button', { name: 'More actions' }) as HTMLButtonElement).disabled,
    ).toBe(false))
    showTab('Timeline')
    expect(await screen.findByText('Next action snoozed')).toBeTruthy()
  })

  it('rolls back, closes, restores trigger focus, and toasts when the server rejects a field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Phone is invalid' }),
    } as Response)
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, 'bad{Enter}')

    const trigger = await screen.findByRole('button', { name: 'Edit Phone' })
    expect(trigger.textContent).toContain('617')
    await waitFor(() => expect(trigger).toBe(document.activeElement))
    const alert = screen.getByRole('alert')
    expect(alert.id).toBe('lead-phone-error')
    expect(alert.textContent).toBe('Phone is invalid')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('lead-phone-error')
    expect(toastError).toHaveBeenCalledWith('Phone is invalid')
  })

  it('keeps address editing atomic and commits only after focus leaves the compound editor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ lead: { ...lead, address_line1: '2 Main' }, spouse }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Address' }))
    const street = screen.getByRole('textbox', { name: 'Address line 1' })
    await user.clear(street)
    await user.type(street, '2 Main')
    await user.click(screen.getByRole('textbox', { name: 'City' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Summarize intake' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/l1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        field: 'address',
        value: {
          addressLine1: '2 Main',
          addressLine2: null,
          city: 'Boston',
          state: 'MA',
          zip: '02108',
          county: 'Suffolk',
        },
      }),
    })))
  })

  it('cancels spouse removal without blur-saving or discarding the editor draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/calls?limit=50')) return { ok: true, json: async () => ({ calls: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse }) } as Response
      return { ok: true, json: async () => ({ activity: [] }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((screen.getByRole('textbox', { name: 'Spouse first name' }) as HTMLInputElement).value).toBe('Jonathan')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  it('retains spouse removal confirmation and persists only null after confirmation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse: null }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Remove spouse' }))
    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patchCalls).toHaveLength(1)
      expect(patchCalls[0]).toEqual([
        '/api/admin/leads/l1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ field: 'spouse', value: null }),
        }),
      ])
    })
  })

  it('keyboard spouse removal never blur-saves a draft before cancel or null confirmation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ lead, spouse: null }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')

    const removeTrigger = screen.getByRole('button', { name: 'Remove spouse' })
    removeTrigger.focus()
    await user.keyboard('{Enter}')
    let dialog = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((screen.getByRole('textbox', { name: 'Spouse first name' }) as HTMLInputElement).value).toBe('Jonathan')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    screen.getByRole('button', { name: 'Remove spouse' }).focus()
    await user.keyboard('{Enter}')
    dialog = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)

    within(dialog).getByRole('button', { name: 'Remove spouse' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
      expect(patches).toHaveLength(1)
      expect(patches[0]?.[1]?.body).toBe(JSON.stringify({ field: 'spouse', value: null }))
    })
  })

  it('retains the spouse draft and links a focused removal error when null persistence fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method === 'PATCH') {
        return { ok: false, json: async () => ({ error: 'Could not remove spouse' }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove spouse' }))

    const removeTrigger = await screen.findByRole('button', { name: 'Remove spouse' })
    expect((screen.getByRole('textbox', { name: 'Spouse first name' }) as HTMLInputElement).value).toBe('Jonathan')
    const alert = screen.getByRole('alert')
    expect(alert.id).toBe('lead-spouse-error')
    expect(alert.textContent).toBe('Could not remove spouse')
    expect(removeTrigger.getAttribute('aria-invalid')).toBe('true')
    expect(removeTrigger.getAttribute('aria-describedby')).toBe('lead-spouse-error')
    await waitFor(() => expect(removeTrigger).toBe(document.activeElement))
    expect(toastError).toHaveBeenCalledWith('Could not remove spouse')
  })

  it('clears a failed removal error after spouse recovery so later field errors remain visible', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/activity')) return { ok: true, json: async () => ({ activity: [] }) } as Response
      if (init?.method !== 'PATCH') return { ok: true, json: async () => ({}) } as Response

      const body = JSON.parse(String(init.body)) as { field: string; value: unknown }
      if (body.field === 'spouse' && body.value === null) {
        return { ok: false, json: async () => ({ error: 'Could not remove spouse' }) } as Response
      }
      if (body.field === 'spouse') {
        return {
          ok: true,
          json: async () => ({ lead, spouse: { ...spouse, first_name: 'Jonathan' } }),
        } as Response
      }
      return { ok: false, json: async () => ({ error: 'Phone is invalid' }) } as Response
    })
    const user = userEvent.setup()
    render(<LeadDetailClient lead={lead} spouse={spouse} initialActivity={[]} />)

    await user.click(screen.getByRole('button', { name: 'Edit Spouse' }))
    const firstName = screen.getByRole('textbox', { name: 'Spouse first name' })
    await user.clear(firstName)
    await user.type(firstName, 'Jonathan')
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove spouse' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not remove spouse')

    await user.click(screen.getByRole('button', { name: 'Save spouse' }))
    const spouseTrigger = await screen.findByRole('button', { name: 'Edit Spouse' })
    expect(screen.queryByText('Could not remove spouse')).toBeNull()
    expect(spouseTrigger.getAttribute('aria-invalid')).toBeNull()
    expect(spouseTrigger.getAttribute('aria-describedby')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit Phone' }))
    const phone = screen.getByRole('textbox', { name: 'Phone' })
    await user.clear(phone)
    await user.type(phone, 'bad{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert.id).toBe('lead-phone-error')
    expect(alert.textContent).toBe('Phone is invalid')
  })
})
