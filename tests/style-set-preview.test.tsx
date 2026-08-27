// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  PREVIEW_BASELINE,
  buildStyleSetPreview,
  sampleMarker,
} from '@/lib/styleSets/preview'
import { PRESERVE_ALL_SETTINGS, parseStyleSetSettings } from '@/lib/styleSets/schema'
import { StyleSetPreview } from '@/app/admin/settings/style-sets/StyleSetPreview'

describe('numbering samples', () => {
  it('renders each format the way it would appear on the page', () => {
    expect(sampleMarker('hierarchicalDecimal', 0)).toBe('1.')
    expect(sampleMarker('hierarchicalDecimal', 1)).toBe('1.1')
    expect(sampleMarker('hierarchicalDecimal', 2)).toBe('1.1.1')
    expect(sampleMarker('lowerLetterParenthetical', 2)).toBe('(a)')
    expect(sampleMarker('lowerRomanParenthetical', 1)).toBe('(i)')
    expect(sampleMarker('upperLetterParenthetical', 0)).toBe('(A)')
    expect(sampleMarker('upperRoman', 0)).toBe('I.')
  })

  it('numbers ancestors in decimal, which is what makes it hierarchical decimal', () => {
    // Only the level's own counter takes the level's format.
    expect(sampleMarker('hierarchicalDecimal', 2)).not.toContain('a')
  })
})

describe('building the preview', () => {
  it('reports a preserved property rather than passing off the stand-in as real', () => {
    // The preview has no template to read, so a preserved field is a guess. It
    // has to be counted, or the page looks most authoritative where it knows least.
    const preview = buildStyleSetPreview(PRESERVE_ALL_SETTINGS)
    expect(preview.isEntirelyPreserved).toBe(true)
    expect(preview.preservedProperties).toContain('Body font')
    expect(preview.preservedProperties).toContain('Left margin')
    expect(preview.body.fontFamily).toBe(PREVIEW_BASELINE.fontFamily)
  })

  it('stops reporting a property once the style set decides it', () => {
    const preview = buildStyleSetPreview(
      parseStyleSetSettings({ body: { fontFamily: 'Garamond', fontSizePt: 12 } }),
    )
    expect(preview.body.fontFamily).toBe('Garamond')
    expect(preview.body.fontSizePt).toBe(12)
    expect(preview.preservedProperties).not.toContain('Body font')
    expect(preview.preservedProperties).not.toContain('Body size')
    expect(preview.isEntirelyPreserved).toBe(false)
  })

  it('lets a title with no font of its own follow the body, as Word would', () => {
    const preview = buildStyleSetPreview(parseStyleSetSettings({ body: { fontFamily: 'Garamond' } }))
    expect(preview.title.fontFamily).toBe('Garamond')
    // And it is not reported as a guess, because it is inherited rather than invented.
    expect(preview.preservedProperties).not.toContain('Title font')
  })

  it('lets a list level inherit the body type rather than implying five fonts', () => {
    const preview = buildStyleSetPreview(
      parseStyleSetSettings({ body: { fontFamily: 'Garamond', fontSizePt: 12 } }),
    )
    for (const level of preview.levels) {
      expect(level.fontFamily).toBe('Garamond')
      expect(level.fontSizePt).toBe(12)
    }
  })

  it('turns paper size and orientation into real page proportions', () => {
    const letter = buildStyleSetPreview(parseStyleSetSettings({ page: { paperSize: 'letter' } }))
    expect(letter.page.widthIn).toBe(8.5)
    expect(letter.page.heightIn).toBe(11)

    const legal = buildStyleSetPreview(parseStyleSetSettings({ page: { paperSize: 'legal' } }))
    expect(legal.page.heightIn).toBe(14)

    const landscape = buildStyleSetPreview(
      parseStyleSetSettings({ page: { paperSize: 'letter', orientation: 'landscape' } }),
    )
    expect(landscape.page.widthIn).toBe(11)
    expect(landscape.page.heightIn).toBe(8.5)
  })

  it('drops the numbers entirely when the style set switches numbering off', () => {
    const preview = buildStyleSetPreview(
      parseStyleSetSettings({
        numbering: { enabled: false },
        level1: { numberingFormat: 'hierarchicalDecimal' },
      }),
    )
    expect(preview.levels.every(level => level.unnumbered)).toBe(true)
    expect(preview.levels.every(level => level.marker === '')).toBe(true)
  })

  it('carries the house style through to the page', () => {
    const preview = buildStyleSetPreview(
      parseStyleSetSettings({
        body: { fontFamily: 'Garamond' },
        title: { fontSizePt: 14 },
        level3: { numberingFormat: 'lowerLetterParenthetical', indentLeftPt: 18, hangingPt: 0 },
      }),
    )
    expect(preview.title.fontSizePt).toBe(14)
    expect(preview.levels[2].marker).toBe('(a)')
    expect(preview.levels[2].indentLeftPt).toBe(18)
    expect(preview.levels[2].hangingPt).toBe(0)
  })
})

describe('StyleSetPreview', () => {
  afterEach(cleanup)

  it('says outright that it is not Word', () => {
    render(<StyleSetPreview settings={PRESERVE_ALL_SETTINGS} />)
    expect(screen.getByText(/not Word/)).toBeTruthy()
  })

  it('warns when the whole page is a stand-in', () => {
    render(<StyleSetPreview settings={PRESERVE_ALL_SETTINGS} />)
    expect(screen.getByText(/changes nothing, so the whole page above is a generic stand-in/)).toBeTruthy()
  })

  it('counts the stand-in properties and lists them on request', () => {
    render(<StyleSetPreview settings={parseStyleSetSettings({ body: { fontFamily: 'Garamond' } })} />)
    const toggle = screen.getByRole('button', { name: /shown as a stand-in/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Left margin')).toBeTruthy()
  })

  it('states the page size it is drawing', () => {
    render(<StyleSetPreview settings={parseStyleSetSettings({ page: { paperSize: 'legal' } })} />)
    expect(screen.getByText('8.5 × 14 in')).toBeTruthy()
  })

  it('applies the settings to the sample text rather than only describing them', () => {
    render(
      <StyleSetPreview
        settings={parseStyleSetSettings({
          body: { fontFamily: 'Garamond', fontSizePt: 12, alignment: 'justify' },
          title: { fontSizePt: 14 },
        })}
      />,
    )
    const title = screen.getByText('Revocable Trust Agreement')
    expect(title.style.fontSize).toBe('14pt')
    expect(title.style.fontFamily).toBe('Garamond')

    const body = screen.getByText(/This Trust Agreement is made this day/)
    expect(body.style.fontSize).toBe('12pt')
    expect(body.style.textAlign).toBe('justify')
  })

  it('shows a hanging indent as a hanging indent', () => {
    render(
      <StyleSetPreview
        settings={parseStyleSetSettings({
          level3: { numberingFormat: 'lowerLetterParenthetical', indentLeftPt: 18, hangingPt: 0 },
        })}
      />,
    )
    const line = screen.getByText(/resigning Trustee shall deliver/).closest('p')!
    expect(line.style.marginLeft).toBe('18pt')
    // Zero hanging puts the marker and its text on one left edge, which is the
    // whole visible point of the house style's lettered level.
    expect(line.style.textIndent).toBe('0pt')
    expect(line.style.paddingLeft).toBe('0pt')
  })

  it('pulls the marker left of its text when there is a hanging indent', () => {
    render(
      <StyleSetPreview
        settings={parseStyleSetSettings({
          level1: { numberingFormat: 'hierarchicalDecimal', indentLeftPt: 36, hangingPt: 18 },
        })}
      />,
    )
    const line = screen.getByText(/Trusteeship\./).closest('p')!
    expect(line.style.marginLeft).toBe('36pt')
    expect(line.style.textIndent).toBe('-18pt')
    // The padding is what keeps the wrapped lines aligned under the text.
    expect(line.style.paddingLeft).toBe('18pt')
  })
})
