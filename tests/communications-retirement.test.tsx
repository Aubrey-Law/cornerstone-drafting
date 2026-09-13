// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/admin/components/ChatPanel', () => ({ ChatPanel: () => <p>Assistant workspace</p> }))
vi.mock('@/components/rail/RailEmailPane', () => ({ RailEmailPane: () => <p>Email draft</p> }))
vi.mock('@/components/rail/RailTasksPane', () => ({ RailTasksPane: () => <p>Task capture</p> }))
vi.mock('@/components/rail/RailActivityPane', () => ({ RailActivityPane: () => <p>Activity</p> }))
import { AdminRail, useAdminRail } from '@/components/rail/AdminRail'

function Harness() {
  const rail = useAdminRail()
  return <><button onClick={rail.toggle}>Open tools</button><AdminRail rail={rail} /></>
}
afterEach(() => { cleanup(); localStorage.clear() })

describe('retired communication surfaces', () => {
  it('keeps tools available without phone or text controls', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Open tools'))
    expect(await screen.findByRole('button', { name: 'Assistant' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Phone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull()
    expect(screen.queryByText('Browser dialer')).toBeNull()
  })
  it('recovers an old phone tab preference into the assistant', async () => {
    localStorage.setItem('cornerstone.admin.rail', JSON.stringify({ open: true, tab: 'phone' }))
    render(<Harness />)
    expect((await screen.findByRole('button', { name: 'Assistant' })).getAttribute('aria-current')).toBe('page')
  })
})
