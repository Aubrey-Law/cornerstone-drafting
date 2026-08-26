/**
 * Report which captured design-sheet answers actually reach a signed document:
 *   npx tsx scripts/report-design-answer-coverage.ts
 *
 * The template-variable catalog answers "does anything populate what this
 * template reads?". This answers the opposite question — the design sheet
 * captures a decision and the worksheet prints it back for review, but does
 * any document a client signs act on it?
 *
 * Read-only: prints a summary and always exits zero. The gate that fails a
 * build lives in tests/template-variable-catalog.test.ts, and covers
 * trust.provisions.* only — see the caveat below.
 */
import { buildDesignAnswerCoverage } from '@/lib/estateGenerator/templateVariables'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'

const coverage = buildDesignAnswerCoverage(resolveNodeEstateGeneratorRoot())
const total = coverage.drafted.length + coverage.worksheetOnly.length + coverage.unreferenced.length

function rootOf(dataPath: string): string {
  return dataPath.split('.')[0].replace(/\[\]$/, '')
}

function tally(paths: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const dataPath of paths) counts.set(rootOf(dataPath), (counts.get(rootOf(dataPath)) ?? 0) + 1)
  return counts
}

const draftedByRoot = tally(coverage.drafted)
const gapByRoot = tally(coverage.worksheetOnly.concat(coverage.unreferenced))

console.log(`Documented data-dictionary paths: ${total}`)
console.log(`  read by a drafted document:     ${coverage.drafted.length}`)
console.log(`  printed on a worksheet only:    ${coverage.worksheetOnly.length}`)
console.log(`  referenced by no template:      ${coverage.unreferenced.length}`)
console.log()
console.log('By root (drafted / total):')

for (const name of Array.from(new Set([...draftedByRoot.keys(), ...gapByRoot.keys()])).sort()) {
  const drafted = draftedByRoot.get(name) ?? 0
  const rootTotal = drafted + (gapByRoot.get(name) ?? 0)
  const flag = drafted === 0 ? '  <- nothing drafted' : ''
  console.log(`  ${name.padEnd(22)} ${String(drafted).padStart(3)} / ${String(rootTotal).padEnd(3)}${flag}`)
}

console.log()
console.log(
  'Caveat: the generator also derives boolean context flags from answers\n' +
  '(hcp_anatomical_all, college_life_support_comfort_only, uses_revocable_trust).\n' +
  'A template reading one of those consumes the answer without naming its path,\n' +
  'so these gap counts are an upper bound for any root that has such flags.\n' +
  'They are exact for trust.provisions.*, which buildNodeEstateContext never reads.',
)
