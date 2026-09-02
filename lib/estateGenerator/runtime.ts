import fs from 'node:fs'
import path from 'node:path'
import { templatesRoot } from '@aubrey-law/estate-templates/root'

export const DEFAULT_GENERATOR_ROOT = 'tools/aubreylaw-docgeneration'

type RuntimeEnv = Record<string, string | undefined>

/**
 * Root of the estate-generator data directory (package configs, templates,
 * clauses, state rules) consumed by the Node engine. The legacy Python
 * generator that used to live alongside this data has been retired.
 *
 * Resolution order:
 *   1. ESTATE_GENERATOR_ROOT, resolved against `cwd` — the explicit override.
 *   2. The @aubrey-law/estate-templates package's own location, which is
 *      cwd-independent. A build whose cwd is not the repository root (a second
 *      app in the workspace, or a serverless function bundled from a
 *      subdirectory) would otherwise look for `<cwd>/tools/aubreylaw-docgeneration`
 *      and find nothing.
 *   3. The cwd-relative default. Kept as a fallback so a bundle that ships the
 *      data directory without the package symlink still works — this path
 *      generates client instruments, and a resolution miss must not be a
 *      silent one.
 */
export function resolveEstateGeneratorRoot(cwd = process.cwd(), env: RuntimeEnv = process.env): string {
  const override = env.ESTATE_GENERATOR_ROOT
  if (override) return path.resolve(cwd, override)
  if (templatesRoot && fs.existsSync(path.join(templatesRoot, 'packages'))) return templatesRoot
  return path.resolve(cwd, DEFAULT_GENERATOR_ROOT)
}
