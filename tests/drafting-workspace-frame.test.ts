import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('drafting as a matter workspace tab', () => {
  it('frames the drafting route with the shared matter header and leaves drafting internals alone', () => {
    const layout = fs.readFileSync('app/admin/drafting/[matterId]/layout.tsx', 'utf8')
    expect(layout).toContain('<MatterWorkspaceFrame data={frame} active="drafting">{children}</MatterWorkspaceFrame>')
    expect(layout).not.toContain('MatterWorkspaceShell')
    expect(layout).not.toMatch(/DraftingWorkspace|DesignSheetPage|GenerateStep|ReviewStep|draftPayload|estateGenerator/)
  })

  it('renders the same header, stepper, tab bar, work indicator and Details panel as the matter page', () => {
    const frame = fs.readFileSync('app/admin/matters/[id]/MatterWorkspaceFrame.tsx', 'utf8')
    for (const part of ['<MatterWorkspaceHeader', '<MatterStageStrip', '<ProbateStageStrip', '<MatterWorkspaceNav', '<RecordWorkIndicator', '<MatterDetailsPanel', '<MatterDialogs']) {
      expect(frame).toContain(part)
    }
    expect(frame).toContain('side="right"')
    expect(frame).toContain('collapseBelow="lg"')
  })
})
