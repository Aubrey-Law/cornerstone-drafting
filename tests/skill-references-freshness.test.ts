import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SKILL_GENERATED_DIR,
  buildSkillReferenceFiles,
} from '../scripts/generate-doc-template-skill-references'

// The doc-template skill bundles reference files generated from the code
// (data dictionary, merge context, package manifests, clauses, design map).
// This test regenerates them in memory and diffs against the checked-in
// copies, so a change to any of those sources without `npm run skill:refs`
// fails CI instead of shipping a stale skill.
describe('doc-template skill references', () => {
  const generated = buildSkillReferenceFiles()
  const outDir = path.join(process.cwd(), SKILL_GENERATED_DIR)

  it('has no checked-in files the generator no longer produces', () => {
    const checkedIn = fs.readdirSync(outDir).filter(name => name.endsWith('.md'))
    expect(checkedIn.sort()).toEqual(Object.keys(generated).sort())
  })

  for (const name of Object.keys(buildSkillReferenceFiles())) {
    it(`${name} is fresh — regenerate with \`npm run skill:refs\``, () => {
      const checkedIn = fs.readFileSync(path.join(outDir, name), 'utf8')
      expect(checkedIn).toBe(generated[name])
    })
  }
})
