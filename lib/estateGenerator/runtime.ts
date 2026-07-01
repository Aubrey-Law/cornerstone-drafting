import { existsSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_GENERATOR_ROOT = 'tools/aubreylaw-docgeneration'
export const ESTATE_GENERATOR_SETUP_COMMAND =
  'python3 -m venv tools/aubreylaw-docgeneration/.venv && tools/aubreylaw-docgeneration/.venv/bin/pip install -r tools/aubreylaw-docgeneration/requirements.txt'

type RuntimeEnv = Record<string, string | undefined>

interface ResolvePythonOptions {
  root?: string
  cwd?: string
  env?: RuntimeEnv
  exists?: (candidate: string) => boolean
}

export function resolveEstateGeneratorRoot(cwd = process.cwd(), env: RuntimeEnv = process.env): string {
  return path.resolve(cwd, env.ESTATE_GENERATOR_ROOT ?? DEFAULT_GENERATOR_ROOT)
}

export function resolveEstateGeneratorPythonCommand({
  root = resolveEstateGeneratorRoot(),
  cwd = process.cwd(),
  env = process.env,
  exists = existsSync,
}: ResolvePythonOptions = {}): string {
  if (env.ESTATE_GENERATOR_PYTHON) return env.ESTATE_GENERATOR_PYTHON

  const candidates = [
    path.join(root, '.venv', 'bin', 'python'),
    path.join(cwd, '.venv', 'bin', 'python'),
  ]
  return candidates.find(candidate => exists(candidate)) ?? 'python3'
}

export function dependencyErrorMessage(): string {
  return [
    'Python document generator dependencies are not installed for the selected Python runtime.',
    `Create the local generator venv with: ${ESTATE_GENERATOR_SETUP_COMMAND}`,
    'Or set ESTATE_GENERATOR_PYTHON to a Python executable that has docxtpl and python-docx installed.',
  ].join(' ')
}

export function formatEstateGeneratorExecError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("No module named 'docxtpl'") || message.includes('No module named docxtpl')) {
    return dependencyErrorMessage()
  }
  return message
}
