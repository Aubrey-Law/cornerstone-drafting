import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { allEngagementAnchorMarkers, engagementAnchorMarkers } from '@/lib/engagement/anchors'
import { ENGAGEMENT_TEMPLATES } from '@/lib/engagement/templates'

/**
 * The template is the contract.
 *
 * Two code paths address the signature fields by marker: the send path tells the
 * provider where they are, and the signing path stamps them. Both derive the
 * marker names rather than reading them from the document, so nothing stops them
 * drifting away from what the template actually contains — or away from each
 * other. That drift is invisible until a client has already consented and drawn
 * their signature, which is the worst possible moment to discover it.
 *
 * These read the real shipped template and pin the derivation against it, so the
 * mismatch surfaces in CI instead of in front of a client. No conversion, no
 * LibreOffice, no database — just the bytes in the repository.
 */

/** Every `[[MARKER]]` in a template's body, deduplicated. */
function markersInTemplate(bundledPath: string): Set<string> {
  // Same loader the renderer uses (lib/engagement/render.ts), so this reads the
  // document exactly as production does rather than through a second mechanism.
  const zip = new PizZip(fs.readFileSync(path.join(process.cwd(), bundledPath)))
  const xml = zip.file('word/document.xml')!.asText()
  return new Set(xml.match(/\[\[[A-Z0-9_]+\]\]/g) ?? [])
}

const templates = ENGAGEMENT_TEMPLATES.map(template => [template.masterKey, template] as const)

describe('engagement anchor markers', () => {
  it('numbers recipients by position, never by role', () => {
    expect(engagementAnchorMarkers(1)).toEqual({
      signature: '[[CLIENT_1_SIGNATURE]]',
      date: '[[CLIENT_1_DATE]]',
    })
    expect(engagementAnchorMarkers(2)).toEqual({
      signature: '[[CLIENT_2_SIGNATURE]]',
      date: '[[CLIENT_2_DATE]]',
    })
  })

  it.each(templates)('derives exactly the markers %s ships with', (_key, template) => {
    // Equal as sets in both directions: this fails if the template drops a
    // marker *and* if the code starts expecting one the template never had.
    const inTemplate = markersInTemplate(template.bundledPath)
    const derived = new Set(allEngagementAnchorMarkers(template.recipientCount))
    expect([...derived].sort()).toEqual([...inTemplate].sort())
  })

  it.each(templates)('gives %s no role-named marker for the spouse', (_key, template) => {
    // The spouse is CLIENT_2. A `[[SPOUSE_*]]` marker exists in no template, so
    // a role-based prefix resolves to nothing and the spouse cannot sign at all.
    // This is the exact regression that shipped and had to be fixed.
    const inTemplate = markersInTemplate(template.bundledPath)
    expect([...inTemplate].filter(m => m.includes('SPOUSE'))).toEqual([])
    // Where there is a second signer at all, they are CLIENT_2 — and where
    // there is not, no CLIENT_2 marker is left behind for nobody to sign.
    const hasSecondSigner = template.recipientCount > 1
    expect(inTemplate.has('[[CLIENT_2_SIGNATURE]]')).toBe(hasSecondSigner)
    expect(inTemplate.has('[[CLIENT_2_DATE]]')).toBe(hasSecondSigner)
  })

  it.each(templates)('ships %s with a master file the registry offers', (_key, template) => {
    expect(fs.existsSync(path.join(process.cwd(), template.bundledPath))).toBe(true)
  })

  it('covers both signers of a couple agreement and nothing more', () => {
    expect(allEngagementAnchorMarkers(1)).toHaveLength(2)
    expect(allEngagementAnchorMarkers(2)).toHaveLength(4)
    expect(allEngagementAnchorMarkers(0)).toEqual([])
  })
})
