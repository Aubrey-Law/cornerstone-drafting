import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { previewMilestoneAmounts } from '@/components/billing/AttachFeeScheduleDialog'
import type { ServicePackageOption } from '@/lib/billing/schedules'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

function pkg(...bps: (number | null)[]): ServicePackageOption {
  return {
    id: 'package',
    name: 'Test package',
    practiceArea: 'EP',
    billingStrategy: 'fixed_milestones',
    milestones: bps.map((percentageBps, position) => ({
      label: `Milestone ${position + 1}`,
      percentageBps,
      position,
    })),
  }
}

describe('fee schedule attach preview', () => {
  // The preview is only trustworthy if it allocates exactly as
  // create_matter_fee_schedule does; a mismatch would quote the client one
  // split and bill another.
  it('splits an even 50/50 fee across two milestones', () => {
    expect(previewMilestoneAmounts(pkg(5000, 5000), 350_000)).toEqual([175_000, 175_000])
  })

  it('floors each share and puts the remainder on the last milestone', () => {
    // Thirds of $100 leave a cent that must land somewhere, not vanish.
    expect(previewMilestoneAmounts(pkg(3333, 3333, 3334), 10_000)).toEqual([3_333, 3_333, 3_334])
    const odd = previewMilestoneAmounts(pkg(5000, 5000), 1_001)
    expect(odd).toEqual([500, 501])
    expect(odd.reduce((sum, amount) => sum + amount, 0)).toBe(1_001)
  })

  it('always allocates the full agreed fee', () => {
    for (const total of [2, 999, 1_000, 123_457, 350_001]) {
      const amounts = previewMilestoneAmounts(pkg(5000, 5000), total)
      expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(total)
    }
  })

  it('returns nothing to preview for an empty package or a non-positive fee', () => {
    expect(previewMilestoneAmounts(pkg(), 350_000)).toEqual([])
    expect(previewMilestoneAmounts(pkg(5000, 5000), 0)).toEqual([])
    expect(previewMilestoneAmounts(pkg(5000, 5000), -100)).toEqual([])
  })
})

describe('fee schedule surfaces', () => {
  it('offers only fixed-milestone packages, which the RPC accepts', () => {
    const schedules = read('lib/billing/schedules.ts')
    expect(schedules).toContain("eq('billing_strategy', 'fixed_milestones')")
    expect(schedules).toContain("eq('is_active', true)")
  })

  it('keeps the card behind the firm flag', () => {
    const tab = read('app/admin/matters/[id]/tabs/billing.tsx')
    expect(tab).toContain('view?.milestonesEnabled && (')
    expect(read('lib/billing/schedules.ts')).toContain('billing_milestones_enabled')
  })

  it('offers packages only when a schedule could actually attach', () => {
    // create_matter_fee_schedule refuses a matter that already carries billing.
    expect(read('lib/queries/billing.ts'))
      .toContain('milestonesEnabled && !feeSchedule && items.length === 0')
  })
})
