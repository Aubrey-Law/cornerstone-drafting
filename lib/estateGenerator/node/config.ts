import fs from 'node:fs'
import path from 'node:path'
import { normalizeJurisdictionStateCode } from '@/lib/jurisdictionState'
import { resolveEstateGeneratorRoot } from '@/lib/estateGenerator/runtime'
import type { NodeEstatePackageConfig, NodeEstatePackageName, NodeEstateStateRules } from '@/lib/estateGenerator/node/types'

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

export function resolveNodeEstateGeneratorRoot(cwd = process.cwd(), env = process.env): string {
  return resolveEstateGeneratorRoot(cwd, env)
}

export function loadNodeEstatePackage(
  packageName: NodeEstatePackageName,
  root = resolveNodeEstateGeneratorRoot(),
): NodeEstatePackageConfig {
  return readJsonFile<NodeEstatePackageConfig>(path.join(root, 'packages', `${packageName}.json`))
}

export function loadNodeEstateStateRules(
  state: string,
  root = resolveNodeEstateGeneratorRoot(),
): NodeEstateStateRules {
  const stateCode = normalizeJurisdictionStateCode(state, 'MA')
  const candidates = new Set<string>([stateCode, 'MA'])

  for (const candidate of candidates) {
    const rulesPath = path.join(root, 'states', candidate, 'rules.json')
    if (fs.existsSync(rulesPath)) {
      return readJsonFile<NodeEstateStateRules>(rulesPath)
    }
  }

  return { state: stateCode }
}
