/**
 * Render the open document as markdown for the model.
 *
 * The one rule that governs this file: **structure may be added, text may never
 * be changed.** Every edit the model proposes is located by handing its
 * `original` string to Word's `search()`, so the model has to be able to quote
 * document text verbatim. If we emitted `**bold**` or smart-quoted anything,
 * the model would faithfully copy characters that do not exist in the document
 * and every such edit would come back `not-found`.
 *
 * So headings get a leading `#`, list items get their `listString` and
 * indentation, and tables become pipe rows — all of them markers *around* the
 * text. `stripStructuralMarkers` below removes exactly those markers again when
 * a model quotes one anyway.
 */

const HEADING_LEVEL_BY_STYLE: Record<string, number> = {
  Heading1: 1,
  Heading2: 2,
  Heading3: 3,
  Heading4: 4,
  Heading5: 5,
  Heading6: 6,
  Title: 1,
}

export interface DocumentSnapshot {
  markdown: string
  /** Filename as Word knows it, or null for an unsaved document. */
  name: string | null
  /** True when structure rendering failed and this is flat body text. */
  degraded: boolean
}

export async function readDocument(): Promise<DocumentSnapshot> {
  const name = Office.context.document.url?.split(/[\\/]/).pop() ?? null

  try {
    const markdown = await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs
      const tables = context.document.body.tables
      paragraphs.load('items/text,items/styleBuiltIn,items/isListItem,items/tableNestingLevel')
      tables.load('items/values,items/nestingLevel')
      await context.sync()

      // listItemOrNullObject can only be loaded after we know which paragraphs
      // are list items, so this needs a second round trip.
      const listItems = paragraphs.items.map(p => (p.isListItem ? p.listItemOrNullObject : null))
      for (const item of listItems) item?.load('isNullObject,listString,level')
      await context.sync()

      return renderBody(paragraphs.items, listItems, tables.items)
    })
    return { markdown, name, degraded: false }
  } catch {
    // Any host quirk in the structured read still leaves us able to send the
    // text, which is the part the model actually needs.
    const markdown = await Word.run(async (context) => {
      const body = context.document.body
      body.load('text')
      await context.sync()
      return body.text
    })
    return { markdown, name, degraded: true }
  }
}

function renderBody(
  paragraphs: Word.Paragraph[],
  listItems: Array<Word.ListItem | null>,
  tables: Word.Table[],
): string {
  const lines: string[] = []
  let tableIndex = 0
  let inTable = false

  paragraphs.forEach((paragraph, index) => {
    // A paragraph inside a table is rendered as part of its table, once, at the
    // point the first such paragraph appears.
    if (paragraph.tableNestingLevel > 0) {
      if (!inTable) {
        inTable = true
        const table = tables[tableIndex++]
        if (table) lines.push(renderTable(table.values), '')
      }
      return
    }
    inTable = false

    const text = paragraph.text ?? ''
    if (!text.trim()) {
      lines.push('')
      return
    }

    const listItem = listItems[index]
    if (listItem && !listItem.isNullObject) {
      const indent = '  '.repeat(Math.max(0, listItem.level ?? 0))
      lines.push(`${indent}${listItem.listString ?? '-'} ${text}`)
      return
    }

    const level = HEADING_LEVEL_BY_STYLE[paragraph.styleBuiltIn ?? '']
    lines.push(level ? `${'#'.repeat(level)} ${text}` : text)
  })

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function renderTable(values: string[][]): string {
  if (values.length === 0) return ''
  const rows = values.map(row => `| ${row.join(' | ')} |`)
  const columns = values[0].length
  // A separator row after the first makes it a table rather than a wall of pipes.
  rows.splice(1, 0, `|${' --- |'.repeat(columns)}`)
  return rows.join('\n')
}

/**
 * Undo one layer of the markers `renderBody` adds.
 *
 * Used as a retry when a verbatim search misses: the likeliest cause is that
 * the model quoted a heading or list line including its marker. Exactly one
 * layer is stripped, so a paragraph whose real text begins "1. Introduction"
 * does not silently lose its numbering.
 */
export function stripStructuralMarkers(text: string): string {
  let stripped = text.replace(/^\s+/, '')

  const heading = stripped.match(/^#{1,6}\s+(.*)$/s)
  if (heading) return heading[1]

  // Word's listString: "1.", "a)", "•", "(i)" and similar.
  const listItem = stripped.match(/^(?:[•▪◦-]|\(?[0-9]+[.)]|\(?[a-zA-Z][.)]|\(?[ivxIVX]+[.)])\s+(.*)$/s)
  if (listItem) return listItem[1]

  const tableCell = stripped.match(/^\|\s*(.*?)\s*\|$/s)
  if (tableCell) return tableCell[1]

  return stripped === text ? text : stripped
}
