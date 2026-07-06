import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchDesignSheet, fetchIntakeForMatter } from '@/lib/queries'
import { buildDesignSheetPersistencePayload } from '@/lib/designSheetPersistence'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  buildIntakeResyncPatch,
  buildIntakeResyncPreview,
  INTAKE_SEED_FIELD_META,
  type IntakeSeedField,
} from '@/lib/designSheet/seedFromIntake'

type Params = { params: Promise<{ id: string }> }

function isIntakeSeedField(value: string): value is IntakeSeedField {
  return value in INTAKE_SEED_FIELD_META
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(_req)
  if (err) return err

  const { id: matterId } = await params

  try {
    const [sheet, intake] = await Promise.all([
      fetchDesignSheet(matterId),
      fetchIntakeForMatter(matterId),
    ])

    if (!intake) {
      return NextResponse.json({ error: 'No intake found for this matter' }, { status: 404 })
    }
    if (!sheet?.id) {
      return NextResponse.json({ error: 'No design sheet found for this matter' }, { status: 404 })
    }

    const preview = buildIntakeResyncPreview({
      currentSheet: sheet as unknown as Record<string, unknown>,
      intake,
    })

    return NextResponse.json({ ok: true, preview })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build intake resync preview'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as { fields?: unknown } | null
  const fields = Array.isArray(body?.fields)
    ? body.fields.filter((field): field is IntakeSeedField => typeof field === 'string' && isIntakeSeedField(field))
    : []

  if (!fields.length) {
    return NextResponse.json({ error: 'Select at least one field to re-sync' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const [sheet, intake] = await Promise.all([
      fetchDesignSheet(matterId),
      fetchIntakeForMatter(matterId),
    ])

    if (!intake) {
      return NextResponse.json({ error: 'No intake found for this matter' }, { status: 404 })
    }
    if (!sheet?.id) {
      return NextResponse.json({ error: 'No design sheet found for this matter' }, { status: 404 })
    }

    const patch = buildIntakeResyncPatch({
      currentSheet: sheet,
      intake,
      fields,
    })
    const now = new Date().toISOString()
    const payload = buildDesignSheetPersistencePayload(patch)

    const { error } = await admin
      .from('design_sheets')
      .update({
        ...payload,
        updated_at: now,
      })
      .eq('id', sheet.id)
      .eq('matter_id', matterId)

    if (error) throw new Error(error.message)

    return NextResponse.json({
      ok: true,
      applied: fields,
      updated_at: now,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to re-sync from intake'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
