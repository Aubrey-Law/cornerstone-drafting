// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/admin' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import AdminError from '@/app/admin/error'

/**
 * Where the admin error boundary offers to send you.
 *
 * It is one boundary for the whole admin app, and it used to say "Back to
 * drafting hub" and link /admin/drafting from wherever the error happened. An
 * error on Billing offered drafting — neither where you were nor where you were
 * going, and on a screen whose whole job is to get you back to solid ground.
 *
 * The section is derived from the same map the breadcrumbs use, so these assert
 * that the way back matches the section the header would have named.
 */

afterEach(cleanup)
beforeEach(() => { navigation.pathname = '/admin' })

const MATTER = '3f2b8c1e-9d4a-4b7c-8e15-0a6d2f4c9b11'

function renderAt(pathname: string) {
  navigation.pathname = pathname
  render(<AdminError error={new Error('boom')} reset={() => {}} />)
  return screen.getByRole('link')
}

describe('admin error boundary', () => {
  it('offers the section you were in', () => {
    const link = renderAt('/admin/billing/invoices')
    expect(link.textContent).toBe('Back to Billing')
    expect(link.getAttribute('href')).toBe('/admin/billing')
  })

  it('offers Matters from a matter detail page', () => {
    const link = renderAt(`/admin/matters/${MATTER}/design`)
    expect(link.textContent).toBe('Back to Matters')
    expect(link.getAttribute('href')).toBe('/admin/matters/list')
  })

  it('never offers drafting from an unrelated section', () => {
    // The specific wrongness this replaces.
    const link = renderAt('/admin/settings/style-sets')
    expect(link.getAttribute('href')).not.toBe('/admin/drafting')
    expect(link.textContent).toBe('Back to Settings')
  })

  it('falls back to Today on a top-level page, which has no section above it', () => {
    for (const pathname of ['/admin', '/admin/tasks', '/admin/calendar']) {
      cleanup()
      const link = renderAt(pathname)
      expect(link.getAttribute('href'), pathname).toBe('/admin')
      expect(link.textContent, pathname).toBe('Back to Today')
    }
  })

  it('offers a link rather than only a retry', () => {
    // reset() re-renders the same failing route. If the failure is in the data
    // the page needs, retrying alone leaves the person stuck on it.
    renderAt('/admin/crm/people')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('link')).toBeTruthy()
  })
})
