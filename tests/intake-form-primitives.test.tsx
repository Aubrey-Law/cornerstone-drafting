// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FormField,
  PhoneInput,
  SelectInput,
  TextInput,
  ToggleSwitch,
} from '@/components/intake/IntakeFormPrimitives'

afterEach(cleanup)

describe('intake form primitives (shadcn migration)', () => {
  it('associates the FormField label with its control', async () => {
    const onChange = vi.fn()
    render(
      <FormField label="First name">
        <TextInput value="" onChange={onChange} />
      </FormField>,
    )

    const input = screen.getByLabelText('First name')
    expect(input.tagName).toBe('INPUT')
    await userEvent.type(input, 'A')
    expect(onChange).toHaveBeenCalledWith('A')
  })

  it('renders TextInput on the shared Input primitive with theme tokens', () => {
    render(<TextInput value="" onChange={() => undefined} placeholder="Name" />)
    const input = screen.getByPlaceholderText('Name')
    expect(input.getAttribute('data-slot')).toBe('input')
    expect(input.className).not.toMatch(/gray-/)
  })

  it('formats phone numbers as the user types', async () => {
    function Controlled() {
      const [value, setValue] = React.useState('')
      return <PhoneInput value={value} onChange={setValue} />
    }
    render(<Controlled />)
    const input = screen.getByPlaceholderText<HTMLInputElement>('(555) 123-4567')
    await userEvent.type(input, '6175550142')
    expect(input.value).toBe('(617) 555-0142')
  })

  it('keeps SelectInput a native select with an accessible label', async () => {
    const onChange = vi.fn()
    render(
      <FormField label="County">
        <SelectInput
          value=""
          onChange={onChange}
          placeholder="Select county"
          options={[{ value: 'suffolk', label: 'Suffolk' }]}
        />
      </FormField>,
    )

    const select = screen.getByLabelText('County')
    expect(select.tagName).toBe('SELECT')
    await userEvent.selectOptions(select, 'suffolk')
    expect(onChange).toHaveBeenCalledWith('suffolk')
  })

  it('exposes ToggleSwitch as a labelled switch that toggles from the label', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch checked={false} onChange={onChange} label="Owns a business" />)

    const control = screen.getByRole('switch', { name: 'Owns a business' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(screen.getByText('Owns a business'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
