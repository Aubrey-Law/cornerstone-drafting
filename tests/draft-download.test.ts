import { describe, expect, it } from 'vitest'
import {
  buildDraftDownloadArtifacts,
  decodeDraftDownloadMeta,
  draftDownloadZipFilename,
  encodeDraftDownloadMeta,
} from '@/lib/drafting/buildDraftDownloadZip'
import type { DraftPayload } from '@/lib/buildDraftPayload'

const payload = {
  client: { full_name: 'Jane Doe' },
} as DraftPayload

describe('buildDraftDownloadZip', () => {
  it('packs generated files into a zip with friendly document names', () => {
    const { zipBuffer, meta } = buildDraftDownloadArtifacts([
      {
        filename: '01-durable-power-of-attorney.docx',
        buffer: Buffer.from('docx-1'),
        title: 'Durable Power of Attorney',
        owner: 'Jane Doe',
      },
    ], payload)

    expect(zipBuffer.byteLength).toBeGreaterThan(0)
    expect(meta.documents).toHaveLength(1)
    expect(meta.documents[0]).toMatch(/Jane Doe/)
    expect(meta.documents[0]).toMatch(/Durable Power of Attorney\.docx$/)
  })

  it('round-trips download metadata through response headers', () => {
    const encoded = encodeDraftDownloadMeta({
      documents: ['2026-06-19_Jane Doe_Durable Power of Attorney.docx'],
      documentReports: [],
      hasBlockingMarkers: false,
      missing: ['fiduciaries.guardian.primary.full_name'],
      warnings: ['Review trustee provisions'],
    })

    const decoded = decodeDraftDownloadMeta(encoded)
    expect(decoded?.missing).toEqual(['fiduciaries.guardian.primary.full_name'])
    expect(decoded?.warnings).toEqual(['Review trustee provisions'])
  })

  it('builds a safe zip filename from the client name', () => {
    expect(draftDownloadZipFilename('Jane & John Doe')).toMatch(/^drafts-Jane-John-Doe-\d{4}-\d{2}-\d{2}\.zip$/)
  })
})
