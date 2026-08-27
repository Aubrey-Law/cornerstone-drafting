import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { deleteStyleSet, getStyleSet, updateStyleSet } from '@/lib/styleSets/data'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const styleSet = await getStyleSet(id)
    if (!styleSet) return NextResponse.json({ error: 'Style set not found' }, { status: 404 })
    return NextResponse.json({ styleSet })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to read the style set' },
      { status: 500 },
    )
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Only the keys actually present are patched — sending `{ isDefault: true }`
  // must not blank the name and settings by treating their absence as null.
  const patch: Parameters<typeof updateStyleSet>[1] = {}
  if (typeof body.name === 'string') patch.name = body.name.trim()
  if ('description' in body) {
    patch.description = typeof body.description === 'string' ? body.description : null
  }
  if ('settings' in body) patch.settings = body.settings
  if ('isDefault' in body) patch.isDefault = body.isDefault === true

  if (patch.name !== undefined && !patch.name) {
    return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  }

  try {
    return NextResponse.json({ styleSet: await updateStyleSet(id, patch) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save the style set' },
      { status: 400 },
    )
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    await deleteStyleSet(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to delete the style set' },
      { status: 500 },
    )
  }
}
