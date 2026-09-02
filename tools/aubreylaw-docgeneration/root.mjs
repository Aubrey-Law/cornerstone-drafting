import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path of this data directory.
 *
 * Consumers used to derive it from `process.cwd()`, which only holds while the
 * caller runs from the repository root. A second Next app (or any serverless
 * function built from a subdirectory) has a different cwd and would look for
 * `<that dir>/tools/aubreylaw-docgeneration`, which does not exist. Resolving
 * from this module's own location is cwd-independent and survives being
 * symlinked into node_modules as a workspace package.
 */
export const templatesRoot = dirname(fileURLToPath(import.meta.url))
