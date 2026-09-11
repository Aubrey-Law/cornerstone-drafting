// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DesignSheetConflictDialog } from '@/components/design-sheet/DesignSheetConflictDialog'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
afterEach(cleanup)
it('requires explicit choices and can dismiss and reopen without losing choices', () => {
  const local = inflateDesignSheetRow({ id: 's', client_name: 'Local' })!
  const latest = { ...local, client_name: 'Server' }
  const onResolve = vi.fn(async () => true)
  render(<DesignSheetConflictDialog conflict={{ local, latest, base: null }} saving={false} onResolve={onResolve} onReload={async () => {}} />)
  expect(screen.getByRole('dialog', { name: 'Resolve design sheet changes' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Save selected values' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('radio', { name: 'Your changes Local' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review later' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review versions' }))
  expect((screen.getByRole('radio', { name: 'Your changes Local' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save selected values' }))
  expect(onResolve).toHaveBeenCalledWith({ client_name: 'local' })
})
