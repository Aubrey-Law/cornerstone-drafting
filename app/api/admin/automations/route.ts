import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createAutomationRule, listAutomationRules, validateAutomationRule } from '@/lib/automations/server'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  try {
    return NextResponse.json({ rules: await listAutomationRules() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Automations are unavailable' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err
  try {
    const input = validateAutomationRule(await req.json().catch(() => null))
    return NextResponse.json({ rule: await createAutomationRule(input, auth.userId) }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create automation' }, { status: 400 })
  }
}
