import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('admin chat drafting summary prompt', () => {
  it('offers matter prompts for intake, tax, and drafting workflows', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/components/ChatPanel.tsx'), 'utf8')

    expect(source).toContain('Summarize the design sheet for Claude drafting')
    expect(source).toContain('Summarize contacts and fiduciary roles')
    expect(source).toContain('Draft follow-up questions for the client')
    expect(source).toContain('Create a matter note for the file')
    expect(source).toContain('Analyze MA estate tax exposure')
    expect(source).toContain("Summarize this client's situation")
    expect(source).toContain('Gather trust drafting details')
    expect(source).toContain('Create incapacity design sheet')
  })

  it('opens the assistant with note prompts from matter note surfaces', () => {
    const events = fs.readFileSync(path.join(process.cwd(), 'app/admin/components/adminChatEvents.ts'), 'utf8')
    const matterNotes = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/[id]/tabs/notes.tsx'), 'utf8')
    const layout = fs.readFileSync(path.join(process.cwd(), 'app/admin/AdminLayoutClient.tsx'), 'utf8')

    expect(events).toContain('MATTER_NOTE_ASSISTANT_PROMPT')
    expect(events).toContain('MATTER_CLIENT_COMM_ACTIVITY_NOTE_PROMPT')
    expect(events).toContain('noteType')
    expect(events).toContain('openCornerstoneAssistant')
    expect(events).toContain('CORNERSTONE_CHAT_OPEN_EVENT')
    expect(matterNotes).toContain('AssistantNotePromptButton')
    expect(layout).toContain('CORNERSTONE_CHAT_OPEN_EVENT')
    expect(layout).toContain('pendingChatAction')
    expect(layout).toContain('FloatingChatButton')
  })

  it('handles drafting-summary requests directly from the normalized payload', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/admin/chat/route.ts'), 'utf8')
    const prompts = fs.readFileSync(path.join(process.cwd(), 'lib/adminChat/prompts.ts'), 'utf8')

    expect(route).toContain("import { buildDraftPayload } from '@/lib/buildDraftPayload'")
    expect(prompts).toContain("import type { DraftPayload } from '@/lib/buildDraftPayload'")
    expect(route).toContain('isDraftingSummaryRequest')
    expect(route).toContain('formatClaudeDraftingSkillInput')
    expect(route).toContain('const payload = await buildDraftPayload(body.context_id)')
    expect(route).toContain('return new Response(`${sse({ text: textOutput })}data: [DONE]')
  })

  it('includes trust and incapacity interview blocks in matter context', () => {
    const engine = fs.readFileSync(path.join(process.cwd(), 'lib/adminChat/engine.ts'), 'utf8')

    expect(engine).toContain('trustDraftingIntakeInstructions')
    expect(engine).toContain('incapacityDesignSheetInstructions')
    expect(engine).toContain("from('asset_intake')")
  })

  it('sources the drafting interview prompts from system skills, not inline copies', () => {
    const prompts = fs.readFileSync(path.join(process.cwd(), 'lib/adminChat/prompts.ts'), 'utf8')
    const trustSkill = fs.readFileSync(
      path.join(process.cwd(), 'tools/workflows/system/assistant/trust-drafting-intake/SKILL.md'), 'utf8')
    const incapacitySkill = fs.readFileSync(
      path.join(process.cwd(), 'tools/workflows/system/assistant/incapacity-design-sheet/SKILL.md'), 'utf8')

    expect(prompts).toContain('loadSystemSkillBody')
    // The instruction bodies live only in the SKILL.md tree.
    expect(prompts).not.toContain('TRUST DRAFTING INTAKE:')
    expect(prompts).not.toContain('INCAPACITY DESIGN SHEET:')
    expect(trustSkill).toContain('=== TRUST DRAFTING SKILL INPUT ===')
    expect(incapacitySkill).toContain('=== INCAPACITY DRAFTING SKILL INPUT ===')
  })

  it('keeps lightweight system instructions for normal matter chats', () => {
    const engine = fs.readFileSync(path.join(process.cwd(), 'lib/adminChat/engine.ts'), 'utf8')

    expect(engine).toContain('draftingSkillSummaryInstructions')
    expect(engine).not.toContain('NORMALIZED DRAFTING PAYLOAD:')
    expect(engine).not.toContain('JSON.stringify(await buildDraftPayload(contextId), null, 2)')
  })

  it('instructs the assistant to produce Claude-skill-ready drafting input', () => {
    const prompts = fs.readFileSync(path.join(process.cwd(), 'lib/adminChat/prompts.ts'), 'utf8')

    expect(prompts).toContain('Claude Drafting Skill Input')
    expect(prompts).toContain('Non-invention rule')
    expect(prompts).toContain('Documents to draft')
    expect(prompts).toContain('Missing or attorney-review items')
    expect(prompts).toContain('Do not invent names, dates, relationships, assets, tax conclusions, or fiduciary roles')
  })
})
