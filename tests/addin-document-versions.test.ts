import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

/**
 * Source with comments removed, for asserting that something is *not* done.
 * This route explains at length why it writes no `document_edits` rows, and
 * that prose is not a call site.
 */
const code = (rel: string) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

const VERSIONS = 'app/api/addin/documents/[id]/versions/route.ts'
const DOCUMENTS = 'app/api/addin/matters/[id]/documents/route.ts'

/**
 * The add-in shipped editing whatever file was open on disk while
 * `/api/documents/[id]/edits` wrote R2 versions, and the two never met. These
 * pin the reconciliation: what makes a version, what stops one being lost, and
 * what the pane deliberately does not write.
 */
describe('saving a version from the pane', () => {
  it('reuses the version writer rather than touching document_versions itself', () => {
    // createDocumentVersion owns the R2 upload, the version_number retry on a
    // unique collision, and the current_version_id pointer. A second writer
    // would be a second answer to all three.
    const route = source(VERSIONS)
    expect(route).toContain('createDocumentVersion')
    expect(code(VERSIONS)).not.toContain(".from('document_versions')")
  })

  it('makes the pre-pane state version 1 before saving version 2', () => {
    // Without this the history begins at the edited document and whatever the
    // document said before the attorney opened it is unrecoverable.
    const route = source(VERSIONS)
    const ensureAt = route.indexOf('ensureInitialVersion')
    const createAt = route.indexOf('createDocumentVersion({')
    expect(ensureAt).toBeGreaterThan(-1)
    expect(createAt).toBeGreaterThan(ensureAt)
  })

  it('refuses to bury a version saved by someone else', () => {
    // The attorney may have been editing in Word for an hour. Uploading over a
    // version created meanwhile would discard it with no trace — the very
    // failure this path exists to prevent, by a different door.
    const route = source(VERSIONS)
    expect(route).toContain('baseVersionId')
    expect(route).toContain('loadActiveVersion')
    expect(route).toContain('conflict: true')
    expect(route).toContain('status: 409')
  })

  it('writes no document_edits rows', () => {
    // Those carry each revision's w:id so the web UI can accept or reject one.
    // The pane cannot know the ids Word assigned, and a row without them is
    // worse than no row: resolveTrackedChange would get an empty id list,
    // change nothing, and still mark the edit accepted.
    expect(code(VERSIONS)).not.toContain('document_edits')
  })

  it('records that the version came from Word', () => {
    // In the version list, where an attorney reads it: 'word_addin' rather than
    // the 'user_upload' this shipped with, which was indistinguishable from a
    // document dragged into the browser. The audit row still says which surface
    // the request came from, which is a different question.
    const route = source(VERSIONS)
    expect(route).toContain("source: 'word_addin'")
    expect(route).toContain('auditDocumentAccess')
    expect(route).toContain("'word-addin'")
  })

  it('rescans markers so a stale count cannot outlive the bytes', () => {
    // Matches the edits route. A stale marker count is how a draft looks
    // finished when it still has unresolved placeholders in it.
    expect(source(VERSIONS)).toContain('scanDocxBufferForMarkers')
  })

  it('bounds the upload, and the pane agrees on the bound', () => {
    expect(source(VERSIONS)).toContain('MAX_BASE64_CHARS')
    expect(source(VERSIONS)).toContain('status: 413')
    // Checked pane-side too, so an oversized document is named before the
    // upload is spent rather than arriving as a generic failure.
    expect(source('word-addin/src/word/readDocumentBytes.ts'))
      .toContain('MAX_UPLOAD_BASE64_CHARS')
  })

  it('offers only documents this pane could be looking at', () => {
    // A version saved from the pane is the open Word document, so a PDF row is
    // never the right answer.
    expect(source(DOCUMENTS)).toContain('DOCX_CONTENT_TYPE')
    expect(source(VERSIONS)).toContain('isDocxDocument')
    expect(source(VERSIONS)).toContain('status: 415')
  })

  it('gates itself, having no middleware backstop', () => {
    for (const route of [VERSIONS, DOCUMENTS]) {
      expect(source(route)).toContain('requireAdmin(req)')
      expect(source(route)).toMatch(/if \(auth\.err\) return auth\.err/)
    }
  })
})

describe('the pane reads the document once', () => {
  it('shares one byte reader between the style sweep and the version save', () => {
    // Both need the whole .docx including tracked changes and section
    // properties. Two readers would be two answers to Office's two-handle
    // limit and to the base64 chunking that keeps a large document from
    // blowing the argument limit.
    const sweep = source('word-addin/src/word/formatting/styleSweep.ts')
    expect(sweep).toContain("from '../readDocumentBytes'")
    expect(code('word-addin/src/word/formatting/styleSweep.ts')).not.toContain('getFileAsync')

    const panel = source('word-addin/src/taskpane/components/VersionPanel.tsx')
    expect(panel).toContain('readDocumentBytes')
  })
})
