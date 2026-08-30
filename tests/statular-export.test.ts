import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildStatularExportMarkdown } from '@/lib/designSheet/statularExport'
import {
  STATULAR_INTERVIEW,
  STATULAR_MAPPED_FIELDS,
} from '@/lib/designSheet/statularInterviewMap'
import { DESIGN_SHEET_DECISION_FIELDS } from '@/lib/designSheetImport/decisionFields'
import { getDesignSheetImportFieldMeta } from '@/lib/designSheetImport/shared'
import type { DesignSheet } from '@/types/database'

const CONTEXT = {
  clientName: 'Jie Chen',
  spouseName: 'Zilong Wang',
  matterNumber: 'EP-2026-14',
  exportedOn: '2026-08-30',
}

function sheet(overrides: Record<string, unknown> = {}): DesignSheet {
  return {
    client_name: 'Jie Chen',
    spouse_name: 'Zilong Wang',
    marital_status: 'married',
    is_joint: true,
    decisions: {},
    ...overrides,
  } as unknown as DesignSheet
}

function trustDetails(details: Record<string, unknown>, planningType = 'in_trust_for_spouse') {
  return { trust_planning_type: planningType, trust_details: details }
}

describe('statular export', () => {
  it("renders the marital and bypass answers in Statular's own wording", () => {
    const md = buildStatularExportMarkdown(sheet({
      decisions: trustDetails({
        marital_trust: 'qtip',
        marital_trust_invasion: 'five_by_five',
        marital_trust_remainder_power: 'limited_testamentary',
        marital_trust_include_qdot: true,
        bypass_trust: 'bypass',
        bypass_trust_formula: 'fixed_amount',
        bypass_trust_fixed_amount: 2000000,
        bypass_trust_percentage: 40,
        bypass_trust_remainder_power: 'none',
        bypass_trust_allow_sprinkling: true,
      }),
    }), CONTEXT)

    expect(md).toContain('- Type of Marital Trust: QTIP (Qualified Terminable Interest Property Trust)')
    expect(md).toContain('- Marital Trust Invasion Powers: "5 by 5" Invasion Power')
    expect(md).toContain('- QTIP Remainder Power of Appointment: Limited testamentary power')
    expect(md).toContain('- Include QDOT language: Yes')
    expect(md).toContain('- Type of Bypass Trust: Bypass/Credit-Shelter Trust')
    expect(md).toContain('- Bypass Trust Formula: Fixed Amount')
    expect(md).toContain('- Bypass Trust Power of Appointment: No appointment power')
    expect(md).toContain('- Should the Bypass Trust sprinkle to children/grandchildren?: Yes')
    // Money and percentages carry their unit, so the extractor cannot read
    // 2000000 as a percentage or 40 as dollars.
    expect(md).toContain('- Bypass Trust — Fixed Amount: $2,000,000')
    expect(md).toContain('- Bypass Trust — Percentage: 40%')
  })

  it('omits questions nobody answered rather than printing a default', () => {
    // getTrustDetails would report `false` for both booleans here. Printing
    // "Include QDOT Language: No" would tell Statular the attorney declined it.
    const md = buildStatularExportMarkdown(sheet({
      decisions: trustDetails({ marital_trust: 'qtip' }),
    }), CONTEXT)

    expect(md).toContain('- Type of Marital Trust: QTIP (Qualified Terminable Interest Property Trust)')
    expect(md).not.toContain('Include QDOT Language')
    expect(md).not.toContain('sprinkle to children/grandchildren')
    expect(md).not.toContain('Bypass Trust Formula')
  })

  it('leaves the marital block out of a plan that does not divide at the first death', () => {
    // A leftover answer from an earlier structure must not tell Statular to
    // build a trust this plan no longer has.
    const md = buildStatularExportMarkdown(sheet({
      is_joint: false,
      decisions: trustDetails({ marital_trust: 'qtip' }, 'outright_to_spouse'),
    }), CONTEXT)

    expect(md).not.toContain('Trust(s) for Spouse')
    expect(md).not.toContain('Qualified Terminable Interest Property Trust')
  })

  it('keeps the marital block for a joint trust whatever the spousal funding says', () => {
    const md = buildStatularExportMarkdown(sheet({
      is_joint: true,
      decisions: trustDetails({ bypass_trust: 'disclaimer' }, 'outright_to_spouse'),
    }), CONTEXT)

    expect(md).toContain('- Type of Bypass Trust: Disclaimer Trust')
  })

  it('carries the signing details the import registry deliberately omits', () => {
    const md = buildStatularExportMarkdown(sheet({
      signing_date: '2026-09-15',
      signing_county: 'Middlesex',
      notary_commission_expiration: '2029-03-01',
    }), CONTEXT)

    expect(md).toContain('## Page 25 — Signing Information')
    expect(md).toContain('- Signing Date: 2026-09-15')
    expect(md).toContain('- Signing County: Middlesex')
    expect(md).toContain('- Notary commission expiration: 2029-03-01')
  })

  it('names the matter and says what the file is', () => {
    const md = buildStatularExportMarkdown(sheet(), CONTEXT)
    expect(md).toContain('# Estate Plan Design Sheet — Jie Chen')
    expect(md).toContain('matter EP-2026-14')
    expect(md).toContain('for import into Statular')
    expect(md).toContain('- Trust structure: Joint trust')
  })

  it('formats booleans, enums and record lists readably', () => {
    const md = buildStatularExportMarkdown(sheet({
      restatement: true,
      children: [{ id: 'row-1', name: 'Lily Chen', dob: '2012-04-02' }],
      decisions: { trust_details: { co_trustee_decision: 'independent' } },
    }), CONTEXT)

    expect(md).toContain('- Is this a restatement of an existing trust?: Yes')
    expect(md).toContain('- If either trust ever has co-trustees, how should they decide?: Co-trustees may act separately (single signature sufficient)')
    // Database ids mean nothing to a reader or an extractor.
    expect(md).toContain('- Children list: Name: Lily Chen, Dob: 2012-04-02')
    expect(md).not.toContain('row-1')
  })

  it('emits nothing but the header for an empty sheet', () => {
    const md = buildStatularExportMarkdown(
      { decisions: {} } as unknown as DesignSheet,
      { clientName: null, spouseName: null, matterNumber: null, exportedOn: '2026-08-30' },
    )
    expect(md).toContain('# Estate Plan Design Sheet — Client')
    expect(md).not.toContain('## Page 5')
    expect(md).not.toContain('## Page 25')
    expect(md).not.toContain('## Additional answers')
  })
})

describe('statular interview map', () => {
  it('names only design-sheet fields that exist', () => {
    // The map is meant to be supplemented by hand from
    // docs/integrations/statular-interview-map.md. A typo'd or renamed field
    // would silently export nothing, so it fails here instead.
    const extraColumns = new Set([
      'signing_date', 'signing_month', 'signing_year', 'signing_county',
      'notary_commission_expiration', 'decisions.trust_planning_type',
    ])
    const unknown = [...STATULAR_MAPPED_FIELDS].filter(field => (
      !extraColumns.has(field) && getDesignSheetImportFieldMeta(field) === null
    ))
    expect(unknown, 'map entries naming fields the design sheet does not have').toEqual([])
  })

  it('asks each question once', () => {
    const seen = new Map<string, number>()
    for (const group of STATULAR_INTERVIEW) {
      for (const question of group.questions) {
        seen.set(question.field, (seen.get(question.field) ?? 0) + 1)
      }
    }
    // `state` is deliberately asked twice — Family Information and Signing
    // Information both want it. Everything else appearing twice is a mistake.
    const duplicated = [...seen.entries()].filter(([field, count]) => count > 1 && field !== 'state')
    expect(duplicated).toEqual([])
  })

  it('offers Statular wording for every value of the options it maps', () => {
    for (const group of STATULAR_INTERVIEW) {
      for (const question of group.questions) {
        if (!question.options) continue
        const meta = getDesignSheetImportFieldMeta(question.field)
        const registryOptions = meta?.options
        if (!registryOptions) continue
        const missing = registryOptions.filter(value => !(value in question.options!))
        expect(missing, `${question.question} is missing wording for some stored values`).toEqual([])
      }
    }
  })

  it('carries an unmapped answer through the fallback rather than dropping it', () => {
    // Pick a real registry field the map has not reached, and prove it exports.
    const unmapped = Object.keys(DESIGN_SHEET_DECISION_FIELDS)
      .find(field => !STATULAR_MAPPED_FIELDS.has(field) && field.startsWith('trust_details.'))
    expect(unmapped).toBeDefined()

    const key = unmapped!.slice('trust_details.'.length)
    const md = buildStatularExportMarkdown(
      sheet({ decisions: { trust_details: { [key]: true } } }),
      CONTEXT,
    )
    expect(md).toContain('## Additional answers')
    expect(md).toContain(getDesignSheetImportFieldMeta(unmapped!)!.label)
  })
})

describe('statular export wiring', () => {
  it('is reachable from the export route, the hook, and the toolbar', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

    expect(read('app/api/admin/matters/[id]/design-sheet/export/route.ts'))
      .toContain("if (format === 'statular')")
    expect(read('lib/designSheet/useDesignSheetState.ts'))
      .toContain("exportDesignSheet('statular')")
    expect(read('components/guided/DesignToolbarActions.tsx'))
      .toContain('Export for Statular (.md)')
    expect(fs.existsSync(path.join(process.cwd(), 'docs/integrations/statular-interview-map.md')))
      .toBe(true)
    expect(read('app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'))
      .toContain('onExportStatular={handleExportStatular}')
  })
})
