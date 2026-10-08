// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SchemaDrivenGuidedInterview from '@/components/intake/SchemaDrivenGuidedInterview'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import type { CompiledIntakeSectionsProps } from '@/components/intake/formEngine/CompiledIntakeSections'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'session-1' } } }) } } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/components/intake/LegacyGuidedInterview', () => ({ ReviewModal: ({ onSubmit, submitting }: { onSubmit: () => void; submitting: boolean }) => <button disabled={submitting} onClick={onSubmit}>Submit questionnaire</button> }))
vi.mock('@/components/intake/formEngine/CompiledIntakeSections', () => ({
  CompiledIntakeSections: (props: CompiledIntakeSectionsProps) => <input aria-label="First name" value={String(props.data.first_name ?? '')} onChange={(event) => props.update('first_name', event.target.value)} />,
}))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe('compiled submit with the real autosave hook', () => {
  it.each([false, true])('cannot submit or overwrite the latest answer while an older debounce save is running (teardown: %s)', async (teardown) => {
    vi.useFakeTimers()
    let finishOlder!: () => void
    let finishKeepalive!: () => void
    let persistedName = 'Ada'
    const events: string[] = []
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.status === 'submitted') events.push(`submit:${persistedName}`)
      else {
        if (body.first_name === 'Older') await new Promise<void>((resolve) => { finishOlder = resolve })
        if (init?.keepalive) await new Promise<void>((resolve) => { finishKeepalive = resolve })
        persistedName = body.first_name
        events.push(`save:${persistedName}`)
      }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', request)
    const compiled = compileIntakeForm({ schemaVersion: 1, key: 'estate', title: 'Estate', sections: [
      { id: 'personal', title: 'Personal', audience: 'client_and_staff', items: ['client_first_name', 'client_last_name', 'client_email', 'client_phone'].map((fieldId) => ({ kind: 'field', id: fieldId, fieldId })) },
      { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'review', blockId: 'review_submit' }] },
    ] }, 'client')
    if (!compiled.success) throw new Error(JSON.stringify(compiled.errors))
    render(<SchemaDrivenGuidedInterview intakeId="intake-1" initialData={{ first_name: 'Ada', last_name: 'Example', email: 'ada@example.com', phone: '(617) 555-0100' }} compiledForm={compiled.form} />)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Older' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Latest' } })
    if (teardown) act(() => { window.dispatchEvent(new Event('pagehide')); expect(request).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByRole('button', { name: /Review questionnaire/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit questionnaire' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(request).toHaveBeenCalledTimes(teardown ? 2 : 1)
    expect(events).toEqual([])
    await act(async () => { finishOlder(); await vi.advanceTimersByTimeAsync(0) })
    if (teardown) {
      // A resumed-page submit must also wait for the independent keepalive
      // request, not merely drain the old ordinary request and race it.
      expect(events).toEqual(['save:Older'])
      expect(request).toHaveBeenCalledTimes(2)
      await act(async () => { finishKeepalive(); await vi.advanceTimersByTimeAsync(0) })
    }
    expect(events).toEqual(teardown ? ['save:Older', 'save:Latest', 'save:Latest', 'submit:Latest'] : ['save:Older', 'save:Latest', 'submit:Latest'])
    expect(persistedName).toBe('Latest')
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(request).toHaveBeenCalledTimes(teardown ? 4 : 3)
  })
})
