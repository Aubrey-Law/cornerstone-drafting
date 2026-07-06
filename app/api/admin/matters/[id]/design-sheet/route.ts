import { NextResponse } from 'next/server'
import { buildDesignSheetPersistencePayload, inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { saveHouseholdChildren } from '@/lib/contacts/saveHouseholdChildren'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import type { DesignSheetUpdate } from '@/types/database'

type Params = { params: Promise<{ id: string }> }

async function getMatterClientIntakeId(matterId: string) {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data?.client_intake_id) throw new Error('This matter is missing a client intake record.')
  return data.client_intake_id as string
}

export async function PATCH(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as {
    sheetId?: string | null
    expectedUpdatedAt?: string | null
    sheet?: DesignSheetUpdate
  } | null

  if (!body?.sheet || typeof body.sheet !== 'object') {
    return NextResponse.json({ error: 'sheet is required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    await ensureDesignSheetSeededFromIntake(matterId)
    const clientIntakeId = await getMatterClientIntakeId(matterId)

    const incomingSheet = (body.sheet ?? {}) as Record<string, unknown>
    const childrenInput = Array.isArray(incomingSheet.children)
      ? (incomingSheet.children as Array<Record<string, unknown>>).map((c) => ({
          name: (c.name as string) ?? '',
          dob: (c.dob as string) ?? null,
          relationship: ((c.relationship as string) ?? 'biological') as 'biological' | 'adopted' | 'stepchild',
          parentage: (c.parentage as 'joint' | 'client' | 'spouse' | null) ?? null,
          is_minor: typeof c.is_minor === 'boolean' ? c.is_minor : undefined,
        }))
      : null
    if (childrenInput) delete incomingSheet.children

    const now = new Date().toISOString()
    const sheetId = body.sheetId || (body.sheet as Record<string, unknown>).id as string | undefined
    let existingRow: Record<string, unknown> | null = null

    if (sheetId) {
      const { data, error } = await admin
        .from('design_sheets')
        .select('*')
        .eq('id', sheetId)
        .eq('matter_id', matterId)
        .maybeSingle()

      if (error) throw new Error(error.message)
      existingRow = data as Record<string, unknown> | null
    }

    if (!existingRow) {
      const { data, error } = await admin
        .from('design_sheets')
        .select('*')
        .eq('matter_id', matterId)
        .order('version', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw new Error(error.message)
      existingRow = data as Record<string, unknown> | null
    }

    const existingSheet = inflateDesignSheetRow(existingRow)
    const existingId = typeof existingRow?.id === 'string' ? existingRow.id : null
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    const currentUpdatedAt = typeof existingRow?.updated_at === 'string' ? existingRow.updated_at : null
    if (existingId && expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
      return NextResponse.json(
        { error: 'Design sheet was updated elsewhere.', conflict: true, updated_at: currentUpdatedAt },
        { status: 409 },
      )
    }

    const sheetForPersistence = existingSheet
      ? ({ ...existingSheet, ...body.sheet } as DesignSheetUpdate)
      : body.sheet
    const payload = buildDesignSheetPersistencePayload(formatPhoneFieldsDeep(sheetForPersistence))

    if (existingId) {
      const { error } = await admin
        .from('design_sheets')
        .update({
          ...payload,
          client_intake_id: clientIntakeId,
          updated_at: now,
        })
        .eq('id', existingId)
        .eq('matter_id', matterId)

      if (error) throw new Error(error.message)
      if (childrenInput) await saveHouseholdChildren(admin, clientIntakeId, childrenInput)
      return NextResponse.json({
        id: existingId,
        updated_at: now,
        version: typeof existingRow?.version === 'number' ? existingRow.version : null,
      })
    }

    const { data: inserted, error } = await admin
      .from('design_sheets')
      .insert({
        matter_id: matterId,
        client_intake_id: clientIntakeId,
        version: 1,
        status: 'draft',
        ...payload,
        updated_at: now,
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    if (childrenInput) await saveHouseholdChildren(admin, clientIntakeId, childrenInput)
    return NextResponse.json({ id: inserted.id, updated_at: now, version: 1 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save design sheet'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
