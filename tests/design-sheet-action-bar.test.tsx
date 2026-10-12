// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesignSheetActionBar } from '@/components/design-sheet/DesignSheetActionBar'

afterEach(cleanup)

describe('design sheet action bar', () => {
  it('opens the blocking checklist and jumps from a row', async () => {
    const user = userEvent.setup()
    const onSelectRow = vi.fn()
    render(
      <DesignSheetActionBar
        rows={[
          { id: 'matter-type', label: 'Matter type must be confirmed before drafting' },
          { id: 'client-name', label: 'Facts from intake: client name', nextUnresolved: true },
        ]}
        saveStatusText="Saved at 3:42 PM"
        onSaveAndCheck={vi.fn()}
        onSelectRow={onSelectRow}
        complete={<button type="button">Complete sheet</button>}
        menu={<button type="button">More</button>}
      />,
    )

    expect(screen.getByRole('status').textContent).toBe('Saved at 3:42 PM')
    expect(screen.queryByRole('button', { name: 'Next unresolved decision' })).toBeNull()

    await user.click(screen.getByRole('button', { name: '2 decisions block drafting' }))
    const next = screen.getByRole('button', { name: 'Next unresolved decision, Facts from intake: client name' })
    expect(screen.getByRole('list', { name: 'Unresolved decisions' })).toBeTruthy()
    await user.click(next)
    expect(onSelectRow).toHaveBeenCalledWith('client-name')
    expect(screen.queryByRole('list', { name: 'Unresolved decisions' })).toBeNull()
  })

  it('keeps one bar in the drafting step row and one field legend', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
      'utf8',
    )
    const workspace = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/DraftingWorkspace.tsx'),
      'utf8',
    )
    const personal = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/PersonalSection.tsx'),
      'utf8',
    )

    expect(workspace).toContain('id="drafting-design-actions"')
    expect(workspace).toContain('Generates from the sheet as it stands and skips the section-by-section pass.')
    expect(page).toContain('drafting-design-actions')
    expect(page).toContain('Gray from intake, amber overridden, white attorney-only.')
    expect(page).toContain('Matter type must be confirmed before drafting')
    expect(page).not.toContain('Show unresolved decisions by section')
    expect(page).not.toContain('>Next unresolved decision<')
    expect(personal).toContain('No children listed.')
    expect(personal).toContain('Add Child')
    expect(personal).not.toContain('Add First Child')
    expect(personal).not.toContain('pre-filled from the client intake')
  })
})
