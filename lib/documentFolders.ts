/**
 * Folder-name rules, shared by the API routes and the dialog that creates them.
 *
 * Kept apart from `lib/documentWorkspace.ts` so a server route can validate a
 * name without dragging in the browser Supabase client that module reaches for.
 */

export const MAX_FOLDER_NAME_LENGTH = 80

/** What a folder name means once the whitespace is off it. */
export function normalizeFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH)
}
