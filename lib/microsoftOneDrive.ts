import { getAccessToken } from '@/lib/microsoftCalendar'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const ONEDRIVE_TIMEOUT_MS = 30_000
// Graph small-file upload cap is 4 MB; use upload session above that.
const SMALL_FILE_UPLOAD_MAX = 4 * 1024 * 1024
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024 // multiple of 320 KiB per Graph spec

export function rootPath(): string {
  return (process.env.ONEDRIVE_ROOT_PATH || '/Aubrey Law').replace(/\/+$/, '')
}

async function graphFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(ONEDRIVE_TIMEOUT_MS) })
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

export interface DriveItem {
  id: string
  name: string
  folder?: { childCount?: number }
  file?: { mimeType?: string }
  parentReference?: { id?: string; path?: string; driveId?: string }
  size?: number
  '@microsoft.graph.downloadUrl'?: string
  deleted?: { state?: string }
  lastModifiedDateTime?: string
  webUrl?: string
}

async function readDriveItemByPath(path: string): Promise<DriveItem | null> {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '')
  const res = await graphFetch(`/me/drive/root:/${encodePath(clean)}`)
  if (res.ok) return (await res.json()) as DriveItem
  if (res.status === 404) return null
  const txt = await res.text().catch(() => '')
  throw new Error(`OneDrive GET ${clean} failed (${res.status}): ${txt}`)
}

async function readDriveItemChild(parentItemId: string, name: string): Promise<DriveItem | null> {
  const res = await graphFetch(`/me/drive/items/${parentItemId}:/${encodePath(name)}`)
  if (res.ok) return (await res.json()) as DriveItem
  if (res.status === 404) return null
  const txt = await res.text().catch(() => '')
  throw new Error(`OneDrive GET child "${name}" failed (${res.status}): ${txt}`)
}

function assertFolder(item: DriveItem, name: string): DriveItem {
  if (!item.folder) {
    throw new Error(`OneDrive item "${name}" already exists but is not a folder`)
  }
  return item
}

// Create (or return existing) a folder by path under /me/drive root.
// Uses Graph's "create if missing" pattern by attempting POST under the parent.
export async function ensureFolderByPath(folderPath: string): Promise<DriveItem> {
  const clean = folderPath.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean) throw new Error('ensureFolderByPath: empty path')

  // Try to fetch first (idempotent).
  const existing = await readDriveItemByPath(clean)
  if (existing) return assertFolder(existing, clean)

  // Create the parent chain if needed.
  const parts = clean.split('/')
  const name = parts.pop() as string
  const parent = parts.join('/')
  const parentItem = parent ? await ensureFolderByPath(parent) : null

  const createPath = parentItem
    ? `/me/drive/items/${parentItem.id}/children`
    : `/me/drive/root/children`
  const res = await graphFetch(createPath, {
    method: 'POST',
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  })
  if (res.status === 409) {
    const raced = await readDriveItemByPath(clean)
    if (raced) return assertFolder(raced, clean)
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OneDrive create folder "${clean}" failed (${res.status}): ${txt}`)
  }
  return (await res.json()) as DriveItem
}

export async function createSubfolder(parentItemId: string, name: string): Promise<DriveItem> {
  const existing = await readDriveItemChild(parentItemId, name)
  if (existing) return assertFolder(existing, name)

  const res = await graphFetch(`/me/drive/items/${parentItemId}/children`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  })
  if (res.status === 409) {
    const raced = await readDriveItemChild(parentItemId, name)
    if (raced) return assertFolder(raced, name)
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OneDrive create subfolder "${name}" failed (${res.status}): ${txt}`)
  }
  return (await res.json()) as DriveItem
}

// Move + rename an existing folder into a different parent path.
export async function moveFolder(itemId: string, newParentPath: string, newName?: string): Promise<DriveItem> {
  const parent = await ensureFolderByPath(newParentPath)
  const body: Record<string, unknown> = {
    parentReference: { id: parent.id },
  }
  if (newName) body.name = newName
  const res = await graphFetch(`/me/drive/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OneDrive move folder ${itemId} failed (${res.status}): ${txt}`)
  }
  return (await res.json()) as DriveItem
}

export async function uploadFile(
  parentItemId: string,
  filename: string,
  content: Uint8Array | ArrayBuffer,
  contentType: string = 'application/octet-stream',
): Promise<DriveItem> {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
  if (bytes.byteLength <= SMALL_FILE_UPLOAD_MAX) {
    const safe = encodeURIComponent(filename)
    const res = await graphFetch(
      `/me/drive/items/${parentItemId}:/${safe}:/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: bytes as unknown as BodyInit,
      },
    )
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OneDrive small upload failed (${res.status}): ${txt}`)
    }
    return (await res.json()) as DriveItem
  }
  return uploadLarge(parentItemId, filename, bytes, contentType)
}

async function uploadLarge(
  parentItemId: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<DriveItem> {
  const safe = encodeURIComponent(filename)
  const sessRes = await graphFetch(
    `/me/drive/items/${parentItemId}:/${safe}:/createUploadSession`,
    {
      method: 'POST',
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'rename', name: filename },
      }),
    },
  )
  if (!sessRes.ok) {
    const txt = await sessRes.text().catch(() => '')
    throw new Error(`OneDrive createUploadSession failed (${sessRes.status}): ${txt}`)
  }
  const sess = (await sessRes.json()) as { uploadUrl: string }
  const total = bytes.byteLength
  let offset = 0
  let last: DriveItem | null = null
  while (offset < total) {
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total)
    const chunk = bytes.subarray(offset, end)
    const chunkRes = await fetch(sess.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
        'Content-Type': contentType,
      },
      body: chunk as unknown as BodyInit,
    })
    if (chunkRes.status === 202) {
      offset = end
      continue
    }
    if (chunkRes.ok) {
      last = (await chunkRes.json()) as DriveItem
      offset = end
      break
    }
    const txt = await chunkRes.text().catch(() => '')
    throw new Error(`OneDrive chunk upload failed at ${offset} (${chunkRes.status}): ${txt}`)
  }
  if (!last) throw new Error('OneDrive upload finished without final item')
  return last
}

export async function deleteDriveItem(itemId: string): Promise<void> {
  const res = await graphFetch(`/me/drive/items/${itemId}`, { method: 'DELETE' })
  if (res.status === 204 || res.status === 404) return
  const txt = await res.text().catch(() => '')
  throw new Error(`OneDrive delete ${itemId} failed (${res.status}): ${txt}`)
}

export async function downloadFileAsPdf(itemId: string): Promise<Uint8Array> {
  const res = await graphFetch(`/me/drive/items/${itemId}/content?format=pdf`, { redirect: 'follow' })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OneDrive PDF conversion failed (${res.status}): ${txt}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

export async function downloadFile(itemId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await graphFetch(`/me/drive/items/${itemId}/content`, { redirect: 'follow' })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OneDrive download ${itemId} failed (${res.status}): ${txt}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  return {
    bytes: buf,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  }
}

export interface DeltaPage {
  items: DriveItem[]
  nextLink?: string
  deltaLink?: string
}

// Initial call: deltaUrl=undefined  → starts a fresh delta enumeration.
// Subsequent: pass the previously-stored deltaLink to get only changes.
export async function deltaForFolder(folderItemId: string, deltaUrl?: string | null): Promise<DeltaPage> {
  const url = deltaUrl && deltaUrl.startsWith('http')
    ? deltaUrl
    : `${GRAPH_BASE}/me/drive/items/${folderItemId}/delta`
  const res = await graphFetch(url)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OneDrive delta ${folderItemId} failed (${res.status}): ${txt}`)
  }
  const json = (await res.json()) as {
    value?: DriveItem[]
    '@odata.nextLink'?: string
    '@odata.deltaLink'?: string
  }
  return {
    items: json.value ?? [],
    nextLink: json['@odata.nextLink'],
    deltaLink: json['@odata.deltaLink'],
  }
}
