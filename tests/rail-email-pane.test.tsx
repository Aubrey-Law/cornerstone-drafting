// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const pathname = { current: '/admin/matters/m1' }
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))

import { RailEmailPane } from '@/components/rail/RailEmailPane'

const MATTER_CONTEXT = {
  recordType: 'matter' as const,
  recordId: 'm1',
  recipientName: 'Margaret Whitfield',
  recipientEmail: 'margaret@example.com',
  alternateEmails: [{ label: 'Harold Whitfield', email: 'harold@example.com' }],
  documents: [
    { id: 'd1', name: 'Trust draft.docx', size: 24_000, folder: 'drafts' },
    { id: 'd2', name: 'Deed.pdf', size: 12_000, folder: 'client' },
  ],
}

const LEAD_CONTEXT = {
  recordType: 'lead' as const,
  recordId: 'l1',
  recipientName: 'Harold Pike',
  recipientEmail: 'harold.pike@example.com',
  alternateEmails: [],
  documents: [],
}

const TEMPLATES = [
  {
    id: 't1',
    name: 'Intake follow-up',
    subject: 'Following up, {{client_first_name}}',
    body: 'Hi {{client_first_name}}, checking in on your intake.',
  },
]

function mockFetch(options: {
  context?: unknown
  sendError?: string
  sendStatus?: string
  draft?: unknown
  signature?: { html: string; includeByDefault: boolean }
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/admin/email/compose-context')) {
      return { ok: true, json: async () => ({ context: options.context ?? MATTER_CONTEXT }) } as Response
    }
    if (url.includes('/api/admin/settings/email/templates')) {
      return { ok: true, json: async () => ({ templates: TEMPLATES }) } as Response
    }
    if (url.includes('/api/admin/settings/email/signature')) {
      return {
        ok: true,
        json: async () => ({ signature: options.signature ?? { html: '', includeByDefault: true } }),
      } as Response
    }
    if (url.includes('/api/admin/email/draft')) {
      if (init?.method === 'PUT') return { ok: true, json: async () => ({ draft: JSON.parse(String(init.body)) }) } as Response
      if (init?.method === 'DELETE') return { ok: true, json: async () => ({ ok: true }) } as Response
      return { ok: true, json: async () => ({ draft: options.draft ?? null }) } as Response
    }
    if (url.includes('/api/admin/email/preview')) {
      return { ok: true, json: async () => ({ html: '<p>Rendered preview</p>', unresolved: [] }) } as Response
    }
    if (url.includes('/api/admin/email/send')) {
      if (options.sendError) {
        return { ok: false, json: async () => ({ error: options.sendError }) } as Response
      }
      return { ok: true, json: async () => ({ success: true, status: options.sendStatus ?? 'sent' }) } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * The file input is visually hidden behind an "From computer" button, so
 * userEvent.upload refuses it — drive the change event directly.
 */
function attach(...files: File[]) {
  const input = screen.getByLabelText('Attach files from your computer') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

async function typeBody(user: ReturnType<typeof userEvent.setup>, text: string) {
  const body = screen.getByLabelText('Message')
  await user.click(body)
  await user.type(body, text)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  pathname.current = '/admin/matters/m1'
})

describe('rail email pane', () => {
  it('prefills the recipient from the matter and offers the spouse', async () => {
    mockFetch()
    render(<RailEmailPane />)

    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Harold Whitfield' }))
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('harold@example.com')
    expect(screen.getByText('Logs to the matter timeline')).toBeTruthy()
  })

  it('fills subject and body from a template and clears them for a one-off', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await screen.findByRole('option', { name: 'Intake follow-up' })

    await user.selectOptions(screen.getByLabelText('Template'), 't1')
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Following up, Margaret')
    expect(screen.getByLabelText('Message').textContent).toContain('Hi Margaret')

    await user.selectOptions(screen.getByLabelText('Template'), 'none')
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('')
  })

  it('sends a one-off email with the matter id so it lands on the timeline', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.type(screen.getByLabelText('Subject'), 'Quick question')
    await typeBody(user, 'Are Tuesday afternoons workable?')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      const send = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/email/send'))
      expect(send).toBeTruthy()
      const form = send![1]!.body as FormData
      const payload = JSON.parse(String(form.get('payload')))
      expect(payload).toMatchObject({
        to: 'margaret@example.com',
        subject: 'Quick question',
        matterId: 'm1',
        documentIds: [],
      })
      expect(payload.text).toContain('Tuesday')
    })
    expect(await screen.findByText('Sent to margaret@example.com.')).toBeTruthy()
  })

  it('attaches matter documents by id and local files as form parts', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.click(screen.getByRole('button', { name: /from documents/i }))
    await user.click(screen.getByRole('checkbox', { name: /Trust draft\.docx/ }))

    attach(new File(['hello'], 'notes.txt', { type: 'text/plain' }))

    await user.type(screen.getByLabelText('Subject'), 'Documents attached')
    await typeBody(user, 'Please review the attached.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      const send = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/email/send'))
      expect(send).toBeTruthy()
      const form = send![1]!.body as FormData
      expect(JSON.parse(String(form.get('payload'))).documentIds).toEqual(['d1'])
      expect((form.getAll('files')[0] as File).name).toBe('notes.txt')
    })
  })

  it('lets an attached file be removed before sending', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await screen.findByRole('button', { name: /from computer/i })

    attach(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByText('notes.txt')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Remove notes.txt' }))
    expect(screen.queryByText('notes.txt')).toBeNull()
  })

  it('offers no document picker on a lead, only computer uploads', async () => {
    pathname.current = '/admin/leads/l1'
    mockFetch({ context: LEAD_CONTEXT })
    render(<RailEmailPane />)

    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('harold.pike@example.com'),
    )
    expect(screen.queryByRole('button', { name: /from documents/i })).toBeNull()
    expect(screen.getByRole('button', { name: /from computer/i })).toBeTruthy()
    expect(screen.getByText('Logs to the lead timeline')).toBeTruthy()
  })

  it('keeps send disabled until recipient, subject and body are all present', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    const sendButton = screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement
    expect(sendButton.disabled).toBe(true)

    await user.type(screen.getByLabelText('Subject'), 'Subject only')
    expect(sendButton.disabled).toBe(true)

    await typeBody(user, 'And a body.')
    expect(sendButton.disabled).toBe(false)
  })

  it('surfaces a send failure without clearing the draft', async () => {
    mockFetch({ sendError: 'Mailbox rejected the attachment' })
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.type(screen.getByLabelText('Subject'), 'Keep me')
    await typeBody(user, 'Draft body.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Mailbox rejected the attachment',
    )
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Keep me')
  })

  it('blocks sending when the attachments exceed the size cap', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.type(screen.getByLabelText('Subject'), 'Too big')
    await typeBody(user, 'Body.')

    attach(new File([new Uint8Array(11 * 1024 * 1024)], 'huge.zip', { type: 'application/zip' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/the limit is 10\.0 MB/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides Cc until asked for, then sends the parsed list', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )
    expect(screen.queryByLabelText('Cc')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cc' }))
    await user.type(screen.getByLabelText('Cc'), 'paralegal@example.com, cpa@example.com')

    await user.type(screen.getByLabelText('Subject'), 'Copying the team')
    await typeBody(user, 'Looping in the team.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      const send = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/email/send'))
      const payload = JSON.parse(String((send![1]!.body as FormData).get('payload')))
      expect(payload.cc).toEqual(['paralegal@example.com', 'cpa@example.com'])
    })
  })

  it('blocks sending on a malformed Cc address instead of dropping it', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.type(screen.getByLabelText('Subject'), 'Bad cc')
    await typeBody(user, 'Body.')
    await user.click(screen.getByRole('button', { name: 'Cc' }))
    await user.type(screen.getByLabelText('Cc'), 'not-an-address')

    expect(await screen.findByText('Not a valid address: not-an-address')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds the spouse to Cc from the +cc chip without touching To', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.click(screen.getByRole('button', { name: 'Cc Harold Whitfield' }))

    expect((screen.getByLabelText('Cc') as HTMLInputElement).value).toBe('harold@example.com')
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com')
  })

  it('clears Cc after a successful send', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.click(screen.getByRole('button', { name: 'Cc' }))
    await user.type(screen.getByLabelText('Cc'), 'paralegal@example.com')
    await user.type(screen.getByLabelText('Subject'), 'Done')
    await typeBody(user, 'All set.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await screen.findByText('Sent to margaret@example.com.')
    expect(screen.queryByLabelText('Cc')).toBeNull()
  })

  it('hides Bcc until asked for, then sends it separately from Cc', async () => {
    const fetchMock = mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )
    expect(screen.queryByLabelText('Bcc')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cc' }))
    await user.type(screen.getByLabelText('Cc'), 'paralegal@example.com')
    await user.click(screen.getByRole('button', { name: 'Bcc' }))
    await user.type(screen.getByLabelText('Bcc'), 'file@example.com, archive@example.com')

    await user.type(screen.getByLabelText('Subject'), 'Blind copy')
    await typeBody(user, 'Copying the file.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      const send = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/email/send'))
      const payload = JSON.parse(String((send![1]!.body as FormData).get('payload')))
      expect(payload.cc).toEqual(['paralegal@example.com'])
      expect(payload.bcc).toEqual(['file@example.com', 'archive@example.com'])
    })
  })

  it('blocks sending on a malformed Bcc address', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.type(screen.getByLabelText('Subject'), 'Bad bcc')
    await typeBody(user, 'Body.')
    await user.click(screen.getByRole('button', { name: 'Bcc' }))
    await user.type(screen.getByLabelText('Bcc'), 'oops@')

    expect(await screen.findByText('Not a valid address: oops@')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('clears Bcc after a successful send', async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() =>
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'),
    )

    await user.click(screen.getByRole('button', { name: 'Bcc' }))
    await user.type(screen.getByLabelText('Bcc'), 'file@example.com')
    await user.type(screen.getByLabelText('Subject'), 'Done')
    await typeBody(user, 'All set.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await screen.findByText('Sent to margaret@example.com.')
    expect(screen.queryByLabelText('Bcc')).toBeNull()
  })

  it('restores a durable draft for the current record', async () => {
    mockFetch({
      signature: { html: '<p>Aubrey Law</p>', includeByDefault: true },
      draft: {
        to: 'saved@example.com',
        cc: ['cpa@example.com'],
        bcc: [],
        templateId: null,
        subject: 'Saved subject',
        bodyHtml: '<p>Saved message</p>',
        documentIds: ['d1'],
        includeSignature: false,
      },
    })
    render(<RailEmailPane />)

    await waitFor(() => expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Saved subject'))
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('saved@example.com')
    expect(screen.getByLabelText('Message').textContent).toContain('Saved message')
    expect(screen.getByText('Trust draft.docx')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Include signature' }) as HTMLButtonElement).dataset.state).toBe('unchecked')
  })

  it('autosaves the shared composer and retains a suppressed draft', async () => {
    const fetchMock = mockFetch({ sendStatus: 'suppressed' })
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() => expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('margaret@example.com'))

    await user.type(screen.getByLabelText('Subject'), 'Keep this draft')
    await typeBody(user, 'This should survive suppression.')
    await waitFor(() => {
      const save = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes('/api/admin/email/draft') && init?.method === 'PUT')
      expect(save).toBeTruthy()
    }, { timeout: 2500 })

    await user.click(screen.getByRole('button', { name: /^send$/i }))
    expect(await screen.findByText('Email was suppressed; the draft was retained.')).toBeTruthy()
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Keep this draft')
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes('/api/admin/email/draft') && init?.method === 'DELETE')).toBe(false)
  })

  it('uses the configured signature default and includes the choice in the send payload', async () => {
    const fetchMock = mockFetch({
      signature: { html: '<p>Aubrey Law</p>', includeByDefault: true },
    })
    const user = userEvent.setup()
    render(<RailEmailPane />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Include signature' }).getAttribute('data-state')).toBe('checked'))

    await user.type(screen.getByLabelText('Subject'), 'Signature')
    await typeBody(user, 'Hello.')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      const send = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/email/send'))
      const payload = JSON.parse(String((send![1]!.body as FormData).get('payload')))
      expect(payload.includeSignature).toBe(true)
    })
  })
})
