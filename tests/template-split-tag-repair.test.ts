import { describe, expect, it } from 'vitest'

import {
  firstUnclosedTag,
  repairSplitNunjucksInXml,
} from '@/lib/estateGenerator/node/templateRenderer'
import { renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'

/**
 * Word does not keep a merge field in one piece. Spell-check, a manual edit, or
 * an author breaking a line puts `{{ client.full_name }}` across several runs,
 * several paragraphs, or — in a footer built from a table — several cells. The
 * renderer sees `{{ client.` followed by markup and fails with the unhelpful
 * "unexpected token: <".
 *
 * The repair rejoins the tag. What it must not do is rejoin it by deleting the
 * structure in between: stripping `</w:tc><w:tc>` makes the text contiguous and
 * merges two table cells.
 */

const CONTEXT = { client: { full_name: 'Rowan Delgado' }, has_spouse: false } as never

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`
const para = (...runs: string[]) => `<w:p>${runs.map(run).join('')}</w:p>`
const cell = (...runs: string[]) => `<w:tc>${para(...runs)}</w:tc>`

function render(xml: string): string {
  return renderNodeEstateText(repairSplitNunjucksInXml(xml), CONTEXT, {}, { autoescape: true })
}

/** Visible text, as Word would show it. */
const visible = (xml: string) =>
  [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('')

const countTag = (xml: string, name: string) =>
  (xml.match(new RegExp(`<w:${name}\\b`, 'g')) ?? []).length

describe('a tag split by Word still renders', () => {
  const SPLITS: Array<[string, string]> = [
    ['whole, in one run', para('{{ client.full_name }}')],
    ['split mid-name', para('{{ client.full_', 'name }}')],
    ['split between the braces', para('{', '{ client.full_name }', '}')],
    [
      'split by a spell-check marker',
      `<w:p>${run('{{ client.')}<w:proofErr w:type="spellStart"/>${run('full_name }}')}</w:p>`,
    ],
    ['split across two paragraphs', para('{{ client.full_name') + para('}}')],
    ['split across two table cells', `<w:tbl><w:tr>${cell('{{ client.')}${cell('full_name }}')}</w:tr></w:tbl>`],
  ]

  for (const [name, xml] of SPLITS) {
    it(name, () => {
      expect(visible(render(xml))).toContain('Rowan Delgado')
    })
  }

  it('rejoins a control tag broken over two paragraphs', () => {
    const xml =
      para('{% if has_spouse') + para('%}') + para('spouse text') + para('{% endif %}')
    expect(visible(render(xml))).not.toContain('spouse text')
  })
})

describe('the repair keeps the document structure', () => {
  it('does not merge the table cells it reaches across', () => {
    // The reason the span is collapsed rather than stripped: deleting
    // `</w:tc><w:tc>` to make the text contiguous would leave one cell where the
    // author put two, and the footer would lose its layout.
    const xml = `<w:tbl><w:tr>${cell('{{ client.')}${cell('full_name }}')}</w:tr></w:tbl>`
    const repaired = repairSplitNunjucksInXml(xml)

    expect(countTag(repaired, 'tc')).toBe(2)
    expect(countTag(repaired, 'p')).toBe(2)
    expect(countTag(repaired, 'r')).toBe(2)
  })

  it('does not merge the paragraphs it reaches across', () => {
    const repaired = repairSplitNunjucksInXml(para('{{ client.full_name') + para('}}'))
    expect(countTag(repaired, 'p')).toBe(2)
  })

  it('leaves a document with no split tags byte-for-byte alone', () => {
    const xml = para('{{ client.full_name }}') + para('Ordinary text.')
    expect(repairSplitNunjucksInXml(xml)).toBe(xml)
  })
})

describe('an unclosed tag is contained and named', () => {
  it('does not swallow the tags that follow it', () => {
    // Scanning past an unclosed `{{` for a `}}` that never comes would consume
    // every later tag into one span and lose the whole rest of the part.
    const xml = para('{{ client.full_name') + para('Page 1') + para('{{ client.full_name }}')
    const repaired = repairSplitNunjucksInXml(xml)

    expect(countTag(repaired, 'p')).toBe(3)
    expect(repaired).toContain('Page 1')
  })

  it('names the offending tag instead of a column number', () => {
    const xml = para('{{ client.full_name') + para('Page 1')
    expect(firstUnclosedTag(repairSplitNunjucksInXml(xml))).toBe('{{ client.full_name Page 1')
  })

  it('reports nothing when every tag is closed', () => {
    expect(firstUnclosedTag(para('{{ client.full_name }}'))).toBeNull()
    expect(firstUnclosedTag(para('{% if has_spouse %}', 'x', '{% endif %}'))).toBeNull()
  })

  it('does not mistake ordinary prose for a tag', () => {
    expect(firstUnclosedTag(para('Fee: {1} per hour, payable on the 1st.'))).toBeNull()
  })
})
