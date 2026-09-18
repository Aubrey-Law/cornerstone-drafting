import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => { throw new Error('no db in this test') }) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c' } })),
  isAdministrator: vi.fn(async () => true),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 60, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: vi.fn(),
  findOpenSlots: vi.fn(),
  listCalendarEvents: vi.fn(),
}))

const brief = vi.hoisted(() => ({
  buildMatterBrief: vi.fn(async () => ({
    ok: true,
    brief: { matterId: 'm1', matterNumber: '00-000', clientName: 'Amy Chen', factSheet: 'Client: Amy Chen\nTrustee: Dana Chen', truncated: false },
  }) as unknown),
}))
vi.mock('@/lib/drafting/matterBrief', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/drafting/matterBrief')>()),
  buildMatterBrief: brief.buildMatterBrief,
}))

type StreamOptions = {
  system: string
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{ tool: { name: string } }>
  maxTokens?: number
  usage: { route: string; matterId?: string | null }
}
const engine = vi.hoisted(() => ({
  frames: [] as Array<Record<string, unknown> | '[DONE]'>,
  createAdminChatStream: vi.fn((_options: StreamOptions) => new Response(
    engine.frames.map(frame => `data: ${frame === '[DONE]' ? '[DONE]' : JSON.stringify(frame)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )),
}))
vi.mock('@/lib/adminChat/engine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/adminChat/engine')>()),
  createAdminChatStream: engine.createAdminChatStream,
}))

import { POST } from '@/app/api/addin/chat/route'
import { buildEditProtocolInstructions } from '@/lib/drafting/editProtocol'

function post(body: unknown) {
  return POST(new Request('http://localhost/api/addin/chat', { method: 'POST', body: JSON.stringify(body) }))
}
const lastOptions = () => engine.createAdminChatStream.mock.calls.at(-1)![0]
const frames = async (response: Response) =>
  (await response.text()).split('\n\n').filter(Boolean).map(frame => frame.replace(/^data: /, ''))

beforeEach(() => {
  vi.clearAllMocks()
  engine.frames = [
    { text: 'Hel' },
    { tool: 'read_matter_record', tool_use_id: 't1', status: 'done', result: { matter_label: 'Chen' } },
    { text: 'lo' },
    '[DONE]',
  ]
})

/**
 * The Word add-in was the last chat lane on its own loop: a user-preference
 * LLM, the matter brief, and no way to read the rest of the record. It now
 * runs the shared engine with read-only tools, and the route translates the
 * engine's stream into the frames the deployed add-in already understands, so
 * the pane needs no change.
 */
describe('the Word add-in chat runs the shared engine', () => {
  it('keeps the Word framing, the edit protocol and the matter brief, and adds the record tools', async () => {
    await post({ messages: [{ role: 'user', content: 'Check the trustee' }], documentName: 'Chen Trust.docx', documentText: 'ARTICLE I', matterId: 'm1' })

    const options = lastOptions()
    expect(options.system).toContain('running inside Microsoft Word')
    expect(options.system).toContain('"Chen Trust.docx"')
    expect(options.system).toContain(buildEditProtocolInstructions())
    expect(options.system).toContain('Trustee: Dana Chen')
    expect(options.system).toContain('FIRM RECORD ACCESS')
    const names = (options.tools ?? []).map(executor => executor.tool.name)
    for (const expected of ['read_matter_record', 'read_document_text', 'read_design_sheet_status', 'read_firm_today']) {
      expect(names).toContain(expected)
    }
    expect(options.maxTokens).toBe(8192)
    expect(options.usage).toMatchObject({ route: 'addin/chat', matterId: 'm1' })
  })

  it('gives Word only read-only tools — the pane cannot show a proposal card', async () => {
    await post({ messages: [{ role: 'user', content: 'q' }], matterId: 'm1' })
    const names = (lastOptions().tools ?? []).map(executor => executor.tool.name)
    for (const excluded of ['create_task', 'create_lead', 'create_hold', 'propose_reschedule', 'propose_design_sheet_updates', 'export_leads', 'export_matters', 'analyze_template_upload', 'register_custom_template']) {
      expect(names).not.toContain(excluded)
    }
  })

  it('fences the open document into the attorney’s turn, as before', async () => {
    await post({ messages: [{ role: 'user', content: 'Fix article II' }], documentText: 'ARTICLE II text' })
    const last = lastOptions().messages.at(-1)!
    expect(String(last.content)).toContain('ARTICLE II text')
    expect(String(last.content)).toContain('Attorney request:\nFix article II')
  })

  it('translates the engine stream into the add-in’s frames: deltas, then one done frame with the whole reply', async () => {
    const response = await post({ messages: [{ role: 'user', content: 'q' }], matterId: 'm1' })
    const out = await frames(response)

    expect(out).toContain(JSON.stringify({ delta: 'Hel' }))
    expect(out).toContain(JSON.stringify({ delta: 'lo' }))
    const done = JSON.parse(out.at(-1)!) as { done: boolean; reply: string; matterContext: Record<string, unknown> }
    expect(done.done).toBe(true)
    expect(done.reply).toBe('Hello')
    expect(done.matterContext).toEqual({ state: 'applied', matterNumber: '00-000', clientName: 'Amy Chen' })
    expect(out.join('\n')).not.toContain('[DONE]')
    expect(out.join('\n')).not.toContain('"text"')
  })

  it('forwards an engine error as the error frame the pane throws on', async () => {
    engine.frames = [{ text: 'partial' }, { error: 'Chat unavailable - try again in a moment.' }]
    const out = await frames(await post({ messages: [{ role: 'user', content: 'q' }] }))
    expect(out).toContain(JSON.stringify({ error: 'Chat unavailable - try again in a moment.' }))
    expect(out.some(frame => frame.includes('"done":true'))).toBe(false)
  })

  it('reports the matter as unavailable when the brief cannot be built, without failing the turn', async () => {
    brief.buildMatterBrief.mockResolvedValueOnce({ ok: false, reason: 'Design sheet not ready' })
    const out = await frames(await post({ messages: [{ role: 'user', content: 'q' }], matterId: 'm1' }))
    const done = JSON.parse(out.at(-1)!) as { matterContext: Record<string, unknown> }
    expect(done.matterContext).toEqual({ state: 'unavailable', reason: 'Design sheet not ready' })
    expect(lastOptions().system).not.toContain('Trustee: Dana Chen')
  })

  it('still requires a trailing user message', async () => {
    expect((await post({ messages: [{ role: 'assistant', content: 'hi' }] })).status).toBe(400)
  })
})
