// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '../app/error'
import NotFound from '../app/not-found'
import Loading from '../app/loading'

describe('workbench route boundaries', () => {
  it('error boundary names the app and offers a retry that calls reset', () => {
    const reset = vi.fn()
    render(<ErrorBoundary error={new Error('boom')} reset={reset} />)
    expect(screen.getByRole('heading').textContent).toMatch(/workbench/i)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('not-found page links back to the start', () => {
    render(<NotFound />)
    expect(screen.getByRole('link', { name: /home|back/i }).getAttribute('href')).toBe('/')
  })

  it('loading state is announced to assistive technology', () => {
    render(<Loading />)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
