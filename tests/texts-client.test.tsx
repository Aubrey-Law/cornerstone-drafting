// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SmsThread, SmsThreadMessage } from '@/lib/queries/smsThreads'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/supabaseClient', () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } }
})

import { TextsClient } from '@/app/admin/texts/TextsClient'

function thread(overrides: Partial<SmsThread>): SmsThread {
  return {
    phone: '5555550001', phoneE164: '+15555550001', name: null, kind: 'unknown', href: null,
    leadId: null, matterId: null, contactId: null, lastBody: 'Hello?', lastDirection: 'inbound',
    lastStatus: 'received', lastMessageAt: '2026-09-20T15:00:00Z', unreadCount: 0, optedOut: false,
    ...overrides,
  }
}

const unknown = thread({ phone: '5555550001', unreadCount: 2 })
const lead = thread({
  phone: '5555550002', name: 'Lee Lead', kind: 'lead', href: '/admin/leads/lead-1', leadId: 'lead-1',
  lastBody: 'Thanks!',
})
const optedOut = thread({ phone: '5555550003', name: 'Opted Person', kind: 'lead', href: '/admin/leads/x', optedOut: true })

const messages: Record<string, SmsThreadMessage[]> = {
  '5555550001': [{ id: 'm1', direction: 'inbound', body: 'Hello?', status: 'received', error: null, actorName: null, createdAt: '2026-09-20T15:00:00Z' }],
  '5555550002': [
    { id: 'm2', direction: 'outbound', body: 'Hi Lee', status: 'delivered', error: null, actorName: 'Staff', createdAt: '2026-09-20T14:00:00Z' },
    { id: 'm3', direction: 'inbound', body: 'Thanks!', status: 'received', error: null, actorName: null, createdAt: '2026-09-20T15:00:00Z' },
  ],
  '5555550003': [{ id: 'm4', direction: 'inbound', body: 'STOP', status: 'opt_out', error: null, actorName: null, createdAt: '2026-09-20T15:00:00Z' }],
}
const all = [unknown, lead, optedOut]
const calls: Array<{ url: string; method: string }> = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (url.startsWith('/api/admin/texts/threads?')) return json({ threads: all })
    const read = url.match(/threads\/(\d+)\/read$/)
    if (read) return json({ marked: 2 })
    const one = url.match(/threads\/(\d+)$/)
    if (one) return json({ thread: all.find(t => t.phone === one[1]) ?? null, messages: messages[one[1]] ?? [] })
    return json({})
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('TextsClient', () => {
  it('lists conversations with unread and unknown senders marked', async () => {
    render(<TextsClient initialThreads={all} initialPhone={null} sendingEnabled loadError={null} />)
    const list = screen.getByRole('region', { name: 'Conversations' })
    expect(list.textContent).toContain('(555) 555-0001')
    expect(list.textContent).toContain('Unknown')
    expect(list.textContent).toContain('Lee Lead')
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
  })

  it('offers Link to record and Create lead for an unknown sender, and marks it read on open', async () => {
    render(<TextsClient initialThreads={all} initialPhone="5555550001" sendingEnabled loadError={null} />)
    expect(await screen.findByRole('button', { name: /Link to record/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create lead/ })).toBeTruthy()
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/5555550001/read') && c.method === 'POST')).toBe(true))
  })

  it('links a known sender to their record instead', async () => {
    render(<TextsClient initialThreads={all} initialPhone="5555550002" sendingEnabled loadError={null} />)
    const open = await screen.findByRole('link', { name: 'Open record' })
    expect(open.getAttribute('href')).toBe('/admin/leads/lead-1')
    expect(screen.queryByRole('button', { name: /Create lead/ })).toBeNull()
    expect(screen.getByText('Delivered', { exact: false })).toBeTruthy()
  })

  it('replaces the composer with an explanation for an opted-out number', async () => {
    render(<TextsClient initialThreads={all} initialPhone="5555550003" sendingEnabled loadError={null} />)
    expect(await screen.findByText(/opted out of texts/)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /Text Opted Person/ })).toBeNull()
  })

  it('is read-only while texting is switched off', async () => {
    render(<TextsClient initialThreads={all} initialPhone="5555550002" sendingEnabled={false} loadError={null} />)
    expect(await screen.findByText(/Texting is turned off/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /New text/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends a reply to the open conversation', async () => {
    render(<TextsClient initialThreads={all} initialPhone="5555550002" sendingEnabled loadError={null} />)
    const box = await screen.findByRole('textbox', { name: 'Text Lee Lead' })
    await userEvent.type(box, 'See you then')
    await userEvent.click(screen.getByRole('button', { name: /^Send$/ }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/5555550002/send') && c.method === 'POST')).toBe(true))
  })
})
