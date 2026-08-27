import { serializeWordMutation } from '../mutationQueue'
import { CONTENT_PASSES, type ParagraphEdit, type PassResult } from './contentPasses'

/**
 * Preview and apply the content formatting passes against the live document.
 *
 * Two steps on purpose. The passes are regex-driven and will misjudge an
 * unusual document, so the attorney sees exactly what would change before
 * anything does — and the apply runs under tracked changes, so even an accepted
 * preview stays reversible.
 */

export interface FormattingPreview {
  passes: PassResult[]
  totalEdits: number
}

export async function previewContentPasses(): Promise<FormattingPreview> {
  const paragraphs = await readParagraphText()
  const passes = CONTENT_PASSES.map(run => run(paragraphs)).filter(p => p.edits.length > 0)
  return { passes, totalEdits: passes.reduce((sum, p) => sum + p.edits.length, 0) }
}

async function readParagraphText(): Promise<string[]> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs
    paragraphs.load('items/text')
    await context.sync()
    return paragraphs.items.map(p => p.text ?? '')
  })
}

export interface ApplyPassesResult {
  applied: number
  failed: number
  staleDocument: boolean
}

/**
 * Apply the previewed edits.
 *
 * Edits are applied back-to-front. Every one is indexed against the paragraph
 * list as it was read, and inserting a paragraph shifts every later index —
 * working backwards keeps the untouched indices valid.
 */
export async function applyContentPasses(passes: PassResult[]): Promise<ApplyPassesResult> {
  const edits = passes
    .flatMap(pass => pass.edits)
    .sort((a, b) => b.index - a.index)

  if (edits.length === 0) return { applied: 0, failed: 0, staleDocument: false }

  return serializeWordMutation(() =>
    Word.run(async (context) => {
      const doc = context.document
      doc.load('changeTrackingMode')
      const paragraphs = doc.body.paragraphs
      paragraphs.load('items/text')
      await context.sync()

      const originalMode = doc.changeTrackingMode
      doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll
      await context.sync()

      let applied = 0
      let failed = 0
      let staleDocument = false

      try {
        for (const edit of edits) {
          const paragraph = paragraphs.items[edit.index]
          // The document changed between preview and apply. Skip rather than
          // rewriting whatever now happens to sit at that index.
          if (!paragraph || paragraph.text !== edit.before) {
            staleDocument = true
            failed++
            continue
          }

          try {
            applyParagraphEdit(paragraph, edit)
            await context.sync()
            applied++
          } catch {
            failed++
          }
        }
      } finally {
        doc.changeTrackingMode = originalMode
        await context.sync()
      }

      return { applied, failed, staleDocument }
    }),
  )
}

function applyParagraphEdit(paragraph: Word.Paragraph, edit: ParagraphEdit): void {
  if (edit.after !== edit.before) {
    paragraph.insertText(edit.after, Word.InsertLocation.replace)
  }

  if (edit.format) {
    const { alignment, fontSizePt, leftIndentPt, spaceBeforePt, spaceAfterPt } = edit.format
    if (alignment) {
      paragraph.alignment =
        alignment === 'centered' ? Word.Alignment.centered : Word.Alignment.left
    }
    if (fontSizePt !== undefined) paragraph.font.size = fontSizePt
    if (leftIndentPt !== undefined) paragraph.leftIndent = leftIndentPt
    if (spaceBeforePt !== undefined) paragraph.spaceBefore = spaceBeforePt
    if (spaceAfterPt !== undefined) paragraph.spaceAfter = spaceAfterPt
  }

  // Inserted in reverse so each lands directly after the source paragraph and
  // they end up in the order the pass declared.
  for (const extra of [...(edit.insertAfter ?? [])].reverse()) {
    const inserted = paragraph.insertParagraph(extra.text, Word.InsertLocation.after)
    if (extra.leftIndentPt !== undefined) inserted.leftIndent = extra.leftIndentPt
    if (extra.spaceAfterPt !== undefined) inserted.spaceAfter = extra.spaceAfterPt
  }
}
