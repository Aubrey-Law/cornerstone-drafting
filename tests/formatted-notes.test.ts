import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('formatted lead and matter notes', () => {
  it('offers the requested formatting controls in one shared editor', () => {
    const editor = read('components/notes/FormattedNoteEditor.tsx')

    for (const label of ['Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list']) {
      expect(editor).toContain(`label: '${label}'`)
    }
    expect(editor).toContain("format === 'bold' ? '**'")
    expect(editor).toContain("format === 'italic' ? '*'")
    expect(editor).toContain("format === 'bullets' ? `- ${clean}`")
  })

  it('uses the shared editor and renderer for lead notes', () => {
    const leadTimeline = read('components/leads/LeadTimelineCard.tsx')

    expect(leadTimeline).toContain('<FormattedNoteEditor')
    expect(leadTimeline).toContain('<FormattedNote')
  })

  it('uses the shared editor and renderer for matter notes', () => {
    const matterNotes = read('app/admin/matters/[id]/tabs/notes.tsx')

    expect(matterNotes).toContain('<FormattedNoteEditor')
    expect(matterNotes).toContain('<FormattedNote')
  })
})
