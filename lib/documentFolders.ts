/**
 * Folder-name and folder-tree rules, shared by the API routes and the
 * workspace that draws them.
 *
 * Kept apart from `lib/documentWorkspace.ts` so a server route can validate a
 * name or walk a folder tree without dragging in the browser Supabase client that module reaches for.
 */

import type { MatterDocumentFolder } from '@/types/database'

export const MAX_FOLDER_NAME_LENGTH = 80

/** What a folder name means once the whitespace is off it. */
export function normalizeFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH)
}

/**
 * A folder and every folder nested anywhere beneath it. The visited set guards
 * against a malformed cycle in the rows rather than trusting the database.
 */
export function folderSubtreeIds(folderId: string, folders: MatterDocumentFolder[]): Set<string> {
  const ids = new Set([folderId])
  const queue = [folderId]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const folder of folders) {
      if (folder.parent_id === current && !ids.has(folder.id)) {
        ids.add(folder.id)
        queue.push(folder.id)
      }
    }
  }
  return ids
}

/** The chain of attorney-created folders from the root down to `folderId`. */
export function folderPath(folderId: string, folders: MatterDocumentFolder[]): MatterDocumentFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]))
  const path: MatterDocumentFolder[] = []
  const seen = new Set<string>()
  let current = byId.get(folderId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}
