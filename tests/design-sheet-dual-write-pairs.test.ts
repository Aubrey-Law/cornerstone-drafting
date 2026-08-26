import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { draftPayloadTrustProvisions } from '@/lib/draftPayload/trustProvisions'
import { setTrustDetails } from '@/lib/designSheetTrustDetails'

/**
 * Three trust answers are stored twice — once in `decisions.trust_details`, once
 * in a legacy design-sheet column — and `draftPayloadTrustProvisions` OR-merges
 * the pair. An OR cannot tell "nobody answered" from "answered no", so whenever
 * the two halves disagree the `include` side wins silently.
 *
 * That is only safe while every control reads and writes BOTH halves. #344 was
 * what happens when one does not: the will section's no-contest row read and
 * wrote the column alone, so ticking the trust checkbox and then setting the
 * will to Omit left the sheet showing "Omit" on a will that drafted the clause
 * — no `[[ MISSING ]]` marker and no readiness blocker, because both stores
 * held a real value and merely disagreed.
 *
 * These tests pin the invariant rather than the two instances of it.
 */
const DUAL_WRITE_PAIRS = [
  { namespaceKey: 'include_substance_abuse', column: 'provision_substance_abuse' },
  { namespaceKey: 'include_creditor_divorce_provisions', column: 'provision_married_beneficiary' },
  { namespaceKey: 'include_no_contest_clause', column: 'no_contest_clause' },
] as const

const SECTIONS_DIR = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections')

/** The two control components an attorney answers one of these questions with. */
const CONTROL_TAG = /<(?:DecisionRow|DesignSheetCheckboxOption)\b/g

function mentions(source: string, identifier: string): boolean {
  // `\b` keeps `no_contest_clause` from matching inside
  // `include_no_contest_clause` or `name_people_in_no_contest_clause`.
  return new RegExp(`\\b${identifier}\\b`).test(source)
}

/** Split a section file into one chunk per control, so pairing is checked per question. */
function controlChunks(source: string): string[] {
  const starts = Array.from(source.matchAll(CONTROL_TAG), match => match.index)
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length))
}

describe('trust provision dual-write pairs', () => {
  it('knows about every OR-merged pair in draftPayloadTrustProvisions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/trustProvisions.ts'), 'utf8')
    const body = source.slice(source.indexOf('export function draftPayloadTrustProvisions'))
    const merged = Array.from(body.matchAll(/details\.(\w+)\s*\|\|/g), match => match[1]).sort()

    expect(
      merged,
      'a namespace flag is OR-merged with a legacy column that DUAL_WRITE_PAIRS does not list — add it here so its controls get checked too',
    ).toEqual(DUAL_WRITE_PAIRS.map(pair => pair.namespaceKey).sort())
  })

  it('reads and writes both halves in every control that touches one', () => {
    const unpaired: string[] = []

    for (const fileName of fs.readdirSync(SECTIONS_DIR).filter(name => name.endsWith('.tsx')).sort()) {
      const source = fs.readFileSync(path.join(SECTIONS_DIR, fileName), 'utf8')
      for (const chunk of controlChunks(source)) {
        for (const { namespaceKey, column } of DUAL_WRITE_PAIRS) {
          const hasKey = mentions(chunk, namespaceKey)
          const hasColumn = mentions(chunk, column)
          if (hasKey === hasColumn) continue
          unpaired.push(
            `${fileName}: a control touches ${hasKey ? namespaceKey : column} but not ${hasKey ? column : namespaceKey} — ${chunk.trim().split('\n')[0].slice(0, 100)}`,
          )
        }
      }
    }

    expect(
      unpaired,
      'a control reads or writes one half of a dual-write pair — the design sheet will show one answer while the document drafts the other',
    ).toEqual([])
  })

  it('resolves a disagreeing pair to include, which is why pairing matters', () => {
    // Not a bug to fix — the documented consequence the pairing above prevents.
    const ticked = { decisions: setTrustDetails({ decisions: {} }, { include_no_contest_clause: true }) }
    const disagreeing = { ...ticked, no_contest_clause: 'omit' as const }

    expect(draftPayloadTrustProvisions(disagreeing).include_no_contest_clause).toBe(true)
    expect(draftPayloadTrustProvisions({ ...ticked, no_contest_clause: 'include' as const }).include_no_contest_clause).toBe(true)

    const agreed = {
      decisions: setTrustDetails({ decisions: {} }, { include_no_contest_clause: false }),
      no_contest_clause: 'omit' as const,
    }
    expect(draftPayloadTrustProvisions(agreed).include_no_contest_clause).toBe(false)
  })
})
