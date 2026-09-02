export type DraftDocumentReport = {
  name: string
  todoCount: number
  markerCount: number
  unresolved: string[]
  missingFields: string[]
}

export type DraftDownloadMeta = {
  documents: string[]
  documentReports: DraftDocumentReport[]
  hasBlockingMarkers: boolean
  missing: string[]
  warnings: string[]
}

export function encodeDraftDownloadMeta(meta: DraftDownloadMeta): string {
  return Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url')
}

export function decodeDraftDownloadMeta(value: string): DraftDownloadMeta | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as DraftDownloadMeta
  } catch {
    return null
  }
}
