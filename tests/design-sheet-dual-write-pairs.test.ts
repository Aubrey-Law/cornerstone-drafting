import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DUAL_WRITE_PROVISIONS,
  dualWriteProvisionWriter,
  readDualWriteProvision,
  type DualWriteProvision,
} from '@/lib/designSheet/dualWriteProvisions'
import { draftPayloadTrustProvisions } from '@/lib/draftPayload/trustProvisions'
import { getTrustDetails, setTrustDetails } from '@/lib/designSheetTrustDetails'

/**
 * Three trust answers live in both `decisions.trust_details` and a legacy
 * design-sheet column, merged with an OR. An OR cannot tell "nobody answered"
 * from "answered no", so a control that touches one half alone leaves the two
 * disagreeing — and the `include` side wins silently, with both stores holding
 * real values so nothing raises a `[[ MISSING ]]` marker or a readiness
 * blocker. #344 was that reaching a signed will.
 *
 * `lib/designSheet/dualWriteProvisions.ts` now owns both halves. These tests
 * keep it that way: nothing else may read or write a half, and the reader the
 * UI shows must be the same one the generator drafts from.
 */
const SECTIONS_DIR = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections')
const PROVISIONS = Object.keys(DUAL_WRITE_PROVISIONS) as DualWriteProvision[]

function mentions(source: string, identifier: string): boolean {
  // `\b` keeps `no_contest_clause` from matching inside
  // `include_no_contest_clause` or `name_people_in_no_contest_clause`.
  return new RegExp(`\\b${identifier}\\b`).test(source)
}

describe('trust provision dual-write pairs', () => {
  it('is the only thing that touches either half from a design-sheet section', () => {
    const offenders: string[] = []

    for (const fileName of fs.readdirSync(SECTIONS_DIR).filter(name => name.endsWith('.tsx')).sort()) {
      const source = fs.readFileSync(path.join(SECTIONS_DIR, fileName), 'utf8')
      for (const provision of PROVISIONS) {
        const { namespaceKey, column } = DUAL_WRITE_PROVISIONS[provision]
        for (const half of [namespaceKey, column]) {
          if (mentions(source, half)) offenders.push(`${fileName} references ${half}`)
        }
      }
    }

    expect(
      offenders,
      'a section reads or writes one half of a dual-write pair directly — use readDualWriteProvision / dualWriteProvisionWriter so both halves move together',
    ).toEqual([])
  })

  it('leaves no second copy of the merge in draftPayloadTrustProvisions', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/draftPayload/trustProvisions.ts'), 'utf8')
    const body = source.slice(source.indexOf('export function draftPayloadTrustProvisions'))
    const inlineMerges = Array.from(body.matchAll(/details\.(\w+)\s*\|\|/g), match => match[1])

    expect(
      inlineMerges,
      'a namespace flag is OR-merged with a legacy column inline — move the pair into DUAL_WRITE_PROVISIONS so the UI reads the same merge',
    ).toEqual([])
    for (const provision of PROVISIONS) {
      expect(body).toContain(`readDualWriteProvision(sheet, '${provision}')`)
    }
  })

  it('writes both halves from a single call', () => {
    for (const provision of PROVISIONS) {
      const { column, encode } = DUAL_WRITE_PROVISIONS[provision]
      for (const enabled of [true, false]) {
        const calls: Array<[string, unknown]> = []
        dualWriteProvisionWriter(((key: string, value: unknown) => {
          calls.push([key, value])
        }) as never)(provision, enabled)

        expect(calls.map(([key]) => key), `${provision} must write both halves`).toEqual(['decisions', column])
        expect(calls[1][1]).toBe(encode(enabled))

        // The `decisions` half is an updater; run it and confirm the namespace moved too.
        const updater = calls[0][1] as (previous: { decisions: unknown }) => unknown
        const decisions = updater({ decisions: {} })
        expect(readDualWriteProvision({ decisions, [column]: encode(enabled) } as never, provision)).toBe(enabled)
      }
    }
  })

  it('shows the attorney exactly what the generator drafts', () => {
    // Every combination the two halves can be in, including the disagreements
    // that only arise from legacy data now that a single writer owns both.
    for (const namespace of [true, false]) {
      for (const columnValue of ['include', 'omit', null]) {
        const sheet = {
          decisions: setTrustDetails({ decisions: {} }, { include_no_contest_clause: namespace }),
          no_contest_clause: columnValue,
        }

        expect(
          readDualWriteProvision(sheet as never, 'no_contest'),
          `namespace=${namespace} column=${columnValue}: the sheet and the generator must agree`,
        ).toBe(draftPayloadTrustProvisions(sheet as never).include_no_contest_clause)
      }
    }
  })

  it('keeps a pre-namespace matter answered', () => {
    // The legacy column is the only half an old matter carries; dropping it
    // would silently turn every one of these answers off.
    const legacyOnly = { decisions: {}, provision_substance_abuse: 'yes' }

    expect(getTrustDetails(legacyOnly).include_substance_abuse).toBe(false)
    expect(readDualWriteProvision(legacyOnly as never, 'substance_abuse')).toBe(true)
    expect(draftPayloadTrustProvisions(legacyOnly as never).include_substance_abuse).toBe(true)
  })
})
