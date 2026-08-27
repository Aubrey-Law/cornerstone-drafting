import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createStyleSet, listStyleSets } from '@/lib/styleSets/data'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json({ styleSets: await listStyleSets() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to list style sets' },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown
    description?: unknown
    settings?: unknown
    isDefault?: unknown
    sourceFileName?: unknown
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })

  try {
    const styleSet = await createStyleSet({
      name,
      description: typeof body.description === 'string' ? body.description : null,
      settings: body.settings ?? {},
      isDefault: body.isDefault === true,
      sourceFileName: typeof body.sourceFileName === 'string' ? body.sourceFileName : null,
      createdBy: auth.userId,
    })
    return NextResponse.json({ styleSet }, { status: 201 })
  } catch (error) {
    // Invalid settings and a duplicate name are both the caller's to fix, so
    // they read as 400 rather than as a server fault.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the style set' },
      { status: 400 },
    )
  }
}
