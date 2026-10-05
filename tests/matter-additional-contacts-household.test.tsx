// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PipelineMatter } from '@/types/database'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { MatterAdditionalContactsTab } from '@/app/admin/matters/[id]/MatterAdditionalContactsTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const contact = (id: string, first: string, relationship_type: string) => ({
  id, first_name: first, last_name: 'Client', relationship_type, relationship_label: null,
})

it('leaves the household to Family and says once that no one has a role yet', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/contacts')) {
      return new Response(JSON.stringify({ contacts: [
        contact('self', 'Jordan', 'self'),
        contact('spouse', 'Sam', 'spouse'),
        contact('friend', 'Riley', 'friend'),
      ] }))
    }
    return new Response(JSON.stringify({ sheet: { id: 'sheet-1', decisions: {} } }))
  }))

  render(
    <MatterAdditionalContactsTab
      matterId="m1"
      matter={{ matter_id: 'm1', client_name: 'Jordan Client' } as PipelineMatter}
      initialContacts={[]}
      embedded
    />,
  )

  await screen.findByText('Riley Client')
  // Family lists the client and spouse; repeating the client here tagged "(self)" was the bug.
  expect(screen.queryByText('Jordan Client')).toBeNull()
  expect(screen.queryByText('Sam Client')).toBeNull()
  await waitFor(() => expect(screen.getByText('No fiduciaries or beneficiaries added yet.')).toBeTruthy())
  expect(screen.queryByRole('heading', { name: 'Fiduciaries' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Beneficiaries' })).toBeNull()
})
