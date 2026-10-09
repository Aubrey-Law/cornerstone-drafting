/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminIntakeSheet from '@/components/AdminIntakeSheet'
import type { AdminIntakeFormData } from '@/types/adminIntake'

const getAdminIntakeData = vi.fn()
const saveAdminIntakeDraft = vi.fn()
const submitAdminIntake = vi.fn()
const submitSavedPinnedIntake = vi.fn()
const resolveMatterIntake = vi.fn()
const prepareAdminIntake = vi.fn()

vi.mock('@/app/actions/adminIntake', () => ({
  prepareAdminIntake: (...args: unknown[]) => prepareAdminIntake(...args),
  getAdminIntakeData: (...args: unknown[]) => getAdminIntakeData(...args),
  saveAdminIntakeDraft: (...args: unknown[]) => saveAdminIntakeDraft(...args),
  submitSavedPinnedIntake: (...args: unknown[]) => submitSavedPinnedIntake(...args),
  submitAdminIntake: (...args: unknown[]) => submitAdminIntake(...args),
  resolveMatterIntake: (...args: unknown[]) => resolveMatterIntake(...args),
}))

vi.mock('@/components/intake/AdminPinnedIntakeReview', () => ({ default: ({ form, dirty, onEditingChange, onSaved }: { form: { title: string }; dirty: boolean; onEditingChange: (value: boolean) => void; onSaved: () => Promise<void> }) => <section aria-label="Saved pinned questionnaire">{form.title}{dirty && <p>Save your edits to refresh this review before submitting.</p>}
  <button onClick={() => onEditingChange(true)}>Start question edit</button>
  <button onClick={() => void onSaved().then(() => onEditingChange(false))}>Finish question save</button>
</section> }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/admin/AdminIntakeUploadsList', () => ({
  AdminIntakeUploadsList: () => null,
}))

// Pulls in the Google Places script in the real component.
vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: () => null,
}))

async function renderSheet(overrides: Partial<React.ComponentProps<typeof AdminIntakeSheet>> = {}) {
  const result = render(
    <AdminIntakeSheet
      leadId="lead-1"
      matterId={null}
      clientIntakeId={null}
      clientUserId={null}
      practiceArea="Estate Planning"
      clientName="Ada Lovelace"
      open
      onClose={vi.fn()}
      onSubmitted={vi.fn()}
      {...overrides}
    />,
  )
  await waitFor(() => expect(screen.queryByText('Loading intake data…')).toBeNull())
  return result
}

/**
 * The sheet labels its fields with plain <div>s rather than <label for=...>, so
 * there is nothing for getByLabelText to match. Query by the name attribute
 * react-hook-form registers instead.
 */
function field<T extends HTMLElement = HTMLInputElement>(name: string): T {
  const element = document.querySelector<T>(`[name="${name}"]`)
  if (!element) throw new Error(`no field named ${name}`)
  return element
}

/** The AdminIntakeFormData the component handed to a server action. */
function dataFrom(mock: ReturnType<typeof vi.fn>): AdminIntakeFormData {
  return (mock.mock.calls[0][0] as { data: AdminIntakeFormData }).data
}

beforeEach(() => {
  prepareAdminIntake.mockResolvedValue({ id: null })
  submitAdminIntake.mockResolvedValue({ id: 'intake-1' })
  saveAdminIntakeDraft.mockResolvedValue({ id: 'intake-1' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminIntakeSheet submit validation', () => {
  it('blocks submission and names the missing fields', async () => {
    const user = userEvent.setup()
    await renderSheet()

    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    // Name is prefilled from clientName; email, marital status and assets are not.
    await waitFor(() => {
      expect(screen.getByText('At least one asset field is required')).toBeTruthy()
    })
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(2)
    expect(submitAdminIntake).not.toHaveBeenCalled()
  })

  it('submits once the estate-track requirements are answered', async () => {
    const user = userEvent.setup()
    await renderSheet()

    await user.type(field('email'), 'ada@example.com')
    await user.selectOptions(field<HTMLSelectElement>('marital_status'), 'single')
    await user.selectOptions(field<HTMLSelectElement>('estate_value'), '500k_2m')
    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    await waitFor(() => {
      expect(submitAdminIntake).toHaveBeenCalledTimes(1)
    })
    const data = dataFrom(submitAdminIntake)
    expect(data.first_name).toBe('Ada')
    expect(data.last_name).toBe('Lovelace')
    expect(data.email).toBe('ada@example.com')
    expect(data.marital_status).toBe('single')
    expect(data.estate_value).toBe('500k_2m')
  })

  it('never asks the College Prep track for marital status or assets', async () => {
    const user = userEvent.setup()
    await renderSheet({ practiceArea: 'College Preparation Plan' })

    // The assets section is hidden on this track; marital status still shows,
    // but neither one blocks submission.
    expect(document.querySelector('[name="estate_value"]')).toBeNull()
    expect(field<HTMLSelectElement>('marital_status').value).toBe('')

    await user.type(field('email'), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    await waitFor(() => {
      expect(submitAdminIntake).toHaveBeenCalledTimes(1)
    })
  })

  it('sends every field, not just the validated ones', async () => {
    const user = userEvent.setup()
    await renderSheet()

    await user.type(field('email'), 'ada@example.com')
    await user.selectOptions(field<HTMLSelectElement>('marital_status'), 'single')
    await user.selectOptions(field<HTMLSelectElement>('estate_value'), '500k_2m')
    await user.type(field<HTMLTextAreaElement>('special_notes'), 'Referred by a colleague')
    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    await waitFor(() => {
      expect(submitAdminIntake).toHaveBeenCalledTimes(1)
    })
    const data = dataFrom(submitAdminIntake)
    expect(data.special_notes).toBe('Referred by a colleague')
    expect(data.children).toEqual([])
    expect(data.special_circumstances).toEqual([])
    expect(data.citizenship_status).toBe('unknown')
  })
})

describe('AdminIntakeSheet draft saving', () => {
  it('stays disabled until something changes, then saves without validating', async () => {
    const user = userEvent.setup()
    await renderSheet()

    const saveDraft = screen.getByRole('button', { name: 'Save draft' })
    expect(saveDraft.hasAttribute('disabled')).toBe(true)

    await user.type(field('middle_name'), 'Byron')
    await waitFor(() => {
      expect(saveDraft.hasAttribute('disabled')).toBe(false)
    })

    await user.click(saveDraft)

    // A draft is a partial intake by definition — no marital status, no assets.
    await waitFor(() => {
      expect(saveAdminIntakeDraft).toHaveBeenCalledTimes(1)
    })
    expect(dataFrom(saveAdminIntakeDraft).middle_name).toBe('Byron')
    expect(screen.queryByText('At least one asset field is required')).toBeNull()

    // Saving re-baselines, so the sheet is clean again.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save draft' }).hasAttribute('disabled')).toBe(true)
    })
  })
})

describe('AdminIntakeSheet children list', () => {
  async function fillEstateRequirements(user: ReturnType<typeof userEvent.setup>) {
    await user.type(field('email'), 'ada@example.com')
    await user.selectOptions(field<HTMLSelectElement>('marital_status'), 'single')
    await user.selectOptions(field<HTMLSelectElement>('estate_value'), '500k_2m')
  }

  it('collects each added child and submits them in order', async () => {
    const user = userEvent.setup()
    await renderSheet()
    await fillEstateRequirements(user)

    // "Children?" is the first Yes/No segment on the estate track.
    await user.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await user.click(await screen.findByRole('button', { name: '+ Add child' }))
    await user.type(field('children.0.first_name'), 'Byron')
    await user.type(field('children.0.last_name'), 'Lovelace')

    await user.click(screen.getByRole('button', { name: '+ Add child' }))
    await user.type(field('children.1.first_name'), 'Annabella')

    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    await waitFor(() => {
      expect(submitAdminIntake).toHaveBeenCalledTimes(1)
    })
    const { children } = dataFrom(submitAdminIntake)
    expect(children.map(child => child.first_name)).toEqual(['Byron', 'Annabella'])
    expect(children[0].last_name).toBe('Lovelace')
    // Each child keeps the generated id the contact sync writes back against.
    expect(new Set(children.map(child => child.id)).size).toBe(2)
  })

  it('drops the whole list when the answer flips back to No', async () => {
    const user = userEvent.setup()
    await renderSheet()
    await fillEstateRequirements(user)

    await user.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await user.click(await screen.findByRole('button', { name: '+ Add child' }))
    await user.type(field('children.0.first_name'), 'Byron')

    await user.click(screen.getAllByRole('button', { name: 'No' })[0])
    expect(document.querySelector('[name="children.0.first_name"]')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    await waitFor(() => {
      expect(submitAdminIntake).toHaveBeenCalledTimes(1)
    })
    const data = dataFrom(submitAdminIntake)
    expect(data.children).toEqual([])
    expect(data.has_children).toBe(false)
    expect(data.has_minor_children).toBe(false)
  })

  it('removes a single child without disturbing the others', async () => {
    const user = userEvent.setup()
    await renderSheet()
    await fillEstateRequirements(user)

    await user.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await user.click(await screen.findByRole('button', { name: '+ Add child' }))
    await user.type(field('children.0.first_name'), 'Byron')
    await user.click(screen.getByRole('button', { name: '+ Add child' }))
    await user.type(field('children.1.first_name'), 'Annabella')

    await user.click(screen.getByRole('button', { name: 'Remove child 1' }))
    await user.click(screen.getByRole('button', { name: 'Submit intake' }))

    await waitFor(() => {
      expect(submitAdminIntake).toHaveBeenCalledTimes(1)
    })
    expect(dataFrom(submitAdminIntake).children.map(child => child.first_name)).toEqual([
      'Annabella',
    ])
  })
})


describe('AdminIntakeSheet section navigation', () => {
  it('focuses the requested section after intake data finishes loading', async () => {
    getAdminIntakeData.mockResolvedValue({ intake_track: 'estate', first_name: 'Ada' })
    await renderSheet({ clientIntakeId: 'intake-1', initialSection: 'assets' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Assets' })))
  })

  it('explains where unavailable College Prep questions can be answered', async () => {
    getAdminIntakeData.mockResolvedValue({ intake_track: 'college_prep', first_name: 'Ada' })
    await renderSheet({ clientIntakeId: 'intake-1', initialSection: 'school' })
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-intake-section')).toBe('guided')
    })
    expect(document.activeElement?.textContent).toContain('guided questionnaire')
    expect(screen.queryByRole('heading', { name: 'Assets' })).toBeNull()
  })
})


describe('staff pinned questionnaire review', () => {
  const pinned = { id: 'pinned-intake', status: 'draft', form_version_id: 'version-1', intake_track: 'estate', first_name: 'Ada', last_name: 'Lovelace', _pinned_form: { title: 'Pinned family questionnaire' } }
  it('submits saved answers using the pin without passing them through legacy form validation', async () => {
    getAdminIntakeData.mockResolvedValue(pinned)
    submitSavedPinnedIntake.mockResolvedValue({ id: 'pinned-intake' })
    await renderSheet({ clientIntakeId: 'pinned-intake' })
    await screen.findByRole('region', { name: 'Saved pinned questionnaire' })
    await userEvent.click(screen.getByRole('button', { name: 'Submit saved questionnaire' }))
    expect(submitSavedPinnedIntake).toHaveBeenCalledWith({ intakeId: 'pinned-intake', expectedVersionId: 'version-1' })
    expect(submitAdminIntake).not.toHaveBeenCalled()
  })
  it('routes a custom review-section ID to the submit controls', async () => {
    getAdminIntakeData.mockResolvedValue({ ...pinned, _pinned_form: { ...pinned._pinned_form, sections: [{ id: 'custom_finish', items: [{ kind: 'block', blockId: 'review_submit' }] }] } })
    await renderSheet({ clientIntakeId: 'pinned-intake', initialSection: 'custom_finish' })
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Review and submit intake'))
  })
  it('prepares the stored form before accepting answers for a new record', async () => {
    prepareAdminIntake.mockResolvedValue({ id: 'pinned-intake' })
    getAdminIntakeData.mockResolvedValue(pinned)
    await renderSheet()
    expect(prepareAdminIntake).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', clientIntakeId: null }))
    expect(screen.getByRole('region', { name: 'Saved pinned questionnaire' })).toBeTruthy()
    expect(field('first_name').closest('fieldset')?.disabled).toBe(true)
    expect(saveAdminIntakeDraft).not.toHaveBeenCalled()
  })
  it('keeps the legacy shared summary read-only for pinned questionnaires', async () => {
    getAdminIntakeData.mockResolvedValue(pinned)
    saveAdminIntakeDraft.mockResolvedValue({ id: 'pinned-intake' })
    await renderSheet({ clientIntakeId: 'pinned-intake' })
    await screen.findByRole('region', { name: 'Saved pinned questionnaire' })
    expect(field('first_name').closest('fieldset')?.disabled).toBe(true)
    expect(field<HTMLInputElement>('first_name').value).toBe('Ada')
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect(saveAdminIntakeDraft).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Submit saved questionnaire' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('guards shared editing, submission, export and closing until a question save refreshes the sheet', async () => {
    const onClose = vi.fn()
    getAdminIntakeData.mockResolvedValueOnce(pinned).mockResolvedValueOnce({ ...pinned, first_name: 'Refreshed' })
    await renderSheet({ clientIntakeId: 'pinned-intake', onClose })
    await screen.findByRole('region', { name: 'Saved pinned questionnaire' })
    await userEvent.click(screen.getByRole('button', { name: 'Start question edit' }))
    expect(field('first_name').closest('fieldset')?.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Submit saved questionnaire' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Export Word' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Finish question save' }))
    await waitFor(() => expect(field<HTMLInputElement>('first_name').value).toBe('Refreshed'))
    expect(field('first_name').closest('fieldset')?.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Submit saved questionnaire' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('fails closed if the saved question cannot be refreshed', async () => {
    getAdminIntakeData.mockResolvedValueOnce(pinned).mockRejectedValueOnce(new Error('Unavailable'))
    await renderSheet({ clientIntakeId: 'pinned-intake' })
    await screen.findByRole('region', { name: 'Saved pinned questionnaire' })
    await userEvent.click(screen.getByRole('button', { name: 'Start question edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Finish question save' }))
    await screen.findByText('The answer was saved, but the questionnaire could not be refreshed. Close and reopen the intake.')
    expect((screen.getByRole('button', { name: 'Submit saved questionnaire' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Export Word' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('blocks writes after a failed pinned review load', async () => {
    getAdminIntakeData.mockRejectedValue(new Error('Pinned form unavailable'))
    await renderSheet({ clientIntakeId: 'pinned-intake' })
    await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: 'Submit intake' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Export Word' }) as HTMLButtonElement).disabled).toBe(true)
  })
})


it('keeps a pinned estate questionnaire on its stored track after a matter practice-area change', async () => {
  getAdminIntakeData.mockResolvedValue({ id: 'intake-1', status: 'draft', form_version_id: 'version-1', intake_track: 'estate', first_name: 'Ada', _pinned_form: { title: 'Pinned estate questionnaire' } })
  renderSheet({ clientIntakeId: 'intake-1', practiceArea: 'College Preparation Plan' })
  await screen.findByRole('region', { name: 'Saved pinned questionnaire' })
  expect(screen.queryByText('College Preparation Plan intake.')).toBeNull()
  expect(document.querySelector('[name="estate_value"]')).not.toBeNull()
  expect((screen.getByRole('button', { name: 'Export Word' }) as HTMLButtonElement).disabled).toBe(false)
})
