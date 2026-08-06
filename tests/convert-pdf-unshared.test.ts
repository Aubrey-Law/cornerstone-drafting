import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('convert-pdf', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/[id]/convert-pdf/route.ts'),
    'utf8',
  )

  // Scoped to the matter_documents insert on purpose. The other `folder:` in this
  // route is an argument to createDocumentVersion(), which only picks the R2 key
  // prefix for the document_versions blob and has nothing to do with sharing.
  const insertStart = source.indexOf('.insert({')
  const insert = source.slice(
    insertStart,
    source.indexOf('.select(MATTER_DOCUMENT_COLUMNS)', insertStart),
  )

  it('creates the PDF unshared so the attorney chooses when to share', () => {
    expect(insert).toContain('shared_at: null')
    expect(insert).not.toContain("folder: 'review'")
  })
})
