// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CallPhoneLink } from '@/components/phone/CallPhoneLink'

afterEach(cleanup)

it('passes wrapper props through to the link, so a menu item stays a menu item', () => {
  // DropdownMenuItem asChild hands its role, tabIndex and handlers to the child.
  render(<CallPhoneLink phone="+16175550177" label="Call client" role="menuitem" tabIndex={-1} data-state="x" icon={<span data-testid="icon" />} />)
  const link = screen.getByRole('menuitem', { name: 'Call client' })
  expect(link.getAttribute('href')).toBe('tel:+16175550177')
  expect(link.getAttribute('tabindex')).toBe('-1')
  expect(link.getAttribute('data-state')).toBe('x')
  expect(screen.getByTestId('icon')).toBeTruthy()
})
