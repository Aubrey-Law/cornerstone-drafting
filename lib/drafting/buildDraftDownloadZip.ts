import PizZip from 'pizzip'
import { buildDraftDocumentName, titleFromOutputSlug } from '@/lib/estateGenerator/draftDocumentName'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'
import type { DraftPayload } from '@/lib/buildDraftPayload'
import type { DraftDocumentReport, DraftDownloadMeta } from '@/lib/drafting/draftDownloadMeta'
import type { EstateClauseManifestEntry } from '@/lib/estateClauses/types'

export type { DraftDocumentReport, DraftDownloadMeta } from '@/lib/drafting/draftDownloadMeta'
export {
  decodeDraftDownloadMeta,
  encodeDraftDownloadMeta,
} from '@/lib/drafting/draftDownloadMeta'

export type DraftGeneratedFile = {
  filename: string
  buffer: Buffer
  title?: string
  owner?: string | null
  clauseSource?: 'database' | 'file'
  clauseManifest?: EstateClauseManifestEntry[]
}

function generationDateEastern(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

export function buildDraftDownloadArtifacts(
  files: DraftGeneratedFile[],
  payload: DraftPayload,
): { zipBuffer: Uint8Array; meta: DraftDownloadMeta } {
  const generationDate = generationDateEastern()
  const zip = new PizZip()
  const documentReports: DraftDocumentReport[] = []
  const documents: string[] = []
  const clauseManifestDocuments: Array<{
    sourceFilename: string
    documentName: string
    clauseSource: 'database' | 'file' | null
    clauses: EstateClauseManifestEntry[]
  }> = []

  for (const file of files) {
    const documentName = buildDraftDocumentName({
      date: generationDate,
      owner: file.owner ?? payload.client.full_name ?? null,
      title: file.title ?? titleFromOutputSlug(file.filename),
    })
    const scan = scanDocxBufferForMarkers(file.buffer)
    documentReports.push({
      name: documentName,
      todoCount: scan.todoCount,
      markerCount: scan.markerCount,
      unresolved: scan.unresolved,
      missingFields: scan.missingFields,
    })
    documents.push(documentName)
    zip.file(documentName, file.buffer)
    clauseManifestDocuments.push({
      sourceFilename: file.filename,
      documentName,
      clauseSource: file.clauseSource ?? null,
      clauses: file.clauseManifest ?? [],
    })
  }

  zip.file('clause-manifest.json', JSON.stringify({
    version: 1,
    jurisdiction: 'MA',
    documents: clauseManifestDocuments,
  }, null, 2))

  const meta: DraftDownloadMeta = {
    documents,
    documentReports,
    hasBlockingMarkers: documentReports.some(report => report.markerCount > 0),
    missing: [],
    warnings: [],
  }

  return {
    zipBuffer: new Uint8Array(zip.generate({ type: 'uint8array', compression: 'DEFLATE' })),
    meta,
  }
}

export function draftDownloadZipFilename(clientName: string | null | undefined): string {
  const slug = (clientName?.trim() || 'estate-plan').replace(/[^a-zA-Z0-9_-]+/g, '-')
  const date = generationDateEastern()
  return `drafts-${slug}-${date}.zip`
}
