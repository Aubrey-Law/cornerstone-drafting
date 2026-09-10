import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'

/**
 * Where this server's credentials come from.
 *
 * They are deliberately NOT written into `~/.claude.json`. That file is backed
 * up and synced between machines, and the value in question is the Supabase
 * service-role key, which bypasses row-level security on every table. It
 * already lives in `.env.local`, which is gitignored, and one copy is the right
 * number.
 *
 * `scripts/validateOAuth.mjs` reads `.env.local` the same way, but resolves it
 * from `process.cwd()`. That would not work here: an MCP server is launched by
 * the editor from whatever directory it happens to be in, so the repository
 * root has to be derived from this module's own location instead.
 */

/** `tools/matters-mcp/src` → the repository root, three levels up. */
export function repoRootFrom(moduleDir: string): string {
  return join(moduleDir, '..', '..', '..')
}

/** The contents of the repo's `.env.local`, or null when there is none. */
export function readEnvFile(repoRoot: string): string | null {
  const path = join(repoRoot, '.env.local')
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/**
 * The file's values, overridden by anything already in the environment.
 *
 * That precedence matters both ways. An explicit `env` entry in the MCP
 * configuration, or a shell export, must win — otherwise pointing this server
 * at a different project for one run would be impossible. But a variable that
 * is present and *blank* must not win, because an empty string is how a
 * half-filled config presents itself, and shadowing a good value with it would
 * fail in a way that looks like the file is wrong.
 */
export function mergeEnvFile(
  processEnv: Record<string, string | undefined>,
  fileContents: string | null,
): Record<string, string | undefined> {
  if (fileContents === null) return processEnv
  const set = Object.fromEntries(
    Object.entries(processEnv).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  )
  return { ...parse(fileContents), ...set }
}
