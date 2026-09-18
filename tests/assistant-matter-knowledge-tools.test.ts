import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadMatterDossier,
  readMatterDocumentText,
  resolveRecordMatterId,
  searchMatterRecords,
} = vi.hoisted(() => ({
  loadMatterDossier: vi.fn(),
  readMatterDocumentText: vi.fn(),
  resolveRecordMatterId: vi.fn(),
  searchMatterRecords: vi.fn(),
}))

vi.mock('@/lib/matterKnowledge', async () => {
  const actual = await vi.importActual<typeof import('@/lib/matterKnowledge')>('@/lib/matterKnowledge')
  return {
    ...actual,
    loadMatterDossier,
    readMatterDocumentText,
    resolveRecordMatterId,
    searchMatterRecords,
  }
})

import {
  FIND_MATTER_TOOL_NAME,
  READ_DOCUMENT_TEXT_TOOL_NAME,
  READ_MATTER_RECORD_TOOL_NAME,
  matterKnowledgeSystemPromptNote,
  matterKnowledgeToolExecutors,
} from '@/lib/adminChat/matterKnowledgeTools'
import { MATTER_SECTIONS } from '@/lib/matterKnowledge'

function tools(defaultRecordId: string | null = 'matter-1') {
  const [find, read, readDocument] = matterKnowledgeToolExecutors({ defaultRecordId })
  return { find, read, readDocument }
}

const ctx = () => {
  const events: Record<string, unknown>[] = []
  return { events, hooks: { toolUseId: 'tool-1', emit: (e: Record<string, unknown>) => events.push(e) } }
}

describe('assistant matter-knowledge tools', () => {
  beforeEach(() => {
    loadMatterDossier.mockReset()
    readMatterDocumentText.mockReset()
    resolveRecordMatterId.mockReset()
    searchMatterRecords.mockReset()
    resolveRecordMatterId.mockImplementation(async (id: string) => id)
  })

  it('offers exactly the three read-only tools, by name', () => {
    const { find, read, readDocument } = tools()
    expect(find.tool.name).toBe(FIND_MATTER_TOOL_NAME)
    expect(read.tool.name).toBe(READ_MATTER_RECORD_TOOL_NAME)
    expect(readDocument.tool.name).toBe(READ_DOCUMENT_TEXT_TOOL_NAME)
    for (const tool of [find, read, readDocument]) {
      expect(tool.tool.description).toContain('Read-only')
    }
  })

  it('names every section in the read tool so the model can pick one', () => {
    const { read } = tools()
    const properties = read.tool.input_schema.properties as {
      sections: { items: { enum: string[] } }
    }
    expect(properties.sections.items.enum).toEqual([...MATTER_SECTIONS])
    for (const section of MATTER_SECTIONS) {
      expect(read.tool.description).toContain(section)
    }
  })

  it('tells the assistant to read the record rather than claim it lacks access', () => {
    const note = matterKnowledgeSystemPromptNote()
    expect(note).toContain(READ_MATTER_RECORD_TOOL_NAME)
    expect(note).toContain(FIND_MATTER_TOOL_NAME)
    expect(note).toContain(READ_DOCUMENT_TEXT_TOOL_NAME)
    expect(note).toContain('rather than saying you do not have access')
  })

  it('reads the chat’s own matter when the call names none', async () => {
    loadMatterDossier.mockResolvedValue({
      matter_id: 'matter-1',
      matter_label: 'Chen Trust · #2026-014',
      sections: [{ section: 'documents', documents: [] }],
    })
    const { read } = tools()
    const { events, hooks } = ctx()

    const result = await read.execute({ sections: ['documents'] }, hooks)

    expect(loadMatterDossier).toHaveBeenCalledWith('matter-1', ['documents'], { limit: undefined })
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, matter_id: 'matter-1' })
    expect(events).toContainEqual(expect.objectContaining({
      tool: READ_MATTER_RECORD_TOOL_NAME,
      status: 'done',
    }))
  })

  it('resolves a lead id to its matter before reading', async () => {
    // A lead chat carries a client_intake id; every section reads by matter.
    resolveRecordMatterId.mockResolvedValue('matter-9')
    loadMatterDossier.mockResolvedValue({ matter_id: 'matter-9', matter_label: null, sections: [] })
    const { read } = tools('lead-3')

    await read.execute({ sections: ['overview'] }, ctx().hooks)

    expect(resolveRecordMatterId).toHaveBeenCalledWith('lead-3')
    expect(loadMatterDossier).toHaveBeenCalledWith('matter-9', ['overview'], { limit: undefined })
  })

  it('drops sections it does not recognise and refuses a call left with none', async () => {
    loadMatterDossier.mockResolvedValue({ matter_id: 'matter-1', matter_label: null, sections: [] })
    const { read } = tools()

    await read.execute({ sections: ['billing', 'payroll'] }, ctx().hooks)
    expect(loadMatterDossier).toHaveBeenCalledWith('matter-1', ['billing'], { limit: undefined })

    const refused = await read.execute({ sections: ['payroll'] }, ctx().hooks)
    expect(refused.isError).toBe(true)
    expect(JSON.parse(refused.content).ok).toBe(false)
    expect(loadMatterDossier).toHaveBeenCalledTimes(1)
  })

  it('asks the general assistant to find a matter before reading one', async () => {
    const { read } = tools(null)
    const result = await read.execute({ sections: ['overview'] }, ctx().hooks)

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content).error).toContain(FIND_MATTER_TOOL_NAME)
    expect(loadMatterDossier).not.toHaveBeenCalled()
  })

  it('searches by name and hands back ids the read tool takes', async () => {
    searchMatterRecords.mockResolvedValue([
      { id: 'matter-2', type: 'matter', label: 'Chen Trust', matter_number: '2026-014' },
    ])
    const { find } = tools()
    const { events, hooks } = ctx()

    const result = await find.execute({ query: 'Chen' }, hooks)

    expect(searchMatterRecords).toHaveBeenCalledWith('Chen', 10)
    expect(JSON.parse(result.content).matches[0].id).toBe('matter-2')
    expect(events).toContainEqual(expect.objectContaining({ status: 'done' }))
  })

  it('reports a document read as truncated when it is', async () => {
    readMatterDocumentText.mockResolvedValue({
      document_id: 'doc-1',
      name: 'Chen Trust.docx',
      matter_id: 'matter-1',
      characters: 120_000,
      truncated: true,
      text: 'THE CHEN FAMILY TRUST…',
    })
    const { readDocument } = tools()
    const { events, hooks } = ctx()

    const result = await readDocument.execute({ document_id: 'doc-1' }, hooks)

    expect(JSON.parse(result.content)).toMatchObject({ ok: true, truncated: true, name: 'Chen Trust.docx' })
    expect(events).toContainEqual(expect.objectContaining({
      tool: READ_DOCUMENT_TEXT_TOOL_NAME,
      status: 'done',
    }))
  })

  it('surfaces a failed read as a tool error instead of an empty answer', async () => {
    readMatterDocumentText.mockRejectedValue(new Error('Document not found'))
    const { readDocument } = tools()
    const { events, hooks } = ctx()

    const result = await readDocument.execute({ document_id: 'missing' }, hooks)

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content).error).toBe('Document not found')
    expect(events).toContainEqual(expect.objectContaining({ status: 'error' }))
  })
})

describe('matter-knowledge tools are wired into both chat surfaces', () => {
  it('registers the tools and the prompt note in the shared toolset both routes build from', async () => {
    const { readFileSync } = await import('node:fs')
    const toolset = readFileSync('lib/adminChat/toolset.ts', 'utf8')
    expect(toolset).toContain('matterKnowledgeToolExecutors')
    expect(toolset).toContain('matterKnowledgeSystemPromptNote()')
    for (const route of [
      'app/api/admin/chat/route.ts',
      'app/api/admin/assistant/chats/[chatId]/messages/route.ts',
    ]) {
      expect(readFileSync(route, 'utf8'), route).toContain('adminChatToolset(')
    }
  })
})
