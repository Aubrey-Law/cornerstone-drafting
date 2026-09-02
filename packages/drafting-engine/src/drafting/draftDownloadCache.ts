const STORAGE_PREFIX = 'drafting:zip-download:'
const MAX_BYTES = 12 * 1024 * 1024

export interface CachedDraftZip {
  matterId: string
  filename: string
  savedAt: string
  documentNames: string[]
  base64: string
}

function storageKey(matterId: string): string {
  return `${STORAGE_PREFIX}${matterId}`
}

export function storeDraftZipDownload(entry: CachedDraftZip): boolean {
  if (typeof window === 'undefined') return false
  try {
    const approxBytes = Math.ceil(entry.base64.length * 0.75)
    if (approxBytes > MAX_BYTES) return false
    sessionStorage.setItem(storageKey(entry.matterId), JSON.stringify(entry))
    return true
  } catch {
    return false
  }
}

export function loadDraftZipDownload(matterId: string): CachedDraftZip | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(storageKey(matterId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedDraftZip
    if (parsed.matterId !== matterId || !parsed.base64) return null
    return parsed
  } catch {
    return null
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function downloadCachedZip(entry: CachedDraftZip): void {
  const binary = atob(entry.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = entry.filename
  anchor.click()
  URL.revokeObjectURL(url)
}
