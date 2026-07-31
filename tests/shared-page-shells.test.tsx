// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthShell } from '@/components/layout/AuthShell'
import { AdminPageShell } from '@/components/layout/AdminPageShell'

describe('shared page shells', () => {
  it('gives authentication pages one branded dark surface', () => {
    render(
      <AuthShell>
        <h1>Sign in</h1>
      </AuthShell>,
    )

    const main = screen.getByRole('main')
    expect(main.className).toContain('dark')
    expect(screen.getByRole('img', { name: 'Aubrey Law' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('provides the shared full-height admin page container without adding nested padding', () => {
    render(
      <AdminPageShell>
        <h1>Library</h1>
      </AdminPageShell>,
    )

    const shell = screen.getByTestId('admin-page-shell')
    expect(shell.className).toContain('min-h-0')
    expect(shell.className).not.toMatch(/\bp-[468]\b/)
  })
})
