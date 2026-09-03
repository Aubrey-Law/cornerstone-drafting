import fs from 'node:fs'
import path from 'node:path'

/**
 * Example payloads whose file name does not match the package name exactly.
 * Shared by `estate:render` and the golden-corpus tooling so the two cannot
 * disagree about which payload a package renders from — a disagreement would
 * make the corpus guard a different document than the one QA looks at.
 */
export const EXAMPLE_ALIASES: Record<string, string> = {
  'pourover-will': 'client-ma-pourover.json',
  'spouse-pourover-will': 'client-ma-pourover.json',
  'incapacity-documents': 'client-ma-incapacity.json',
  'spouse-incapacity-documents': 'client-ma-incapacity.json',
  'indv-disclaimer-trust': 'client-ma-disclaimer-trust.json',
  'assignment-of-personal-property': 'client-ma-assignment-pp.json',
  'temporary-delegation-parental-powers': 'client-ma-temp-delegation.json',
  'college-financial-poa': 'client-ma-college-prep.json',
  'college-education-poa': 'client-ma-college-prep.json',
  'college-health-care-documents': 'client-ma-college-prep.json',
  'college-advance-directive': 'client-ma-college-prep.json',
}

export function listEstatePackageNames(root: string): string[] {
  return fs
    .readdirSync(path.join(root, 'packages'))
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace(/\.json$/, ''))
    .sort()
}

/** Path of the example payload a package renders from, or null when none exists. */
export function findExamplePath(root: string, packageName: string): string | null {
  const candidates = [
    `client-ma-${packageName}.json`,
    EXAMPLE_ALIASES[packageName],
    'client.json',
  ].filter((name): name is string => Boolean(name))
  for (const candidate of candidates) {
    const candidatePath = path.join(root, 'examples', candidate)
    if (fs.existsSync(candidatePath)) return candidatePath
  }
  return null
}
