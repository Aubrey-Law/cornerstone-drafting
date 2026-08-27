import { describe, expect, it } from 'vitest'
import {
  PRESERVE,
  PRESERVE_ALL_SETTINGS,
  isNoOpStyleSet,
  isOverride,
  parseStyleSetSettings,
} from '@/lib/styleSets/schema'
import {
  AUBREY_HOUSE_STYLE_SET,
  DEFAULT_STYLE_SET,
  LEGACY_GARAMOND_STYLE_SET,
} from '@/lib/styleSets/defaults'

describe('style set settings', () => {
  it('treats an absent field as preserve rather than as a default value', () => {
    const settings = parseStyleSetSettings({ body: { fontFamily: 'Garamond' } })
    expect(settings.body.fontFamily).toBe('Garamond')
    expect(settings.body.fontSizePt).toBe(PRESERVE)
    expect(settings.page.margins.leftPt).toBe(PRESERVE)
    expect(settings.level3.hangingPt).toBe(PRESERVE)
  })

  it('accepts an empty object, so a document generated before a field existed still renders', () => {
    // Stored settings are jsonb and will gain keys over time. An older blob must
    // parse, not fail validation on a key that did not exist when it was saved.
    expect(() => parseStyleSetSettings({})).not.toThrow()
    expect(parseStyleSetSettings({})).toEqual(PRESERVE_ALL_SETTINGS)
    expect(parseStyleSetSettings(undefined)).toEqual(PRESERVE_ALL_SETTINGS)
  })

  it('rejects a field that is present but nonsensical', () => {
    // A negative font size is a bug worth surfacing, not a value worth guessing at.
    expect(() => parseStyleSetSettings({ body: { fontSizePt: -4 } })).toThrow()
    expect(() => parseStyleSetSettings({ body: { alignment: 'sideways' } as never })).toThrow()
    expect(() => parseStyleSetSettings({ page: { paperSize: 'a3' } as never })).toThrow()
  })

  it('keeps preserve available on every field, including enums', () => {
    const settings = parseStyleSetSettings({
      body: { alignment: PRESERVE },
      page: { paperSize: PRESERVE, orientation: PRESERVE },
      level1: { numberingFormat: PRESERVE },
    })
    expect(isOverride(settings.body.alignment)).toBe(false)
    expect(isOverride(settings.level1.numberingFormat)).toBe(false)
  })

  it('survives a round trip through JSON, which is how it is stored', () => {
    const original = parseStyleSetSettings({
      body: { fontFamily: 'Garamond', fontSizePt: 12, lineSpacing: 1.5 },
      title: { fontSizePt: 14, bold: true },
      level3: { indentLeftPt: 18, hangingPt: 0 },
      page: { paperSize: 'letter', margins: { leftPt: 72 } },
    })
    expect(parseStyleSetSettings(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('recognises a style set that cannot change anything', () => {
    expect(isNoOpStyleSet(PRESERVE_ALL_SETTINGS)).toBe(true)
    expect(isNoOpStyleSet(LEGACY_GARAMOND_STYLE_SET)).toBe(false)
  })
})

describe('built-in style sets', () => {
  it('defaults to the legacy sweep, so enabling style sets changes no document', () => {
    expect(DEFAULT_STYLE_SET).toBe(LEGACY_GARAMOND_STYLE_SET)
  })

  it('overrides nothing but the font in the legacy set', () => {
    // This is the whole safety argument: everything else is preserve, so the
    // engine's default is equivalent to the old normalizeFontsToGaramond().
    const { body, ...rest } = LEGACY_GARAMOND_STYLE_SET
    expect(body.fontFamily).toBe('Garamond')
    expect({ ...body, fontFamily: PRESERVE }).toEqual(PRESERVE_ALL_SETTINGS.body)
    expect(rest).toEqual({
      title: PRESERVE_ALL_SETTINGS.title,
      level1: PRESERVE_ALL_SETTINGS.level1,
      level2: PRESERVE_ALL_SETTINGS.level2,
      level3: PRESERVE_ALL_SETTINGS.level3,
      numbering: PRESERVE_ALL_SETTINGS.numbering,
      page: PRESERVE_ALL_SETTINGS.page,
    })
  })

  it('encodes the house style the manual passes describe', () => {
    expect(AUBREY_HOUSE_STYLE_SET.body.fontFamily).toBe('Garamond')
    expect(AUBREY_HOUSE_STYLE_SET.title.fontSizePt).toBe(14)
    // 18pt = 0.25", and a zero hanging indent is what puts "(a)" and its text
    // on the same left edge.
    expect(AUBREY_HOUSE_STYLE_SET.level3.indentLeftPt).toBe(18)
    expect(AUBREY_HOUSE_STYLE_SET.level3.hangingPt).toBe(0)
  })

  it('leaves page setup alone in both built-ins', () => {
    // Neither manual pass changes paper or margins, so neither style set should.
    for (const set of [LEGACY_GARAMOND_STYLE_SET, AUBREY_HOUSE_STYLE_SET]) {
      expect(set.page).toEqual(PRESERVE_ALL_SETTINGS.page)
    }
  })
})
