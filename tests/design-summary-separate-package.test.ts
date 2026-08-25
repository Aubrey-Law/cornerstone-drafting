import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { generateNodeEstatePackage } from '@/lib/estateGenerator/node/generate'
import { loadNodeEstatePackage } from '@/lib/estateGenerator/node/config'
import { isNodeEstatePackageSupported } from '@/lib/estateGenerator/node/support'
import type { NodeEstateData } from '@/lib/estateGenerator/node/types'

const root = path.join(process.cwd(), 'tools/aubreylaw-docgeneration')

function loadExample(): NodeEstateData {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'examples/client-ma-design-summary-separate.json'), 'utf8'),
  ) as NodeEstateData
}

// `<w:t[^>]*>` would also match `<w:tabs>`, and this worksheet's paragraphs
// carry tab stops — so require the tag to end or be followed by an attribute.
function visibleText(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
}

async function render(data: NodeEstateData) {
  const result = await generateNodeEstatePackage({
    data,
    packageName: 'design-summary-separate',
    state: 'MA',
    root,
    allowDraft: true,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('design-summary-separate package', () => {
  it('is a recognized, loadable Node package that swaps in the interview worksheet', () => {
    expect(isNodeEstatePackageSupported('design-summary-separate')).toBe(true)
    const config = loadNodeEstatePackage('design-summary-separate', root)
    expect(config.documents.map(d => d.template)).toEqual([
      'templates/design-summary-detailed.docx',
      'templates/design-summary-worksheet-separate.docx',
    ])
    for (const document of config.documents) {
      expect(fs.existsSync(path.join(root, document.template))).toBe(true)
    }
  })

  it('renders both documents cleanly for a reciprocal-trust couple', async () => {
    const result = await render(loadExample())

    expect(result.files.map(f => f.name)).toEqual([
      '01-estate-plan-design-summary.docx',
      '02-estate-plan-interview-worksheet.docx',
    ])
    expect(result.missing).toEqual([])
    for (const file of result.files) {
      expect(visibleText(file.buffer)).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
    }
  })

  it('gives each settlor their own trust, trustees, agents and will section', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    expect(text).toContain('TRUST FOR SETTLOR 1')
    expect(text).toContain('TRUST FOR SETTLOR 2')
    expect(text).toContain('The Jordan Coupleton Revocable Trust')
    expect(text).toContain('The Riley Coupleton Revocable Trust')
    expect(text).toContain('POWER OF ATTORNEY (SETTLOR 2)')
    expect(text).toContain('HEALTH CARE PROXY (SETTLOR 2)')
    expect(text).toContain('WILL &amp; EXECUTORS (SETTLOR 2)')
    // The spouse's own trustee set, not the joint one.
    expect(text).toContain('Successor Trustees for Settlor 2')
  })

  it('ticks the boxes the design sheet answered and leaves the rest blank', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    // Answered: trust, DPOA and HIPAA are in; the plan has assets.
    expect(text).toContain('☒ Yes')
    expect(text).toMatch(/Trust:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Certification of Trust:[\s\S]{0,40}☒ Yes/)
    // Unanswered questions stay an empty pair for the interview.
    expect(text).toMatch(/Table of Contents:[\s\S]{0,40}☐ Yes {3}☐ No/)
    // A design-sheet "no" ticks No rather than leaving both blank.
    expect(text).toMatch(/Require mandatory arbitration for trust disputes:[\s\S]{0,40}☐ Yes {3}☒ No/)
  })

  it('ticks the answers the design sheet already collected but never sent to templates', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    // Citizenship, domicile and the client-facing extras all live on the design
    // sheet; before Phase 0 they stopped at the payload and printed blank.
    expect(text).toMatch(/Citizenship:[\s\S]{0,40}☒ U.S. Citizen/)
    expect(text).toContain('MA')
    expect(text).toMatch(/Estate Plan Signing Guide:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Successor Trustee Checklist:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Fiduciary Role Guide:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Asset Spreadsheet:[\s\S]{0,40}☒ Yes/)
    // Flowchart is off in the example — a stored "no" ticks No, not blank.
    expect(text).toMatch(/Flowchart:[\s\S]{0,40}☐ Yes {3}☒ No/)
    // Will title and signing type now come from their own stored answers.
    expect(text).toMatch(/☒ Pour-Over Will of/)
    expect(text).toMatch(/☒ Attorney supervised/)
    // Asset ownership replaced a hardcoded null.
    expect(text).toContain('Joint (tenants by the entirety)')
    expect(text).toContain('The Jordan Coupleton Revocable Trust')
    // Beneficiaries beyond the family reach a template for the first time.
    expect(text).toContain('Needham Historical Society')
  })

  it('ticks the trust provisions Phase 1 added', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    expect(text).toMatch(/Limit trustee's duty to account:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Require bond for trustee:[\s\S]{0,40}☐ Yes {3}☒ No/)
    expect(text).toMatch(/Allow a sole acting trustee to appoint co-trustees:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Include definition of incapacity:[\s\S]{0,40}☒ Yes/)
    // Exactly one option ticks in each incapacity list.
    expect(text).toContain('☒ Two licensed physicians')
    expect(text).toContain('☒ Single licensed physician')
    expect(text).toContain('☒ Assets in table format')
    // Spousal funding already answered "distribution to spouse"; no new field.
    expect(text).toContain('☒ Distribute in trust')
  })

  it('keeps each settlor\u2019s health care wishes and post-death choices separate', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)
    const settlor1 = text.slice(text.indexOf('HEALTH CARE PROXY (SETTLOR 1)'), text.indexOf('HEALTH CARE PROXY (SETTLOR 2)'))
    const settlor2 = text.slice(text.indexOf('HEALTH CARE PROXY (SETTLOR 2)'), text.indexOf('HEALTHCARE FORMS'))

    // The example gives the two settlors deliberately different answers, so a
    // block wired to the wrong party would show up as both halves matching.
    expect(settlor1).toMatch(/Wish to die at home:[\s\S]{0,40}☒ Yes/)
    expect(settlor2).toMatch(/Wish to die at home:[\s\S]{0,40}☐ Yes {3}☒ No/)
    expect(settlor1).toContain('☒ First-named agent has final authority')
    expect(settlor2).toContain('☒ Majority rules')
    expect(settlor1).toContain('Please play music I know.')
    expect(settlor2).toContain('Defer to my spouse.')

    // Post-death choices, likewise per settlor.
    expect(text).toContain('☒ Cremation')
    expect(text).toContain('☒ Burial')
    expect(text).toContain('Ashes scattered at Crane Beach.')
    expect(text).toContain('Buried beside my parents.')
  })

  it('gives both settlors the couple\u2019s one power-of-attorney policy', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    expect(text).toMatch(/Include Notice Page:[\s\S]{0,40}☒ Yes/)
    expect(text).toMatch(/Incapacity determination provision:[\s\S]{0,50}☒ Default/)
    expect(text).toContain('☒ Include Acceptance of Appointment')
    // Deliberately shared, not per-settlor: both POA sections read the same
    // answer, so the couple gets one policy rather than two that can drift.
    expect(text.match(/☒ Immediate/g)).toHaveLength(2)
    expect(text.match(/☒ Continue until revoked or terminated/g)).toHaveLength(2)
  })

  it('fills in the signing section Phase 4 added', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    // Acknowledgment method: one box per document, and the unpicked ones stay empty.
    expect(text).toMatch(/Acknowledgment of Trust[\s\S]{0,80}☒ Both/)
    expect(text).toMatch(/Acknowledgment of Power of Attorney:[\s\S]{0,20}☒ Notary/)
    expect(text).toMatch(/Acknowledgment of Advance Health Care Directive:[\s\S]{0,40}☒ Two witnesses/)
    expect(text).toMatch(/Final Disposition Execution:[\s\S]{0,60}☒ Two witnesses and notary/)

    // A false answer prints as a ticked "No", not as two blank boxes — the
    // distinction between "decided against" and "not asked yet".
    expect(text).toMatch(/Combine settlor and trustee signatures:[\s\S]{0,20}☒ Yes/)
    expect(text).toContain('☒ No, the healthcare directive will not be signed in a nursing home')

    // Meeting details and witnesses print on their ruled lines.
    expect(text).toContain('Signing City: Newton')
    expect(text).toContain('Full Name of Notary: Alexandra P. Reyes')
    expect(text).toMatch(/Include Witness Phones:[\s\S]{0,20}☒ Yes/)
    expect(text).toContain('First Witness Phone Number: (617) 555-0142')
    expect(text).toContain('Second Witness Address: 44 Beacon Street, Boston, MA 02108')
  })

  it('records the settlor facts and document choices Phase 5 added', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    // Settlor facts.
    expect(text).toContain('Street Address Line 2: Unit 4B')
    expect(text).toMatch(/Marital Status[\s\S]{0,20}☒ Married/)
    expect(text).toMatch(/Gender:[\s\S]{0,60}☒ Nonbinary/)
    expect(text).toContain('Place of Marriage or Registration: Boston, Massachusetts')
    expect(text).toMatch(/Survivor Designation:[\s\S]{0,40}☒ Settlor 2/)
    expect(text).toMatch(/Do Settlor 1 and Settlor 2 live together\?:[\s\S]{0,20}☒ Yes/)

    // Document inclusions and titles, including the record-only ones.
    expect(text).toMatch(/Dementia Directive:[\s\S]{0,20}☒ Yes/)
    expect(text).toMatch(/Visitation Authorization:[\s\S]{0,20}☐ Yes {3}☒ No/)
    expect(text).toMatch(/Form of Power of Attorney[\s\S]{0,80}☒ Long-Form/)
    expect(text).toMatch(/Healthcare Directive Title[\s\S]{0,60}☒ State Default/)
    expect(text).toContain('☒ General Assignment')
  })

  it('does not tick a document title for a document the plan does not include', async () => {
    // The title fields default to what the firm drafts rather than to null, so
    // without a gate a plan with no power of attorney would still print a
    // ticked "Long-Form Power of Attorney".
    const data = loadExample() as unknown as Record<string, any>
    data.planning.include_dpoa = false
    data.planning.include_hcp = false
    data.planning.include_ahd = false
    const text = visibleText((await render(data as never)).files[1].buffer)

    expect(text).toMatch(/Form of Power of Attorney[\s\S]{0,80}☐ Long-Form/)
    expect(text).not.toContain('☒ Long-Form Power of Attorney')
    expect(text).not.toContain('☒ Durable Power of Attorney')
    expect(text).not.toContain('☒ State Default (Health Care Proxy)')
  })

  it('leaves a settlor fact nobody has answered as two blank boxes', async () => {
    // The distinction Phase 5 is built around: `false` is a recorded "no" and
    // ticks the No box; absent is "not asked" and must tick neither. A plain
    // truthiness test would print an unasked question as a decided No.
    const answered = loadExample() as unknown as Record<string, any>
    expect(visibleText((await render(answered as never)).files[1].buffer))
      .toMatch(/Disabled Veteran\?:[\s\S]{0,20}☐ Yes {3}☒ No/)

    const unasked = loadExample() as unknown as Record<string, any>
    delete unasked.client.disabled_veteran
    delete unasked.marriage.settlors_live_together
    const text = visibleText((await render(unasked as never)).files[1].buffer)

    expect(text).toMatch(/Disabled Veteran\?:[\s\S]{0,20}☐ Yes {3}☐ No/)
    expect(text).toMatch(/Do Settlor 1 and Settlor 2 live together\?:[\s\S]{0,20}☐ Yes {3}☐ No/)
    expect(text).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
  })

  it('closes the last three unbound worksheet questions', async () => {
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    expect(text).toMatch(/How should parent-child relationships be defined\?[\s\S]{0,60}☒ Custom Definition/)

    // Both are per settlor, and the example answers them opposite ways round —
    // so a block wired to the wrong party fails here rather than looking right.
    const sameAsTrustees = text.match(/Make executors the same as the trustees:[\s\S]{0,24}?(☒ Yes|☒ No)/g)
    expect(sameAsTrustees).toEqual([
      expect.stringContaining('☒ Yes'),
      expect.stringContaining('☒ No'),
    ])
    const powerOfAppointment = text.match(/Exercise a testamentary power of appointment:[\s\S]{0,24}?(☒ Yes|☒ No)/g)
    expect(powerOfAppointment).toEqual([
      expect.stringContaining('☒ No'),
      expect.stringContaining('☒ Yes'),
    ])
  })

  it('binds the two options whose unions had no matching value', async () => {
    // Advance directive: the example gives one settlor a standard direction and
    // the other the custom one, so this proves both the new value and that the
    // per-party split still holds.
    const [, worksheet] = (await render(loadExample())).files
    const text = visibleText(worksheet.buffer)

    const directives = text.match(/Medical Treatment for Advanced Illness[\s\S]*?[☒☐] Other \/ Custom Instructions/g)
    expect(directives).toHaveLength(2)
    expect(directives![0]).toContain('☒ Do Not Prolong Life')
    expect(directives![0]).toContain('☐ Other / Custom Instructions')
    expect(directives![1]).toContain('☒ Other / Custom Instructions')
    // The custom text prints only for the settlor who chose it.
    expect(text).toContain('Continue treatment while any reasonable prospect of recovery remains')

    // Spousal funding: the example is a disclaimer plan, so exercise the new
    // value on a variant rather than making the example unrepresentative.
    const skipsSpouse = loadExample() as unknown as Record<string, any>
    skipsSpouse.trust.spousal_funding = 'not_to_spouse'
    const skipText = visibleText((await render(skipsSpouse as never)).files[1].buffer)

    expect(skipText.match(/☒ Do not distribute to spouse\/partner/g)).toHaveLength(2)
    expect(skipText).not.toContain('☒ Distribute outright')
    expect(skipText).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
  })

  it('omits every Settlor 2 block for an unmarried client', async () => {
    const data = loadExample() as unknown as Record<string, unknown>
    delete data.spouse
    const [, worksheet] = (await render(data as unknown as NodeEstateData)).files
    const text = visibleText(worksheet.buffer)

    expect(text).toContain('TRUST FOR SETTLOR 1')
    expect(text).not.toContain('TRUST FOR SETTLOR 2')
    expect(text).not.toContain('POWER OF ATTORNEY (SETTLOR 2)')
    expect(text).not.toContain('HEALTH CARE PROXY (SETTLOR 2)')
    expect(text).not.toContain('Settlor 2 Information')
    expect(text).not.toMatch(/\{\{|\{%|\[\[ MISSING/)
  })
})
