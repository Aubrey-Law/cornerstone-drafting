import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDesignSheetProvisions } from '@/lib/adminChat/prompts'
import { DESIGN_SHEET_STATUS_TOOL_NAME } from '@/lib/adminChat/engine'

function source(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

/**
 * The assistant used to select ~20 of the sheet's ~200 fields, and none of the
 * provisions — every trust, DPOA and health-care decision lives in `decisions`,
 * which was not in the select list. It could neither say what was missing nor
 * avoid re-asking what was already settled.
 */
describe('the assistant can see the provisions', () => {
  it('selects the decisions blob and the will-provision columns', () => {
    const engine = source('lib/adminChat/engine.ts')
    const columns = engine.slice(engine.indexOf('CHAT_DESIGN_SHEET_COLUMNS'))
      .slice(0, engine.slice(engine.indexOf('CHAT_DESIGN_SHEET_COLUMNS')).indexOf('as const'))

    for (const column of ['decisions', 'bond', 'supervision', 'no_contest_clause', 'trustee_structure']) {
      expect(columns, column).toContain(column)
    }
  })

  it('reports an untouched sheet as having decided nothing', () => {
    // Rendering through a decisions getter would answer with a default for every
    // key and tell the assistant the whole provision set was already settled.
    expect(formatDesignSheetProvisions({ decisions: {} }))
      .toContain('none — every provision on this sheet is still open')
  })

  it('lists only provisions that carry a stored value', () => {
    const rendered = formatDesignSheetProvisions({
      decisions: { trust_details: { co_trustee_decision: 'independent' } },
      bond: 'no_bond',
    })

    expect(rendered).toContain('trust_details.co_trustee_decision): independent')
    expect(rendered).toContain('Bond: no_bond')
    expect(rendered).not.toContain('trustee_compensation')
  })

  it('counts a stored false as decided', () => {
    expect(formatDesignSheetProvisions({
      decisions: { dpoa_provisions: { allow_delegation: false } },
    })).toContain('allow_delegation')
  })
})

describe('the assistant can ask what is still open', () => {
  it('registers the status tool on a matter conversation, on both chat surfaces', () => {
    // Both routes build their tools from the shared toolset, which registers
    // the status tool whenever the chat is opened on a matter.
    const toolset = source('lib/adminChat/toolset.ts')
    expect(toolset).toContain('designSheetStatusExecutor(matterId)')
    for (const route of ['app/api/admin/chat/route.ts', 'app/api/admin/assistant/chats/[chatId]/messages/route.ts']) {
      expect(source(route), route).toContain('adminChatToolset(')
    }
  })

  it('is read-only', () => {
    const tool = source('lib/adminChat/designSheetTool.ts')

    expect(DESIGN_SHEET_STATUS_TOOL_NAME).toBe('read_design_sheet_status')
    expect(tool).toContain('DESIGN_SHEET_STATUS_TOOL_NAME')
    expect(tool).not.toContain('.update(')
    expect(tool).not.toContain('.insert(')
  })

  it('tells the assistant to call it before running an interview', () => {
    expect(source('lib/adminChat/engine.ts')).toContain('DESIGN SHEET STATUS TOOL')
  })
})

/**
 * Both interviews used to end by printing a paste block, so everything the
 * attorney answered stopped at the conversation.
 */
describe('the interviews reach the design sheet', () => {
  const skills = [
    'tools/workflows/system/assistant/trust-drafting-intake/SKILL.md',
    'tools/workflows/system/assistant/incapacity-design-sheet/SKILL.md',
  ]

  it.each(skills)('%s opens with the status tool', file => {
    expect(source(file)).toContain('read_design_sheet_status')
  })

  it.each(skills)('%s writes the confirmed answers back', file => {
    expect(source(file)).toContain('propose_design_sheet_updates')
  })

  it.each(skills)('%s still feeds the document-drafting skill', file => {
    // The handoff block has a separate consumer; adding the design-sheet write
    // must not cost the drafting skill its input.
    expect(source(file)).toContain('SKILL HANDOFF')
  })

  it.each(skills)('%s never claims a proposal was saved', file => {
    expect(source(file)).toContain('never tell him anything has been saved')
  })
})
