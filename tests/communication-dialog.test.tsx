// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  CommunicationDialog,
  type CommunicationTarget,
} from '@/components/comms/CommunicationDialog'

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/contacts' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const draftProps: Array<Record<string, unknown>> = []
vi.mock('@/components/matter/DraftWithAiButton', () => ({
  DraftWithAiButton: (props: Record<string, unknown>) => {
    draftProps.push(props)
    return <button type="button">Draft with AI</button>
  },
}))

const composerProps: Array<Record<string, unknown>> = []
vi.mock('@/components/rail/RailEmailPane', () => ({
  ManualEmailComposer: (props: Record<string, unknown>) => {
    composerProps.push(props)
    return <div data-testid="email-composer" />
  },
}))

let posted: Array<{ url: string; body: unknown }> = []

beforeEach(() => {
  draftProps.length = 0
  composerProps.length = 0
  posted = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    posted.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(target: CommunicationTarget, channel: 'email' | 'sms' = 'sms') {
  return render(
    <CommunicationDialog
      open
      channel={channel}
      target={target}
      recipientName="Rita Referrer"
      recipientEmail="rita@cpa.example.com"
      recipientPhone="(617) 555-0104"
      token="test-token"
      onOpenChange={() => {}}
      onSent={() => {}}
    />,
  )
}

describe('CommunicationDialog — retired text actions', () => {
  it.each(['lead', 'matter', 'contact'] as const)('does not compose or send SMS for a %s', type => {
    renderDialog({ type, id: 'record-1' })
    expect(screen.getByText('Text messaging retired')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send text' })).toBeNull()
    expect(posted).toEqual([])
  })
})

describe('CommunicationDialog — email', () => {
  it('scopes the composer to the record so the send is attributed', () => {
    renderDialog({ type: 'contact', id: 'c1' }, 'email')
    expect(screen.getByTestId('email-composer')).toBeTruthy()
    expect(composerProps[0]).toMatchObject({
      recordOverride: { type: 'contact', id: 'c1' },
    })
    expect(composerProps[0].initialContext).toMatchObject({
      recordType: 'contact',
      recipientEmail: 'rita@cpa.example.com',
    })
  })

  it('keeps the matter composer on the matter record', () => {
    renderDialog({ type: 'matter', id: 'm1' }, 'email')
    expect(composerProps[0]).toMatchObject({ recordOverride: { type: 'matter', id: 'm1' } })
  })
})
