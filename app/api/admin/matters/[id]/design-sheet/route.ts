import { NextResponse } from 'next/server'
import { buildDesignSheetPersistencePayload, inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { saveHouseholdChildren } from '@/lib/contacts/saveHouseholdChildren'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { updatedAtMatches } from '@/lib/designSheet/updatedAt'
import type { DesignSheetUpdate } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type Params = { params: Promise<{ id: string }> }
type AdminClient = SupabaseClient<Database>

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

async function fetchDesignSheetRow(
  admin: AdminClient,
  matterId: string,
  sheetId?: string | null,
): Promise<Record<string, unknown> | null> {
  if (sheetId) {
    const { data, error } = await admin
      .from('design_sheets')
      .select('*')
      .eq('id', sheetId)
      .eq('matter_id', matterId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return data as Record<string, unknown>
  }

  const { data, error } = await admin
    .from('design_sheets')
    .select('*')
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as Record<string, unknown> | null
}

async function readSavedUpdatedAt(admin: AdminClient, sheetId: string): Promise<string> {
  const { data, error } = await admin
    .from('design_sheets')
    .select('updated_at')
    .eq('id', sheetId)
    .single()

  if (error) throw new Error(error.message)
  return typeof data?.updated_at === 'string' ? data.updated_at : new Date().toISOString()
}

function shouldSyncChildren(
  childrenInput: Array<Record<string, unknown>> | null,
  existingChildren: unknown,
): boolean {
  if (!childrenInput) return false
  if (childrenInput.length > 0) return true
  return Array.isArray(existingChildren) && existingChildren.length > 0
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
    let existingRow = await fetchDesignSheetRow(admin, matterId, sheetId)

    const existingId = typeof existingRow?.id === 'string' ? existingRow.id : null
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    const currentUpdatedAt = typeof existingRow?.updated_at === 'string' ? existingRow.updated_at : null
    if (existingId && expectedUpdatedAt && currentUpdatedAt && !updatedAtMatches(expectedUpdatedAt, currentUpdatedAt)) {
      return NextResponse.json(
        { error: 'Design sheet was updated elsewhere.', conflict: true, updated_at: currentUpdatedAt },
        { status: 409 },
      )
    }

    if (!existingRow) {
      await ensureDesignSheetSeededFromIntake(matterId)
      existingRow = await fetchDesignSheetRow(admin, matterId, sheetId)
    }

    const existingSheet = inflateDesignSheetRow(existingRow)
    const resolvedExistingId = typeof existingRow?.id === 'string' ? existingRow.id : null
    const sheetForPersistence = existingSheet
      ? ({ ...existingSheet, ...body.sheet } as DesignSheetUpdate)
      : body.sheet
    const payload = buildDesignSheetPersistencePayload(formatPhoneFieldsDeep(sheetForPersistence))
    const syncChildren = shouldSyncChildren(childrenInput, existingSheet?.children)

    if (resolvedExistingId) {
      const { error } = await admin
        .from('design_sheets')
        .update({
          ...payload,
          client_intake_id: clientIntakeId,
          updated_at: now,
        })
        .eq('id', resolvedExistingId)
        .eq('matter_id', matterId)

      if (error) throw new Error(error.message)
      if (syncChildren && childrenInput) {
        await saveHouseholdChildren(admin, clientIntakeId, childrenInput, { updatedAt: now })
      }
      const savedAt = await readSavedUpdatedAt(admin, resolvedExistingId)
      return NextResponse.json({
        id: resolvedExistingId,
        updated_at: savedAt,
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
    if (syncChildren && childrenInput) {
      await saveHouseholdChildren(admin, clientIntakeId, childrenInput, { updatedAt: now })
    }
    const savedAt = await readSavedUpdatedAt(admin, inserted.id)
    return NextResponse.json({ id: inserted.id, updated_at: savedAt, version: 1 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save design sheet'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
