import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { allEngagementAnchorMarkers, engagementAnchorMarkers } from '@/lib/engagement/anchors'

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

const TEMPLATE = 'assets/engagement-agreements/ep-trust-couple-v1.docx'

/** Every `[[MARKER]]` in the template's body, deduplicated. */
function markersInTemplate(): Set<string> {
  // Same loader the renderer uses (lib/engagement/render.ts), so this reads the
  // document exactly as production does rather than through a second mechanism.
  const zip = new PizZip(fs.readFileSync(path.join(process.cwd(), TEMPLATE)))
  const xml = zip.file('word/document.xml')!.asText()
  return new Set(xml.match(/\[\[[A-Z0-9_]+\]\]/g) ?? [])
}

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

  it('derives exactly the markers the shipped template contains', () => {
    // Equal as sets in both directions: this fails if the template drops a
    // marker *and* if the code starts expecting one the template never had.
    const inTemplate = markersInTemplate()
    const derived = new Set(allEngagementAnchorMarkers(2))
    expect([...derived].sort()).toEqual([...inTemplate].sort())
  })

  it('has no role-named marker for the spouse', () => {
    // The spouse is CLIENT_2. A `[[SPOUSE_*]]` marker exists in no template, so
    // a role-based prefix resolves to nothing and the spouse cannot sign at all.
    // This is the exact regression that shipped and had to be fixed.
    const inTemplate = markersInTemplate()
    expect([...inTemplate].filter(m => m.includes('SPOUSE'))).toEqual([])
    expect(inTemplate.has('[[CLIENT_2_SIGNATURE]]')).toBe(true)
    expect(inTemplate.has('[[CLIENT_2_DATE]]')).toBe(true)
  })

  it('covers both signers of a couple agreement and nothing more', () => {
    expect(allEngagementAnchorMarkers(1)).toHaveLength(2)
    expect(allEngagementAnchorMarkers(2)).toHaveLength(4)
    expect(allEngagementAnchorMarkers(0)).toEqual([])
  })
})
