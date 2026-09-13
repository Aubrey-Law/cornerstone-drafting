import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { partitionImportableFields } from '@/lib/designSheet/applyProposal'

const source = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const PROPOSE = 'app/api/addin/matters/[id]/design-sheet/propose/route.ts'
const APPLY = 'app/api/addin/matters/[id]/design-sheet/apply/route.ts'

/**
 * Write-back from the Word pane to the design sheet.
 *
 * The design sheet is the firm's authoritative record of what the client
 * decided, and this is the first path that writes it from outside the web app.
 * What these pin is the separation that makes that safe: one route reads and
 * proposes, a different one writes, and it writes only fields a review UI could
 * have shown.
 */
describe('what the pane is allowed to write', () => {
  it('passes through the fields the extractor can propose', () => {
    const { fields, refused } = partitionImportableFields({
      trustee_primary: 'Dana Ellis',
      guardian_primary: 'Sam Reyes',
      'trust_details.representation_type': 'per_stirpes',
    })

    expect(fields).toEqual({
      trustee_primary: 'Dana Ellis',
      guardian_primary: 'Sam Reyes',
      'trust_details.representation_type': 'per_stirpes',
    })
    expect(refused).toEqual([])
  })

  it('refuses anything outside that set', () => {
    // A field nobody reviewed heading for a column nobody was shown. `id` and
    // `matter_id` are the ones that would do real damage.
    const { fields, refused } = partitionImportableFields({
      trustee_primary: 'Dana Ellis',
      id: 'other-sheet',
      matter_id: 'other-matter',
      version: 99,
      not_a_field: true,
    })

    expect(fields).toEqual({ trustee_primary: 'Dana Ellis' })
    expect(refused).toEqual(['id', 'matter_id', 'version', 'not_a_field'])
  })

  it('reports a refusal rather than dropping it', () => {
    // Silently ignoring a field the caller asked to write would report success
    // for a change that did not happen.
    expect(source(APPLY)).toContain('refused.length > 0')
    expect(source(APPLY)).toContain('status: 400')
  })

  it('never applies a fiduciary proposal from the pane', () => {
    // Accepting one can mint a contacts row — creating a person in the firm's
    // records from a Word pane, without the matching UI the web dialog has.
    expect(source(APPLY)).toContain('fiduciaries: []')
  })
})

describe('proposing is separate from writing', () => {
  it('the propose route writes nothing', () => {
    const route = source(PROPOSE)
    expect(route).not.toContain('applyDesignSheetProposal')
    expect(route).not.toContain(".from('design_sheets')")
    expect(route).not.toContain('.update(')
  })

  it('both routes gate themselves, having no middleware backstop', () => {
    // /api/addin/* sits outside proxy.ts's cookie-only matcher.
    for (const route of [PROPOSE, APPLY]) {
      expect(source(route)).toContain('requireAdmin(req)')
      expect(source(route)).toMatch(/if \(auth\.err\) return auth\.err/)
    }
  })

  it('the proposal carries the token its own read was built from', () => {
    // The compare-and-swap is only worth anything if the `updated_at` handed
    // back belongs to the sheet the preview's "current" column was built from.
    // Reading it after the extraction would leave a window where the sheet
    // changed and the token still looked fresh.
    const route = source(PROPOSE)
    const readAt = route.indexOf('loadCurrentDesignSheet')
    const extractAt = route.indexOf('parseDesignSheetImportText({')
    expect(readAt).toBeGreaterThan(-1)
    expect(extractAt).toBeGreaterThan(readAt)
  })

  it('the apply route sends that token back as the compare-and-swap', () => {
    expect(source(APPLY)).toContain('expectedUpdatedAt')
    expect(source(APPLY)).toContain('conflict')
  })
})
