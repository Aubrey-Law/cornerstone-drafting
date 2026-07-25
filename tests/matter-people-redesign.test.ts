import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('matter people redesign', () => {
  it('uses compact rows that omit missing details and label DOB with age', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/matter/PersonContactCard.tsx'),
      'utf8',
    )

    expect(source).toContain('Date of birth ·')
    expect(source).not.toContain('No Address provided')
    expect(source).not.toContain('No Phone provided')
    expect(source).not.toContain('No Email provided')
    expect(source).toContain('role')
  })

  it('provides one top-level add-person menu and unresolved fiduciary rows', () => {
    const people = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/MatterPeopleTab.tsx'),
      'utf8',
    )
    const additional = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/MatterAdditionalContactsTab.tsx'),
      'utf8',
    )

    expect(people).toContain('Add person')
    for (const role of ['Spouse', 'Child', 'Fiduciary', 'Beneficiary']) {
      expect(people).toContain(role)
    }
    expect(additional).toContain('pending_client')
    expect(additional).toContain('optional')
    expect(additional).not.toContain('To Be Determined')
  })
})
