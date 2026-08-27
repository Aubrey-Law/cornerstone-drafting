import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const applySource = read('word-addin/src/word/applyTrackedEdits.ts')

/**
 * Source assertions on the Office.js edit path.
 *
 * These encode host behaviours that cannot be reproduced under vitest and, in
 * the worst case, cannot be reproduced on the developer's machine either — the
 * tracked-Replace bug below is invisible on Windows and silently destroys the
 * attorney's text on Mac. A source guard is the only thing standing between a
 * plausible-looking refactor and a data-loss bug nobody sees in review.
 */
describe('tracked-edit apply path', () => {
  it('NEVER uses insertText(..., Replace)', () => {
    // Word for Mac decomposes a tracked Replace into an UNTRACKED deletion plus
    // a tracked insertion: the original text vanishes with no Deleted revision
    // to reject. Insert-after then delete is the only form every host records
    // as a reviewable pair.
    expect(applySource).not.toContain('InsertLocation.replace')
    expect(applySource).toContain('Word.InsertLocation.after')
    expect(applySource).toContain('target.delete()')
  })

  it('turns change tracking on and restores the attorney’s setting afterwards', () => {
    expect(applySource).toContain('Word.ChangeTrackingMode.trackAll')
    expect(applySource).toMatch(/finally\s*\{[\s\S]*changeTrackingMode = originalMode/)
  })

  it('syncs the tracking-mode change before authoring anything', () => {
    // Batched with the first insertion, that insertion can land under the
    // attorney's previous mode — untracked.
    const enable = applySource.indexOf('Word.ChangeTrackingMode.trackAll')
    const sync = applySource.indexOf('await context.sync()', enable)
    const firstEdit = applySource.indexOf('for (const [index, edit]')
    expect(sync).toBeGreaterThan(enable)
    expect(sync).toBeLessThan(firstEdit)
  })

  it('checks the requirement set before assuming tracked changes exist', () => {
    expect(applySource).toContain("isSetSupported('WordApi', '1.6')")
  })

  it('refuses to author over a passage that already carries a revision', () => {
    expect(applySource).toContain('pre-existing-revisions')
  })

  it('anchors each change with a bookmark rather than holding a Word proxy', () => {
    // Proxies go stale the moment they leave their Word.run, so an edit card
    // cannot hold a Range across a React render.
    expect(applySource).toContain('insertBookmark')
  })

  it('serializes every mutation through the shared queue', () => {
    // Two overlapping Word.run batches against one document corrupt each other.
    for (const file of [
      'word-addin/src/word/applyTrackedEdits.ts',
      'word-addin/src/word/trackedChanges.ts',
      'word-addin/src/word/formatting/runPasses.ts',
      'word-addin/src/word/formatting/styleSweep.ts',
    ]) {
      expect(read(file)).toContain('serializeWordMutation')
    }
  })
})

describe('style sweep round trip', () => {
  const sweep = read('word-addin/src/word/formatting/styleSweep.ts')

  it('replaces the document with section properties intact', () => {
    // Document.insertFileFromBase64 copies headers, footers, watermarks, and
    // section properties by default — which is why page setup survives a sweep
    // even though Office.js exposes pageSetup only on WordApiDesktop.
    expect(sweep).toContain('insertFileFromBase64')
    expect(sweep).toContain('Word.InsertLocation.replace')
    expect(sweep).toContain('importStyles: true')
  })

  it('always closes the file handle', () => {
    // Office allows only two open handles per document; leaking one breaks the
    // next run with an unhelpful error.
    expect(sweep).toMatch(/finally\s*\{[\s\S]*closeAsync\(\)/)
  })
})

describe('document rendering for the model', () => {
  const reader = read('word-addin/src/word/readDocument.ts')

  it('adds structure markers but never rewrites the text itself', () => {
    // Every edit is located by handing its `original` to Word's search, so the
    // model has to be able to quote document text verbatim. Emitting inline
    // markup would teach it to quote characters that are not in the document.
    expect(reader).not.toMatch(/\*\*\$\{|'\*\*'|"\*\*"/)
    expect(reader).toContain('stripStructuralMarkers')
  })
})
