// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  STYLE_SET_FIELD_GROUPS,
  countOverrides,
  describeStyleSet,
  readField,
  writeField,
} from '@/lib/styleSets/editorFields'
import { PRESERVE, PRESERVE_ALL_SETTINGS, parseStyleSetSettings } from '@/lib/styleSets/schema'
import { StyleSetsClient, type StyleSetSummary } from '@/app/admin/settings/style-sets/StyleSetsClient'

describe('editor field descriptors', () => {
  it('binds every field to a path that exists in the schema', () => {
    // The form is generated from these paths, so a typo would silently render a
    // control that edits nothing. Checking them is what makes the table safe.
    for (const group of STYLE_SET_FIELD_GROUPS) {
      for (const field of group.fields) {
        expect(
          readField(PRESERVE_ALL_SETTINGS, field.path),
          `${field.path} is not a real settings path`,
        ).toBe(PRESERVE)
      }
    }
  })

  it('covers every leaf the schema has, so nothing is uneditable', () => {
    const described = new Set(STYLE_SET_FIELD_GROUPS.flatMap(g => g.fields).map(f => f.path))
    const leaves: string[] = []
    const walk = (value: unknown, path: string) => {
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
      } else {
        leaves.push(path)
      }
    }
    walk(PRESERVE_ALL_SETTINGS, '')
    expect([...leaves].sort()).toEqual([...described].sort())
  })

  it('writes a nested path without mutating the original', () => {
    const before = PRESERVE_ALL_SETTINGS
    const after = writeField(before, 'page.margins.leftPt', 72)
    expect(readField(after, 'page.margins.leftPt')).toBe(72)
    // The previous value has to survive intact so cancelling restores it.
    expect(readField(before, 'page.margins.leftPt')).toBe(PRESERVE)
  })

  it('counts only the fields that state a value', () => {
    expect(countOverrides(PRESERVE_ALL_SETTINGS)).toBe(0)
    const two = parseStyleSetSettings({ body: { fontFamily: 'Garamond' }, title: { fontSizePt: 14 } })
    expect(countOverrides(two)).toBe(2)
  })

  it('summarises a style set by what it actually changes', () => {
    expect(describeStyleSet(PRESERVE_ALL_SETTINGS)).toBeNull()
    const summary = describeStyleSet(
      parseStyleSetSettings({
        body: { fontFamily: 'Garamond', fontSizePt: 12 },
        title: { fontSizePt: 14 },
        page: { margins: { leftPt: 72 } },
      }),
    )
    expect(summary).toContain('Garamond')
    expect(summary).toContain('12pt')
    expect(summary).toContain('1 more setting')
  })
})

function styleSet(overrides: Partial<StyleSetSummary> = {}): StyleSetSummary {
  return {
    id: 'ss-1',
    name: 'House style',
    description: null,
    settings: parseStyleSetSettings({ body: { fontFamily: 'Garamond' } }),
    is_default: true,
    source_file_name: null,
    updated_at: '2026-08-27T00:00:00.000Z',
    ...overrides,
  }
}

describe('StyleSetsClient', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('explains what an empty list means rather than showing a bare page', () => {
    render(<StyleSetsClient initialStyleSets={[]} />)
    expect(screen.getByText(/No style sets yet/)).toBeTruthy()
    expect(screen.getByText(/generated in Garamond/)).toBeTruthy()
  })

  it('marks the firm default and offers to move it', () => {
    render(<StyleSetsClient initialStyleSets={[styleSet(), styleSet({ id: 'ss-2', name: 'Probate', is_default: false })]} />)
    expect(screen.getByText('Firm default')).toBeTruthy()
    // Only the non-default row offers promotion.
    expect(screen.getAllByRole('button', { name: /Make default/ })).toHaveLength(1)
  })

  it('says plainly when a style set would change nothing', () => {
    render(<StyleSetsClient initialStyleSets={[styleSet({ settings: PRESERVE_ALL_SETTINGS, is_default: false })]} />)
    expect(screen.getByText(/Changes nothing/)).toBeTruthy()
  })

  it('groups the repeated labels so each control says which one it is', () => {
    // "Font", "Size" and "Alignment" each appear five times. The fieldset
    // legend is what distinguishes them for anyone not going by position.
    render(<StyleSetsClient initialStyleSets={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /New style set/ }))
    for (const name of ['Body text', 'Titles', 'Third-level list', 'Page']) {
      expect(screen.getByRole('group', { name }), name).toBeTruthy()
    }
  })

  it('offers preserve as the first choice on every control', () => {
    render(<StyleSetsClient initialStyleSets={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /New style set/ }))

    // A firm's templates already carry formatting somebody chose, so "leave it
    // alone" is the default answer and has to be spelled out, not implied.
    const body = within(screen.getByRole('group', { name: 'Body text' }))
    const alignment = body.getByLabelText('Alignment') as HTMLSelectElement
    expect(alignment.options[0].value).toBe(PRESERVE)
    expect(alignment.value).toBe(PRESERVE)
    expect(alignment.options[0].textContent).toMatch(/template’s own/)
  })

  it('treats clearing a field as preserve rather than as an empty value', () => {
    render(<StyleSetsClient initialStyleSets={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /New style set/ }))

    const body = within(screen.getByRole('group', { name: 'Body text' }))
    const font = body.getByLabelText('Font') as HTMLInputElement
    fireEvent.change(font, { target: { value: 'Garamond' } })
    expect(screen.getByText(/1 setting overridden/)).toBeTruthy()

    fireEvent.change(font, { target: { value: '' } })
    expect(screen.getByText(/Nothing is overridden yet/)).toBeTruthy()
  })

  it('will not save a style set with no name', () => {
    render(<StyleSetsClient initialStyleSets={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /New style set/ }))
    expect(screen.getByRole('button', { name: /Create style set/ }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'House style' } })
    expect(screen.getByRole('button', { name: /Create style set/ }).hasAttribute('disabled')).toBe(false)
  })

  it('loads an existing style set into the form when it is opened', () => {
    render(<StyleSetsClient initialStyleSets={[styleSet()]} />)
    fireEvent.click(screen.getByText('House style'))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('House style')
    const body = within(screen.getByRole('group', { name: 'Body text' }))
    expect((body.getByLabelText('Font') as HTMLInputElement).value).toBe('Garamond')
  })

  it('shows what an uploaded template could not say, instead of swallowing it', async () => {
    const notes = ['The document uses 3 fonts (Garamond, Calibri, Arial).']
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: parseStyleSetSettings({ body: { fontFamily: 'Garamond' } }),
        notes,
        sourceFileName: 'trust.docx',
      }),
    } as Response)

    render(<StyleSetsClient initialStyleSets={[]} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'trust.docx')
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText(notes[0])).toBeTruthy()
    // The file name seeds a blank name rather than being discarded.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('trust')
  })

  it('reports a document it could not read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'That file is not a readable .docx' }),
    } as Response)

    render(<StyleSetsClient initialStyleSets={[]} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.docx')] } })

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That file is not a readable .docx',
    )
  })
})
