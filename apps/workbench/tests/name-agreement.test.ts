import { describe, expect, it } from 'vitest'
import { namesAgree, normaliseName, personPartOf } from '@/lib/identity/names'

describe('personPartOf', () => {
  /** Matter names are `<person> — <what the matter is>`. */
  it('takes the person part before an em dash', () => {
    expect(personPartOf('Can Cheng — Estate Planning')).toBe('Can Cheng')
  })

  it('accepts an en dash, or a hyphen with spaces around it', () => {
    expect(personPartOf('Karen Wong – Estate Planning')).toBe('Karen Wong')
    expect(personPartOf('Sam Ensslin - Trust Review')).toBe('Sam Ensslin')
  })

  /**
   * A bare hyphen belongs to the name, not to the separator.
   *
   * Measured 2026-09-09 across all 98 matter names: 39 separate with an em or
   * en dash, 58 have no separator, **none** uses a hyphen as one — and a real
   * client is filed as "Casey Ngo-Miller". The earlier rule truncated that to
   * "Casey Ngo" and got away with it only because the surname-component rule
   * then matched "ngo" inside "ngo-miller". Two shapes it did not get away
   * with: a hyphenated *given* name, where a matter and sheet with identical
   * names were reported as disagreeing, and a sheet carrying only the later
   * surname component.
   */
  it('keeps a hyphen that is inside the name', () => {
    expect(personPartOf('Casey Ngo-Miller')).toBe('Casey Ngo-Miller')
    expect(personPartOf('Casey Ngo-Miller — Estate Planning')).toBe('Casey Ngo-Miller')
    expect(personPartOf('Mary-Jane Ellsworth — Estate Planning')).toBe('Mary-Jane Ellsworth')
    expect(personPartOf('Alexandra Purdue-Smithe')).toBe('Alexandra Purdue-Smithe')
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
   * A surname component match must not become a substring free-for-all.
   *
   * **Constructed, not measured** — and deliberately marked as such, because
   * every other case in this file is named after the real matter that
   * falsified a simpler rule. Checked 2026-09-09: no matter in the practice
   * has one surname as a non-component substring of the other, so nothing real
   * distinguishes the two rules yet. The rule is still right — a substring
   * match would agree "Ann" with "Annette" — and this is the pair that proves
   * it, because `'annette'.includes('ann')` is true.
   *
   * An earlier draft used `Ann` and `Anderson`, which cannot fail either way:
   * Anderson contains "and", not "ann". A test that passes under the rule and
   * its opposite guards nothing.
   */
  it('does not treat a substring surname as a component', () => {
    expect(namesAgree('Mary Ann', 'Mary Annette')).toBe(false)
    // And the pair the earlier draft used, which is correct but unrevealing.
    expect(namesAgree('Mary Ann', 'Mary Anderson')).toBe(false)
  })

  it('cannot agree with nothing', () => {
    expect(namesAgree('Can Cheng', null)).toBe(false)
    expect(namesAgree(null, 'Jie Cheng')).toBe(false)
    expect(namesAgree('Cher', 'Cher')).toBe(true)
  })
})

import { nameIssueFor } from '@/lib/identity/matrix'

const sheet = (overrides: Partial<{ clientName: string | null; spouseName: string | null }> = {}) => ({
  clientName: 'Jie Cheng',
  spouseName: null,
  ...overrides,
})

describe('nameIssueFor', () => {
  it('is null when the matter name agrees with the client', () => {
    expect(nameIssueFor({ id: 'm1', name: 'Jie Cheng — Estate Planning' }, sheet())).toBeNull()
  })

  /** Measured: a couples matter named for the spouse. `Siobhan Creedon` is the
   *  `spouse_name` on a sheet whose client is `Kevin McGurgan`. */
  it('is null when the matter name agrees with the spouse', () => {
    expect(
      nameIssueFor(
        { id: 'm1', name: 'Siobhan Creedon — Estate Planning' },
        sheet({ clientName: 'Kevin McGurgan', spouseName: 'Siobhan Creedon' }),
      ),
    ).toBeNull()
  })

  /** The measured discrepancy: filed as Can Cheng, drafts for Jie Cheng. */
  it('reports the disagreement, carrying both names', () => {
    const issue = nameIssueFor({ id: 'm1', name: 'Can Cheng — Estate Planning' }, sheet())
    expect(issue).toEqual({
      matterId: 'm1',
      kind: 'name_disagreement',
      matterPerson: 'Can Cheng',
      sheetClientName: 'Jie Cheng',
      sheetSpouseName: null,
    })
  })

  /**
   * Nothing to compare is not a disagreement. A matter with no usable name, or
   * a sheet with no client name, says nothing either way — and reporting it
   * would put a task on every half-filled sheet in the practice.
   */
  it('is null when either side has nothing to compare', () => {
    expect(nameIssueFor({ id: 'm1', name: null }, sheet())).toBeNull()
    expect(nameIssueFor({ id: 'm1', name: 'Can Cheng' }, sheet({ clientName: null }))).toBeNull()
    expect(nameIssueFor({ id: 'm1', name: 'Can Cheng' }, sheet({ clientName: '   ' }))).toBeNull()
  })

  /**
   * A hyphen inside the person's own name defeats `personPartOf`, which splits
   * on plain hyphens because a hyphen is one of the matter-name separators.
   * Checked here rather than assumed: Task 1 flagged the risk as probably
   * harmless, and it is harmless only while the sheet keeps the whole
   * hyphenated surname — `Alexandra Purdue-Smithe` truncates to `Alexandra
   * Purdue`, which still agrees by the surname-component rule.
   *
   * In two other shapes it is a false positive. Both are pinned below as the
   * behaviour that exists, not the behaviour that is wanted, and both belong
   * to `personPartOf` in names.ts — another task's already-reviewed file — so
   * this records them for whoever fixes it, and inverts when they do.
   *
   *   1. A hyphenated given name: `Mary-Jane Ellsworth` truncates to `Mary`,
   *      whose first token no longer matches `mary-jane`, so a matter and a
   *      sheet whose names are character-identical are reported as disagreeing.
   *   2. A hyphenated surname where the sheet carries only the later
   *      component: `Alexandra Purdue-Smithe` and `Alexandra Smithe` agree by
   *      the component rule, but the truncated `Alexandra Purdue` does not.
   */
  /**
   * A hyphen inside a person's own name, which the first draft of
   * `personPartOf` truncated.
   *
   * This test was written by Task 2's implementer to *pin the defect* — it
   * asserted the wrong behaviour on purpose, with a note that it would invert
   * when someone fixed `personPartOf`. It has inverted. Kept as the assertion
   * of the right behaviour because the three shapes are worth naming:
   *
   *   1. `Mary-Jane Ellsworth` on both sides was reported as a disagreement,
   *      because the matter name truncated to `Mary`. Identical names, a
   *      blocker-adjacent task, nothing wrong with the file.
   *   2. `Alexandra Purdue-Smithe` vs `Alexandra Smithe` was reported, though
   *      the surname-component rule accepts it un-truncated.
   *   3. `Casey Ngo-Miller` — a real client — truncated to `Casey Ngo` and
   *      agreed anyway, but only because the component rule matched `ngo`
   *      inside `ngo-miller`. One rule was quietly holding up another.
   */
  it('does not mis-report a hyphen inside the person’s own name', () => {
    expect(
      nameIssueFor(
        { id: 'm1', name: 'Alexandra Purdue-Smithe — Estate Planning' },
        sheet({ clientName: 'Alexandra Purdue-Smithe' }),
      ),
    ).toBeNull()

    // Identical names on both sides: never a disagreement.
    expect(
      nameIssueFor(
        { id: 'm1', name: 'Mary-Jane Ellsworth — Estate Planning' },
        sheet({ clientName: 'Mary-Jane Ellsworth' }),
      ),
    ).toBeNull()

    // The component rule now gets the whole surname to work with.
    expect(
      nameIssueFor(
        { id: 'm1', name: 'Alexandra Purdue-Smithe — Estate Planning' },
        sheet({ clientName: 'Alexandra Smithe' }),
      ),
    ).toBeNull()

    // The real client, agreeing on its own merits rather than by truncation.
    expect(
      nameIssueFor({ id: 'm1', name: 'Casey Ngo-Miller' }, sheet({ clientName: 'Casey Ngo-Miller' })),
    ).toBeNull()

    // And a genuine disagreement is still reported, hyphens or not.
    expect(
      nameIssueFor(
        { id: 'm1', name: 'Mary-Jane Ellsworth — Estate Planning' },
        sheet({ clientName: 'Sarah Ellsworth' }),
      ),
    ).toMatchObject({ kind: 'name_disagreement', matterPerson: 'Mary-Jane Ellsworth' })
  })
})
