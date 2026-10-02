// @vitest-environment jsdom

import React from 'react'
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  status: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/integrations/settings', () => ({
  getIntegrationSettings: mocks.getSettings, updateIntegrationSettings: mocks.updateSettings,
}))
vi.mock('@/lib/integrations/statular/config', () => ({ getStatularConfigStatus: mocks.status }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { GET, PUT } from '@/app/api/admin/settings/statular/route'
import { StatularSettingsSection } from '@/app/admin/settings/StatularSettingsSection'

const configured = { clientConfigured: true, matterConfigured: false, generationConfigured: true }
let enabled: boolean

function put(body: unknown) {
  return new Request('http://localhost/api/admin/settings/statular', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  enabled = false
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: 'user-1' })
  mocks.getSettings.mockImplementation(async () => ({ statularSyncEnabled: enabled }))
  mocks.updateSettings.mockImplementation(async (patch: { statularSyncEnabled: boolean }) => {
    enabled = patch.statularSyncEnabled
  })
  mocks.status.mockReturnValue(configured)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/api/admin/settings/statular', () => {
  it('returns the toggle and boolean webhook readiness only', async () => {
    const response = await GET(new Request('http://localhost/api/admin/settings/statular'))

    await expect(response.json()).resolves.toEqual({ syncEnabled: false, config: configured })
  })

  it('requires staff auth', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })

    expect((await GET(new Request('http://localhost/x'))).status).toBe(403)
    expect((await PUT(put({ syncEnabled: true }))).status).toBe(403)
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('saves only the Statular toggle, attributed to the actor', async () => {
    const response = await PUT(put({ syncEnabled: true }))

    expect(mocks.updateSettings).toHaveBeenCalledWith({ statularSyncEnabled: true }, 'user-1')
    await expect(response.json()).resolves.toEqual({ syncEnabled: true, config: configured })
  })

  it.each([{}, { syncEnabled: 'yes' }, { syncEnabled: 1 }])('rejects %j', async body => {
    expect((await PUT(put(body))).status).toBe(400)
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })
})

describe('Settings → Statular', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const response = init?.method === 'PUT' ? await PUT(put(JSON.parse(String(init.body)))) : await GET(new Request('http://localhost/x'))
      return response
    }))
  })

  it('turns the fit-decision push on from the switch', async () => {
    const user = userEvent.setup()
    render(<StatularSettingsSection />)

    const toggle = await screen.findByRole('switch', { name: /create statular client when a lead is marked a fit/i })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Configured')).toBeTruthy()

    await user.click(toggle)

    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(mocks.updateSettings).toHaveBeenCalledWith({ statularSyncEnabled: true }, 'user-1')
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('warns when the webhook is not configured', async () => {
    mocks.status.mockReturnValue({ clientConfigured: false, matterConfigured: false, generationConfigured: true })
    render(<StatularSettingsSection />)

    expect(await screen.findByText('Not configured')).toBeTruthy()
    expect(screen.getByText(/isn.t configured, so nothing can be sent yet/i)).toBeTruthy()
  })
})
