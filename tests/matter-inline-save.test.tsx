// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { InlineText, InlineSelect, InlineDate } from '@/app/admin/matters/[id]/facts-panel/InlineField'
afterEach(cleanup)
it('retains a failed edit and retries the same value without retyping', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined)
  function Field() {
    const [value,setValue] = useState('Old value')
    return <InlineText label="Email" value={value} onSave={async next => {await save(next);setValue(next)}} />
  }
  const user = userEvent.setup()
  render(<Field />)
  await user.click(screen.getByRole('button', {name:/Email.*Old value/}))
  await user.clear(screen.getByRole('textbox', {name:'Email'}))
  await user.type(screen.getByRole('textbox', {name:'Email'}), 'new@example.com{Enter}')
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((screen.getByRole('textbox', {name:'Email'}) as HTMLInputElement).value).toBe('new@example.com')
  await user.click(screen.getByRole('button', {name:'Retry Email'}))
  await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull())
  expect(save.mock.calls.map(c=>c[0])).toEqual(['new@example.com','new@example.com'])
})
it('keeps an in-flight edit from saving twice on blur', async () => {
  let finish!: () => void
  const save = vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}))
  const user=userEvent.setup()
  render(<InlineText label="Name" value="Old" onSave={save}/>)
  await user.click(screen.getByRole('button',{name:/Name.*Old/}))
  await user.type(screen.getByRole('textbox'), ' new{Enter}')
  expect(screen.getByRole('status').textContent).toContain('Saving')
  expect(save).toHaveBeenCalledTimes(1)
  finish()
  await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull())
})

it('retains a failed selection until retry succeeds', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined)
  render(<InlineSelect label="Priority" value="normal" options={[{value:'normal',label:'Normal'},{value:'urgent',label:'Urgent'}]} onSave={save} />)
  fireEvent.change(screen.getByRole('combobox'), {target:{value:'urgent'}})
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('urgent')
  await userEvent.click(screen.getByRole('button', {name:'Retry Priority'}))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls.map(call => call[0])).toEqual(['urgent', 'urgent'])
})
it('retains a failed date and avoids saving it again on blur before retry', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined)
  render(<InlineDate label="Signing date" value="2026-09-01" onSave={save} />)
  const input = screen.getByLabelText('Signing date') as HTMLInputElement
  fireEvent.change(input, {target:{value:'2026-10-05'}})
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.blur(input)
  expect(save).toHaveBeenCalledTimes(1)
  expect(input.value).toBe('2026-10-05')
  await userEvent.click(screen.getByRole('button', {name:'Retry Signing date'}))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save.mock.calls.map(call => call[0])).toEqual(['2026-10-05','2026-10-05'])
})
