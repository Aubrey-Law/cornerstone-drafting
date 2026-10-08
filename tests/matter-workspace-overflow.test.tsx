// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { MatterWorkspaceNav } from '@/components/matter/MatterWorkspaceNav'
afterEach(cleanup)
it('keeps all panels directly reachable and labels the selected panel', async () => {
  const select = vi.fn()
  render(<Tabs value="people" onValueChange={select}><MatterWorkspaceNav matterId="m1" active="people" onSelect={select} /><TabsContent value="people">Client contacts</TabsContent></Tabs>)
  expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name: 'People' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  expect(screen.getAllByRole('tab')).toHaveLength(10)
  await userEvent.click(screen.getByRole('tab', { name: 'Activity' }))
  expect(select).toHaveBeenCalledWith('activity')
})
