/**
 * Builds tools/aubreylaw-docgeneration/templates/will-cp.docx.
 *
 * Converted from the firm's `will_cp_v1.docx` source form (College Preparation
 * Plan simple will: tangible personal property by memorandum, residue to the
 * student's parents, standard Massachusetts fiduciary powers). The source form
 * already carried canonical merge fields; the conversion replaces its
 * [FATHER'S NAME]/[MOTHER'S NAME] markers with `will_cp.parent1`/`parent2` and
 * adds the single-parent residue branch. Regenerate with:
 *
 *   npx tsx scripts/generate-will-cp-template.ts
 *
 * Control tags (`{% if %}`, `{% else %}`, `{% endif %}`) are authored as their
 * own paragraphs; the renderer's stripControlOnlyParagraphs unwraps them so a
 * skipped branch leaves no blank line.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  Paragraph,
  TextRun,
  type ISpacingProperties,
} from 'docx'
import PizZip from 'pizzip'

const outputPath = path.join(
  process.cwd(),
  'tools/aubreylaw-docgeneration/templates/will-cp.docx',
)
const deterministicCoreDocxTimestamp = '2000-01-01T00:00:00.000Z'
const deterministicZipEntryDate = new Date(2000, 0, 1, 0, 0, 0)

interface ParagraphOptions {
  align?: keyof typeof AlignmentType
  spacing?: ISpacingProperties
  indentLeft?: number
  keepNext?: boolean
}

/** A paragraph built from alternating plain/bold runs. */
function paragraph(
  runs: Array<{ text: string; bold?: boolean; italics?: boolean; size?: number; caps?: boolean }>,
  options: ParagraphOptions = {},
) {
  return new Paragraph({
    alignment: options.align ? AlignmentType[options.align] : AlignmentType.JUSTIFIED,
    spacing: options.spacing ?? { after: 200 },
    indent: options.indentLeft ? { left: options.indentLeft } : undefined,
    keepNext: options.keepNext,
    children: runs.map(run => new TextRun({
      text: run.text,
      bold: run.bold,
      italics: run.italics,
      size: run.size,
      allCaps: run.caps,
    })),
  })
}

function body(text: string, options: ParagraphOptions = {}) {
  return paragraph([{ text }], options)
}

/** A standalone Nunjucks control tag; the renderer unwraps the paragraph. */
function control(tag: string) {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: tag })],
  })
}

/** A top-level article heading, e.g. "Distribution of My Property". */
function article(title: string) {
  return paragraph(
    [{ text: title, bold: true }],
    { align: 'CENTER', spacing: { before: 320, after: 160 }, keepNext: true },
  )
}

/** A section heading inside an article. */
function section(title: string) {
  return paragraph(
    [{ text: title, bold: true }],
    { align: 'LEFT', spacing: { before: 200, after: 80 }, keepNext: true },
  )
}

/** A numbered fiduciary-power item, e.g. "(1) hold, retain, …". */
function numbered(text: string, last = false) {
  return body(text, { indentLeft: 720, spacing: { after: last ? 200 : 80 } })
}

const residueTail =
  'the residue shall pass to my then-living issue, by right of representation, or if I '
  + 'leave no living issue, then in equal shares to my then-living siblings, or if none, '
  + 'to my heirs at law under the laws of the Commonwealth of Massachusetts.'

const doc = new Document({
  creator: 'Aubrey Law',
  lastModifiedBy: 'Aubrey Law',
  revision: 1,
  styles: {
    default: {
      document: { run: { font: 'Garamond', size: 24 } },
    },
  },
  sections: [
    {
      properties: {},
      footers: {
        default: new Footer({
          children: [
            paragraph(
              [{ text: 'LAST WILL AND TESTAMENT OF [CLIENT FULL NAME]', size: 20 }],
              { align: 'CENTER', spacing: { after: 0 } },
            ),
          ],
        }),
      },
      children: [
        // ── Title ──────────────────────────────────────────────────────────
        paragraph(
          [{ text: 'LAST WILL AND TESTAMENT', bold: true, size: 28 }],
          { align: 'CENTER', spacing: { after: 60 } },
        ),
        paragraph(
          [{ text: 'OF', bold: true, size: 28 }],
          { align: 'CENTER', spacing: { after: 60 } },
        ),
        paragraph(
          [{ text: '{{ client.full_name | name }}', bold: true, size: 28 }],
          { align: 'CENTER', spacing: { after: 240 } },
        ),

        body(
          'I, {{ client.full_name | name }}, a resident of {{ client.city }}, '
          + '{{ client.county }}, Massachusetts, revoke any prior Wills and codicils made by '
          + 'me and declare this to be my Last Will and Testament (Will).',
          { spacing: { after: 240 } },
        ),

        // ── Distribution of My Property ────────────────────────────────────
        article('Distribution of My Property'),

        section('Disposition of Remaining Tangible Personal Property'),
        body(
          'I give and bequeath my remaining tangible personal property according to a separate '
          + 'Personal Property Memorandum or other similar writing signed by me and kept with my '
          + 'personal records.  The writing will qualify to distribute my tangible personal '
          + 'property under applicable state law.  If the writing is not found at the time of my '
          + 'death, or is ruled an improper disposition, this bequest will lapse and my Personal '
          + 'Representative shall divide and distribute my tangible personal property as part of '
          + 'the residue of my estate.',
        ),

        section('Distribution of the Residue of My Estate'),
        control('{% if will_cp.parent2.full_name %}'),
        body(
          'I give, devise, and bequeath all of the rest, residue, and remainder of my estate, '
          + 'real, personal, and mixed, of whatever nature and wherever located, to my parents, '
          + '{{ will_cp.parent1.full_name | name }} and {{ will_cp.parent2.full_name | name }}, '
          + 'to be divided equally between them, or to the survivor of them if only one survives '
          + 'me. If neither parent survives me, ' + residueTail,
        ),
        control('{% else %}'),
        body(
          'I give, devise, and bequeath all of the rest, residue, and remainder of my estate, '
          + 'real, personal, and mixed, of whatever nature and wherever located, to my parent, '
          + '{{ will_cp.parent1.full_name | name }}, if my parent survives me. If my parent does '
          + 'not survive me, ' + residueTail,
        ),
        control('{% endif %}'),

        // ── Designation and Succession of Fiduciaries ──────────────────────
        article('Designation and Succession of Fiduciaries'),

        section('Personal Representative'),
        body(
          'I nominate {{ fiduciaries.executor.primary.full_name | name }}'
          + '{% if fiduciaries.executor.co_primary is defined and fiduciaries.executor.co_primary.full_name %}'
          + ' and {{ fiduciaries.executor.co_primary.full_name | name }}{% endif %}, as Personal '
          + 'Representative of this Will.'
          + '{% if fiduciaries.executor.successor is defined and fiduciaries.executor.successor.full_name %}'
          + '  If for any reason {{ fiduciaries.executor.primary.full_name | name }}'
          + '{% if fiduciaries.executor.co_primary is defined and fiduciaries.executor.co_primary.full_name %}'
          + ' and {{ fiduciaries.executor.co_primary.full_name | name }}{% endif %} fails or '
          + 'ceases to serve, I appoint '
          + '{% if fiduciaries.executor.second_successor is defined and fiduciaries.executor.second_successor.full_name %}'
          + '{{ fiduciaries.executor.successor.full_name | name }}'
          + '{% if fiduciaries.executor.co_successor is defined and fiduciaries.executor.co_successor.full_name %}'
          + ' and {{ fiduciaries.executor.co_successor.full_name | name }}{% endif %}; and '
          + '{{ fiduciaries.executor.second_successor.full_name | name }}, in the order named,'
          + '{% else %}'
          + '{{ fiduciaries.executor.successor.full_name | name }}'
          + '{% if fiduciaries.executor.co_successor is defined and fiduciaries.executor.co_successor.full_name %}'
          + ' and {{ fiduciaries.executor.co_successor.full_name | name }}{% endif %}'
          + '{% endif %} as Personal Representative.{% endif %}',
        ),

        // ── Powers of Fiduciaries ──────────────────────────────────────────
        article('Powers of Fiduciaries'),

        section('Grant of Powers'),
        body(
          'My Personal Representative may perform every act reasonably necessary to administer '
          + 'my estate and any trust established under my Will.  In addition to this general '
          + 'grant of powers, my Personal Representative is specifically authorized to:',
          { spacing: { after: 80 }, keepNext: true },
        ),
        numbered(
          '(1) hold, retain, invest, reinvest, sell, and manage any real or personal property, '
          + 'including interests in any form of business entity including limited partnerships '
          + 'and limited liability companies, and life, health, and disability insurance '
          + 'policies, without diversification as to kind, amount, or risk of non-productivity '
          + 'and without limitation by statute or rule of law;',
        ),
        numbered(
          '(2) partition, sell, exchange, grant, convey, deliver, assign, transfer, lease, '
          + 'option, mortgage, pledge, abandon, borrow, loan, and contract;',
        ),
        numbered(
          '(3) distribute assets of my estate in cash or in kind, or partly in each, at fair '
          + 'market value on the distribution date, without requiring pro rata distribution of '
          + 'specific assets and without requiring pro rata allocation of the tax bases of those '
          + 'assets;',
        ),
        numbered(
          '(4) hold any interest in nominee form, continue businesses, carry out agreements, and '
          + 'deal with itself, other fiduciaries, and business organizations in which my Personal '
          + 'Representative may have an interest;',
        ),
        numbered('(5) establish reserves, release powers, and abandon, settle, or contest claims; and'),
        numbered(
          '(6) employ attorneys, accountants, custodians for trust assets, and other agents or '
          + 'assistants as my Personal Representative deems advisable to act with or without '
          + 'discretionary powers, and compensate them and pay their expenses from income or '
          + 'principal.',
          true,
        ),

        section('Powers Granted by State Law'),
        body(
          'In addition to the above powers, my Personal Representative may, without prior '
          + 'authority from any court, exercise all powers conferred by my Will, by common law, '
          + 'or by the Massachusetts Fiduciary Powers Act or other Massachusetts statute or any '
          + 'other jurisdiction whose law applies to my Will.  My fiduciaries have absolute '
          + 'discretion in exercising these powers.  Except as specifically limited by my Will, '
          + 'these powers extend to all property held by my Personal Representative until the '
          + 'actual distribution of the property.',
        ),

        section('Distribution Alternatives'),
        body(
          'My Personal Representative may make any payments under my Will:',
          { spacing: { after: 80 }, keepNext: true },
        ),
        numbered('(1) directly to a beneficiary;'),
        numbered(
          '(2) in any form allowed by applicable state law for gifts or transfers to minors or '
          + 'persons under disability;',
        ),
        numbered(
          '(3) to a beneficiary’s guardian, conservator, or caregiver for the '
          + 'beneficiary’s benefit; or',
        ),
        numbered('(4) by direct payment of the beneficiary’s expenses.', true),
        body(
          'A receipt by the recipient for any distribution will fully discharge my Personal '
          + 'Representative if the distribution is consistent with the proper exercise of my '
          + 'Personal Representative’s duties under my Will.',
        ),

        // ── Administrative Provisions ──────────────────────────────────────
        article('Administrative Provisions'),

        section('Bond'),
        body(
          'To the extent permissible by law, my Personal Representative is not required to give '
          + 'any bond, surety, or security to any court.',
        ),

        section('Compensation and Reimbursement'),
        body(
          'My Personal Representative is entitled to reasonable compensation commensurate with '
          + 'services actually performed.  In addition, my Personal Representative is entitled to '
          + 'reimbursement for reasonable expenses incurred.',
        ),

        section('Ancillary Personal Representative'),
        body(
          'If any ancillary administration is required or desired, and my domiciliary Personal '
          + 'Representative is unable or unwilling to act as an Ancillary Personal '
          + 'Representative, my domiciliary Personal Representative may have power to designate, '
          + 'compensate, direct, and remove an Ancillary Personal Representative.  The Ancillary '
          + 'Personal Representative may either be a person or a corporation.  My domiciliary '
          + 'Personal Representative may delegate to the Ancillary Personal Representative any '
          + 'powers granted to my domiciliary Personal Representative as my domiciliary Personal '
          + 'Representative considers to be proper, including the right to serve without bond or '
          + 'without surety on bond.  The net proceeds of the ancillary estate will be paid over '
          + 'to the domiciliary Personal Representative.',
        ),

        // ── Taxes, Claims, and Expenses ────────────────────────────────────
        article('Taxes, Claims, and Expenses'),
        body(
          'I direct that my Personal Representative pay the expenses of my last illness, of my '
          + 'funeral, and of my estate’s administration from my residuary estate.  My '
          + 'Personal Representative shall pay all estate, inheritance and similar taxes payable '
          + 'with respect to property included in my estate, whether or not passing under my '
          + 'Will, and any interest or penalties, from my residuary estate without apportionment '
          + 'and with no right of reimbursement from any recipient of any estate property.',
        ),

        // ── General Provisions ─────────────────────────────────────────────
        article('General Provisions'),

        section('Adopted and Afterborn Persons'),
        body(
          'A legally adopted person in any generation and that person’s descendants, '
          + 'including adopted descendants, have the same rights and will be treated in the same '
          + 'manner under this Will as natural children of the adopting parent if the person is '
          + 'legally adopted before turning 18 years old.  If an adoption was legal in the '
          + 'jurisdiction it occurred in at that time, then the adoption is considered legal.',
        ),
        body(
          'A fetus in utero that is later born alive will be considered a person in being during '
          + 'the period of gestation.',
        ),

        section('Survivorship Presumption'),
        body(
          'If any beneficiary is living at my death, but dies within 30 days after my death, '
          + 'then the beneficiary will be considered to have predeceased me.',
        ),

        section('Applicable Law'),
        body(
          'The validity and construction of my Will will be determined by the laws of the '
          + 'Commonwealth of Massachusetts.',
        ),

        section('No Contract to Make Will'),
        body('I have not entered into any contract, actual or implied, to make a Will.'),

        section('Construction'),
        body(
          'Unless the context requires otherwise, words denoting the singular may denote the '
          + 'plural, and words indicating the plural may denote the singular.  As the context '
          + 'requires, words of one gender may denote another gender.',
        ),

        section('Headings and Titles'),
        body('The headings and paragraph titles are for reference only.'),

        section('Internal Revenue Code, IRC, or Code'),
        body(
          'References to the Internal Revenue Code, the IRC or the Code refer to the Internal '
          + 'Revenue Code of the United States.  References to specific sections of the Code '
          + 'apply to any sections of similar import that replace the specific sections due to '
          + 'changes to the Internal Revenue Code made after the date of my Will.',
        ),

        section('Other Definitions'),
        body(
          'Except as otherwise provided in my Will, terms will be interpreted as defined in the '
          + 'Massachusetts Probate Code as amended after the date of my Will and after my death.',
        ),

        section('Severability'),
        body(
          'If any part of this instrument is determined to be void or invalid, the remaining '
          + 'provisions will continue in full force and effect.',
        ),

        // ── Execution ──────────────────────────────────────────────────────
        body(
          'I, {{ client.full_name | name }}, the Testator, sign my name to this instrument '
          + '{{ execution.display_ordinal_doc_date }}, and being first duly sworn, do hereby '
          + 'declare to the undersigned authority that I sign and execute this instrument as my '
          + 'will and that I sign it willingly (or willingly direct another to sign for me), '
          + 'that I execute it as my free and voluntary act for the purposes therein expressed, '
          + 'and that I am 18 years of age or older, of sound mind, and under no constraint or '
          + 'undue influence.',
          { spacing: { before: 320, after: 480 } },
        ),
        paragraph(
          [{ text: '____________________________________________' }],
          { align: 'LEFT', spacing: { after: 0 } },
        ),
        paragraph(
          [{ text: '{{ client.full_name | name }}' }, { text: ', Testator' }],
          { align: 'LEFT', spacing: { after: 320 } },
        ),

        body(
          'We, _________________________ and _________________________, the witnesses, sign our '
          + 'names to this instrument, being first duly sworn, and do hereby declare to the '
          + 'undersigned authority that the testator signs and executes this instrument as '
          + '{{ client.pronoun_possessive }} will and that {{ client.pronoun_subject }} signs it '
          + 'willingly (or willingly directs another to sign for '
          + '{{ client.pronoun_object }}), and that each of us, in the presence and hearing of '
          + 'the testator, signs this will as witness to the testator’s signing, and that '
          + 'to the best of our knowledge the testator is 18 years of age or older, of sound '
          + 'mind, and under no constraint or undue influence.',
          { spacing: { after: 320 } },
        ),
        paragraph(
          [{ text: 'Signature: ______________________________  Name: ______________________________' }],
          { align: 'LEFT', spacing: { after: 60 } },
        ),
        paragraph(
          [{ text: 'Address: ____________________________________________________________________' }],
          { align: 'LEFT', spacing: { after: 240 } },
        ),
        paragraph(
          [{ text: 'Signature: ______________________________  Name: ______________________________' }],
          { align: 'LEFT', spacing: { after: 60 } },
        ),
        paragraph(
          [{ text: 'Address: ____________________________________________________________________' }],
          { align: 'LEFT', spacing: { after: 320 } },
        ),

        paragraph(
          [{ text: 'COMMONWEALTH OF MASSACHUSETTS' }],
          { align: 'LEFT', spacing: { after: 60 } },
        ),
        paragraph(
          [{ text: 'COUNTY OF {{ execution.display_signing_county | name }}' }],
          { align: 'LEFT', spacing: { after: 200 } },
        ),
        body(
          'Subscribed, sworn to and acknowledged before me by {{ client.full_name | name }}, '
          + 'the testator, and subscribed and sworn to before me by _________________________ '
          + 'and _________________________, witnesses, '
          + '{{ execution.display_ordinal_doc_date }}.',
          { spacing: { after: 480 } },
        ),
        paragraph(
          [{ text: '__________________________' }],
          { align: 'LEFT', spacing: { after: 0 } },
        ),
        paragraph(
          [{ text: 'Notary Public' }],
          { align: 'LEFT', spacing: { after: 60 } },
        ),
        paragraph(
          [{ text: 'My commission expires: {{ execution.display_notary_commission }}' }],
          { align: 'LEFT', spacing: { after: 0 } },
        ),
      ],
    },
  ],
})

function normalizeDocx(buffer: Buffer) {
  const inputZip = new PizZip(buffer)
  const outputZip = new PizZip()

  for (const name of Object.keys(inputZip.files).sort()) {
    const file = inputZip.files[name]

    if (file.dir) {
      outputZip.file(name, '', { dir: true, date: deterministicZipEntryDate })
      continue
    }

    const content = name === 'docProps/core.xml'
      ? file.asText()
        .replace(
          /<dcterms:created xsi:type="dcterms:W3CDTF">.*?<\/dcterms:created>/,
          `<dcterms:created xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:created>`,
        )
        .replace(
          /<dcterms:modified xsi:type="dcterms:W3CDTF">.*?<\/dcterms:modified>/,
          `<dcterms:modified xsi:type="dcterms:W3CDTF">${deterministicCoreDocxTimestamp}</dcterms:modified>`,
        )
      : file.asNodeBuffer()

    outputZip.file(name, content, { date: deterministicZipEntryDate, binary: Buffer.isBuffer(content) })
  }

  return outputZip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}

async function main() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, normalizeDocx(await Packer.toBuffer(doc)))
  console.log(`Wrote ${outputPath}`)
}

void main()
