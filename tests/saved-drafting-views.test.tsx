// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SavedDraftingViews } from '@/app/admin/drafting/SavedDraftingViews'
import { DEFAULT_HUB_VIEW } from '@/lib/drafting/hubView'
const prefs = vi.hoisted(() => ({ loadPreferences: vi.fn(), savePreferences: vi.fn() }))
vi.mock('@/lib/userPreferencesClient', () => ({ useUserPreferences: () => prefs }))
beforeEach(() => {
  prefs.loadPreferences.mockResolvedValue({ drafting: { hubViews: [{ ...DEFAULT_HUB_VIEW, name: 'My review', action: 'review' }] } })
  prefs.savePreferences.mockImplementation(async p => p)
})
afterEach(cleanup)
it('loads named account views and saves the current filters', async () => {
  const user = userEvent.setup()
  const change = vi.fn()
  render(<SavedDraftingViews view={{ ...DEFAULT_HUB_VIEW, search: 'Doe', practice: 'EP' }} onChange={change} />)
  await screen.findByRole('option', { name: 'My review' })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Saved drafting views' }), '0')
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: 'review', name: 'My review' }))
  await user.click(screen.getByRole('button', { name: 'Save view' }))
  await user.type(screen.getByLabelText('View name'), 'Doe matters')
  await user.click(screen.getAllByRole('button', { name: 'Save view' }).at(-1)!)
  await waitFor(() => expect(prefs.savePreferences).toHaveBeenCalledWith({ drafting: { hubViews: [expect.objectContaining({ name: 'My review' }), expect.objectContaining({ name: 'Doe matters', search: 'Doe', practice: 'EP' })] } }))
})
it('keeps the dialog and typed name when saving fails', async () => {
  prefs.savePreferences.mockResolvedValue(null)
  const user = userEvent.setup()
  render(<SavedDraftingViews view={DEFAULT_HUB_VIEW} onChange={vi.fn()} />)
  await screen.findByRole('option', { name: 'My review' })
  await user.click(screen.getByRole('button', { name: 'Save view' }))
  await user.type(screen.getByLabelText('View name'), 'Keep me')
  await user.click(screen.getAllByRole('button', { name: 'Save view' }).at(-1)!)
  expect((screen.getByLabelText('View name') as HTMLInputElement).value).toBe('Keep me')
})
