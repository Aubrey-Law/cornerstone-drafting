import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { documentContentHash } from '@/lib/drafting/documentContentHash'
import { findExamplePath, listEstatePackageNames } from '../scripts/estateExamples'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'
import PizZip from 'pizzip'

const root = resolveNodeEstateGeneratorRoot()
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'corpus', 'manifest.json'), 'utf8'),
) as {
  documents: Array<{ package: string; document: string; contentHash: string; approval: { status: string } }>
}

/**
 * These are the cheap structural checks. The expensive one — regenerating every
 * document and comparing — is `npm run corpus:check`, which CI runs as its own
 * step because it renders 45 DOCX files and does not belong in the unit suite.
 */
describe('golden-document corpus', () => {
  it('covers every package that has an example payload', () => {
    const renderable = listEstatePackageNames(root).filter(p => findExamplePath(root, p) !== null)
    const covered = new Set(manifest.documents.map(d => d.package))
    const missing = renderable.filter(p => !covered.has(p))
    expect(
      missing,
      `these packages render but are not fingerprinted, so a change to them would go unnoticed: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('records a content hash for every document', () => {
    expect(manifest.documents.length).toBeGreaterThan(0)
    for (const doc of manifest.documents) {
      expect(doc.contentHash, `${doc.package}/${doc.document}`).toMatch(/^[0-9a-f]{64}$/)
      expect(['unreviewed', 'approved']).toContain(doc.approval.status)
    }
  })

  it('hashes content rather than file bytes', () => {
    // The distinction is the whole reason this gate works. A DOCX is a zip
    // whose entries carry timestamps, so hashing the file makes two renders of
    // identical input look different. Re-zipping the same entries must not
    // change the hash.
    // The timestamp lives on the entry, not on the archive — which is exactly
    // why a naive file hash drifts between two renders of the same input.
    const zipAt = (date: Date) => {
      const zip = new PizZip()
      zip.file('word/document.xml', '<w:p>same</w:p>', { date })
      return zip.generate({ type: 'nodebuffer' }) as Buffer
    }
    const a = zipAt(new Date('2020-01-01'))
    const b = zipAt(new Date('2026-09-03'))
    expect(a.equals(b)).toBe(false) // different bytes …
    expect(documentContentHash(a)).toBe(documentContentHash(b)) // … same content
  })
})
