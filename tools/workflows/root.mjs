import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path of the bundled system-workflow tree. Resolved from this
 * module's own location rather than `process.cwd()` so it holds for any app in
 * the workspace, whatever directory its build runs from.
 */
export const systemWorkflowsRoot = dirname(fileURLToPath(import.meta.url))
