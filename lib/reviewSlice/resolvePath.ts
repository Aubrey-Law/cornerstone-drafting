import fs from 'node:fs'
import path from 'node:path'

/**
 * Finding the document a person meant.
 *
 * A path typed into a terminal arrives mangled in a small number of specific
 * ways, and all of them look identical from here: the file is not there. Saying
 * only that is unhelpful when the path is *nearly* right, so this tries the
 * near-misses and either recovers or names the one that would have worked.
 *
 * It never guesses between candidates — the first one that exists wins, in a
 * fixed order, and the caller is told which repair was applied. Silently opening
 * a different document than the one asked for would be worse than any error.
 */

export interface ResolvedPath {
  path: string
  /** How the given path was repaired, if it was. */
  repair: 'none' | 'unescaped' | 'absolute'
}

export type ResolvePathResult =
  | { ok: true; resolved: ResolvedPath }
  | { ok: false; message: string }

/**
 * Removes shell escapes the shell itself did not remove.
 *
 * macOS Finder pastes a dragged path with its spaces backslash-escaped. That is
 * correct *unquoted* — but inside double quotes a backslash before a space is
 * not an escape, it is a backslash, so wrapping the pasted path in quotes hands
 * us a filename containing literal backslashes. Quoting and escaping are
 * alternatives and doing both is the single most common way this goes wrong.
 */
function unescapeShellPath(value: string): string {
  return value.replace(/\\(.)/g, '$1')
}

export function resolveDocumentPath(given: string): ResolvePathResult {
  const candidates: ResolvedPath[] = [{ path: given, repair: 'none' }]

  const unescaped = unescapeShellPath(given)
  if (unescaped !== given) candidates.push({ path: unescaped, repair: 'unescaped' })

  // A path starting `Users/` or `home/` is almost always an absolute path that
  // lost its leading slash on the way through a copy and paste. Only offered
  // when it actually resolves, so a genuine relative path is unaffected.
  for (const candidate of [...candidates]) {
    if (path.isAbsolute(candidate.path)) continue
    if (!/^(Users|home)\//.test(candidate.path)) continue
    candidates.push({ path: `/${candidate.path}`, repair: 'absolute' })
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).isFile()) {
      return { ok: true, resolved: candidate }
    }
  }

  return { ok: false, message: describeMiss(given) }
}

/**
 * Explains a miss in terms of what the caller typed.
 *
 * "No such file" is true and useless when the path is nearly right. The
 * directory check is the useful half: a path whose parent exists is a typo in
 * the filename, and one whose parent does not is a wrong directory — different
 * problems, and the caller should not have to work out which.
 */
function describeMiss(given: string): string {
  const lines = [`No such file: ${given}`]

  if (/\\ /.test(given)) {
    lines.push(
      '',
      'That path contains backslash-escaped spaces. Quoting and escaping are',
      'alternatives — inside quotes the backslashes are part of the filename.',
      'Either quote the path with real spaces, or leave it unquoted with the',
      'backslashes, but not both.',
    )
  }

  const attempted = path.resolve(unescapeShellPath(given))
  if (!path.isAbsolute(given)) {
    lines.push('', `Looked for it at: ${attempted}`)
  }

  const parent = path.dirname(attempted)
  if (fs.existsSync(parent)) {
    lines.push('', `That directory exists, so check the filename. It contains:`)
    try {
      const entries = fs
        .readdirSync(parent)
        .filter(entry => /\.(docx|pdf)$/i.test(entry))
        .slice(0, 10)
      if (entries.length === 0) lines.push('  (no .docx or .pdf files)')
      else for (const entry of entries) lines.push(`  ${entry}`)
    } catch {
      lines.push('  (could not read the directory)')
    }
  }

  return lines.join('\n')
}
