import { describe, expect, it } from 'vitest'
import { namesAgree, normaliseName, personPartOf } from '@/lib/identity/names'

describe('personPartOf', () => {
  /** Matter names are `<person> — <what the matter is>`. */
  it('takes the person part before an em dash', () => {
    expect(personPartOf('Can Cheng — Estate Planning')).toBe('Can Cheng')
  })

  it('accepts an en dash or a hyphen as the separator', () => {
    expect(personPartOf('Karen Wong – Estate Planning')).toBe('Karen Wong')
    expect(personPartOf('Sam Ensslin - Trust Review')).toBe('Sam Ensslin')
  })

  /** Most matter names carry no separator at all. */
  it('returns the whole name when there is no separator', () => {
    expect(personPartOf('Leslie Lewis')).toBe('Leslie Lewis')
  })

  it('is null for nothing usable', () => {
    expect(personPartOf(null)).toBeNull()
    expect(personPartOf('   ')).toBeNull()
    expect(personPartOf('— Estate Planning')).toBeNull()
  })
})

describe('normaliseName', () => {
  it('lowercases and drops punctuation, keeping hyphens in surnames', () => {
    expect(normaliseName('Richard G. Goss')).toEqual(['richard', 'g', 'goss'])
    expect(normaliseName('Alexandra Purdue-Smithe')).toEqual(['alexandra', 'purdue-smithe'])
  })

  /** Measured: `Frank Lombardi` vs `Frank J. Lombardi Jr.` is one man. */
  it('drops generational and professional suffixes', () => {
    expect(normaliseName('Frank J. Lombardi Jr.')).toEqual(['frank', 'j', 'lombardi'])
    expect(normaliseName('Ada Byron III, Esq.')).toEqual(['ada', 'byron'])
  })

  it('is empty for nothing usable', () => {
    expect(normaliseName(null)).toEqual([])
    expect(normaliseName('Jr.')).toEqual([])
  })
})

describe('namesAgree', () => {
  /** Measured: `Richard G. Goss` is the matter, `Richard Goss` the sheet. */
  it('ignores middle names and initials', () => {
    expect(namesAgree('Richard G. Goss', 'Richard Goss')).toBe(true)
  })

  /** Measured: `Frank Lombardi` vs `Frank J. Lombardi Jr.` */
  it('ignores a generational suffix', () => {
    expect(namesAgree('Frank Lombardi', 'Frank J. Lombardi Jr.')).toBe(true)
  })

  /** Measured: `Alexandra Purdue` vs `Alexandra Purdue-Smithe`. A hyphenated
   *  surname is the ordinary case, not a discrepancy. */
  it('accepts a surname that is a component of the other', () => {
    expect(namesAgree('Alexandra Purdue', 'Alexandra Purdue-Smithe')).toBe(true)
    expect(namesAgree('Alexandra Purdue-Smithe', 'Alexandra Purdue')).toBe(true)
  })

  /** The measured discrepancy this whole feature exists for. */
  it('does not agree when the given name differs', () => {
    expect(namesAgree('Can Cheng', 'Jie Cheng')).toBe(false)
    expect(namesAgree('Laura Coakley', 'Kayleigh Marie Coakley')).toBe(false)
  })

  it('does not agree when the names are unrelated', () => {
    expect(namesAgree('Veronica Pace', 'Matteo Lorenzo Neretti')).toBe(false)
  })

  /**
   * A surname component match must not become a substring free-for-all. `Ann`
   * and `Anderson` share letters and are different surnames; only a
   * hyphen-delimited component counts.
   */
  it('does not treat an unrelated surname as a component', () => {
    expect(namesAgree('Mary Ann', 'Mary Anderson')).toBe(false)
  })

  it('cannot agree with nothing', () => {
    expect(namesAgree('Can Cheng', null)).toBe(false)
    expect(namesAgree(null, 'Jie Cheng')).toBe(false)
    expect(namesAgree('Cher', 'Cher')).toBe(true)
  })
})
