import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildStatularExportMarkdown } from '@/lib/designSheet/statularExport'
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

    expect(md).toContain('- Marital Trust: Qualified Terminable Interest Property Trust (QTIP)')
    expect(md).toContain('- Marital Trust Invasion Powers: "5 by 5" Invasion Power')
    expect(md).toContain('- QTIP Remainder Power of Appointment: Limited testamentary power')
    expect(md).toContain('- Include QDOT Language: Yes')
    expect(md).toContain('- Bypass Trust: Bypass/Credit-Shelter Trust (A/B)')
    expect(md).toContain('- Bypass Trust Formula: Fixed Amount')
    expect(md).toContain('- Bypass Trust Power of Appointment: No appointment power')
    expect(md).toContain('- Allow Discretionary Sprinkling: Yes')
    // Money and percentages carry their unit, so the extractor cannot read
    // 2000000 as a percentage or 40 as dollars.
    expect(md).toContain('- Fixed Amount: $2,000,000')
    expect(md).toContain('- Percentage: 40%')
  })

  it('omits questions nobody answered rather than printing a default', () => {
    // getTrustDetails would report `false` for both booleans here. Printing
    // "Include QDOT Language: No" would tell Statular the attorney declined it.
    const md = buildStatularExportMarkdown(sheet({
      decisions: trustDetails({ marital_trust: 'qtip' }),
    }), CONTEXT)

    expect(md).toContain('- Marital Trust: Qualified Terminable Interest Property Trust (QTIP)')
    expect(md).not.toContain('Include QDOT Language')
    expect(md).not.toContain('Allow Discretionary Sprinkling')
    expect(md).not.toContain('Bypass Trust Formula')
  })

  it('leaves the marital block out of a plan that does not divide at the first death', () => {
    // A leftover answer from an earlier structure must not tell Statular to
    // build a trust this plan no longer has.
    const md = buildStatularExportMarkdown(sheet({
      is_joint: false,
      decisions: trustDetails({ marital_trust: 'qtip' }, 'outright_to_spouse'),
    }), CONTEXT)

    expect(md).not.toContain('Trusts for Survivor')
    expect(md).not.toContain('Qualified Terminable Interest Property Trust')
  })

  it('keeps the marital block for a joint trust whatever the spousal funding says', () => {
    const md = buildStatularExportMarkdown(sheet({
      is_joint: true,
      decisions: trustDetails({ bypass_trust: 'disclaimer' }, 'outright_to_spouse'),
    }), CONTEXT)

    expect(md).toContain('- Bypass Trust: Disclaimer Trust (contingent, funded only by a disclaimer)')
  })

  it('carries the signing details the import registry deliberately omits', () => {
    const md = buildStatularExportMarkdown(sheet({
      signing_date: '2026-09-15',
      signing_county: 'Middlesex',
      notary_commission_expiration: '2029-03-01',
    }), CONTEXT)

    expect(md).toContain('_Statular: Signing Information_')
    expect(md).toContain('- Signing date: 2026-09-15')
    expect(md).toContain('- Signing county: Middlesex')
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

    expect(md).toContain('- Restatement: Yes')
    expect(md).toContain('- Co-trustee decision standard: Independent')
    // Database ids mean nothing to a reader or an extractor.
    expect(md).toContain('- Children: Name: Lily Chen, Dob: 2012-04-02')
    expect(md).not.toContain('row-1')
  })

  it('emits nothing but the header for an empty sheet', () => {
    const md = buildStatularExportMarkdown(
      { decisions: {} } as unknown as DesignSheet,
      { clientName: null, spouseName: null, matterNumber: null, exportedOn: '2026-08-30' },
    )
    expect(md).toContain('# Estate Plan Design Sheet — Client')
    expect(md).not.toContain('## Trust\n')
    expect(md).not.toContain('## Signing and Execution')
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
    expect(read('app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'))
      .toContain('onExportStatular={handleExportStatular}')
  })
})
