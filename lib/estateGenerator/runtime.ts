import path from 'node:path'

export const DEFAULT_GENERATOR_ROOT = 'tools/aubreylaw-docgeneration'

type RuntimeEnv = Record<string, string | undefined>

/**
 * Root of the estate-generator data directory (package configs, templates,
 * clauses, state rules) consumed by the Node engine. The legacy Python
 * generator that used to live alongside this data has been retired.
 */
export function resolveEstateGeneratorRoot(cwd = process.cwd(), env: RuntimeEnv = process.env): string {
  return path.resolve(cwd, env.ESTATE_GENERATOR_ROOT ?? DEFAULT_GENERATOR_ROOT)
}
