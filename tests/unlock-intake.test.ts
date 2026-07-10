import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('unlockIntake lite compatibility', () => {
  it('does not query lead_id or crm_activity (lite has no leads module)', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/actions/adminIntake.ts'),
      'utf8',
    )
    const unlockBlock = source.slice(source.indexOf('export async function unlockIntake'))

    expect(unlockBlock).toContain(".select('id')")
    expect(unlockBlock).not.toContain('lead_id')
    expect(unlockBlock).not.toContain('crm_activity')
  })
})
