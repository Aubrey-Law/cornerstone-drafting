import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic, PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { consumeRateLimit } from '@/lib/rateLimit'

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const instructions = typeof body?.instructions === 'string' ? body.instructions.trim() : ''
  const existingText = typeof body?.existingText === 'string' ? body.existingText.trim() : ''
  if (!instructions) {
    return Response.json({ error: 'Drafting instructions are required' }, { status: 400 })
  }

  const limited = await consumeRateLimit(
    { bucket: 'estate_clause_ai', limit: 20, windowSeconds: 60 },
    userId ?? 'unknown',
  )
  if (!limited.ok) return Response.json({ error: 'Too many AI drafting requests' }, { status: 429 })

  try {
    const response = await callAnthropic({
      model: await resolveFirmModel('drafting'),
      max_tokens: 1600,
      system: `You draft structured Massachusetts estate-planning clause language as an attorney-review draft. Return clause text only. You must not invent client facts, legal authorities, names, dates, addresses, or other matter details. ${PROMPT_INJECTION_GUARDRAIL}`,
      messages: [{
        role: 'user',
        content: `${quoteUserContent('drafting_instructions', instructions)}\n${quoteUserContent('existing_clause_text', existingText)}`,
      }],
    }, {
      route: 'admin/settings/estate-clauses/draft-ai',
      userId,
      contextType: 'matter',
    })
    const text = response.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n')
      .trim()
    return Response.json({ proposal: { text } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to draft estate clause text' }, { status: 500 })
  }
}
