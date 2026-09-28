import { describe, expect, it } from 'vitest'
import { detectDocumentKind, detectKinds } from '@/lib/execution/detect'

/**
 * Detection reads a filename, which is a guess and is treated as one — the
 * screen presents what it found for the attorney to confirm. About a third of
 * the documents in the live table do not classify at all, which is exactly why
 * this is a starting point rather than the source of truth.
 */
describe('detectDocumentKind', () => {
  it.each([
    ['Smith_Last Will and Testament.docx', 'will'],
    ['Jones_Pour-Over Will.docx', 'will'],
    ['Smith_Testamentary Trust Will.docx', 'will'],
    ['Smith_Revocable Trust.docx', 'trust'],
    ['Smith_Durable Power of Attorney.docx', 'dpoa'],
    ['Smith_Health Care Proxy.docx', 'health_care_proxy'],
    ['Smith_HIPAA Authorization.docx', 'hipaa_authorization'],
    ['Smith_Quitclaim Deed.docx', 'deed'],
    ['Smith_Declaration of Homestead.docx', 'homestead_declaration'],
    ['Smith_Certificate of Trust.docx', 'certificate_of_trust'],
    ['Smith_Personal Property Memorandum.docx', 'personal_property_memorandum'],
  ])('reads %s as %s', (name, kind) => {
    expect(detectDocumentKind(name)).toBe(kind)
  })

  /**
   * The orderings that matter. Each of these contains the word that would
   * otherwise win, and each is a different document with different rules.
   */
  it('does not read a certificate of trust as the trust', () => {
    expect(detectDocumentKind('Smith_Certificate of Trust.docx')).toBe('certificate_of_trust')
  })

  it('does not read a pour-over will as a trust because the word appears in it', () => {
    expect(detectDocumentKind('Smith_Pour Over Will to the Smith Trust.docx')).toBe('will')
  })

  it('does not read a living will as a will — it is neither witnessed nor probated like one', () => {
    expect(detectDocumentKind('Smith_Living Will.docx')).toBe('advance_directive')
  })

  it('does not read an assignment of personal property as the memorandum', () => {
    expect(detectDocumentKind('Smith_Assignment of Personal Property.docx')).toBe(
      'assignment_of_personal_property',
    )
  })

  it('ignores case and punctuation', () => {
    expect(detectDocumentKind('SMITH - HEALTH-CARE PROXY (final).PDF')).toBe('health_care_proxy')
  })

  it.each([
    'Smith_Estate Plan Summary.docx',
    'Smith_Funding Instructions.docx',
    'Notes.txt',
    '',
  ])('admits it does not recognise %s', (name) => {
    expect(detectDocumentKind(name)).toBeNull()
  })
})

describe('detectKinds', () => {
  it('collects the kinds it recognised, without repeating one', () => {
    const result = detectKinds([
      'Smith_Last Will.docx',
      'Smith_Pour-Over Will.docx',
      'Smith_Revocable Trust.docx',
    ])
    expect(result.kinds).toEqual(['will', 'trust'])
  })

  it('reports what it could not place, so nothing goes missing quietly', () => {
    const result = detectKinds(['Smith_Last Will.docx', 'Smith_Estate Plan Summary.docx'])
    expect(result.kinds).toEqual(['will'])
    expect(result.unmatched).toEqual(['Smith_Estate Plan Summary.docx'])
  })

  it('has nothing to say about no documents', () => {
    expect(detectKinds([])).toEqual({ kinds: [], unmatched: [] })
  })
})
