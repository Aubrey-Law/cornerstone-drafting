import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import { applyDesignPlanType } from '@/lib/designSheet/applyPlanType'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

/**
 * Matter details edits plan type here, on the design sheet — the same place
 * the design sheet's Plan Type block writes. `matter_details.plan_type` stays
 * rejected so the page cannot grow a second copy.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { planType?: unknown } | null
  const planType = normalizeDesignPlanType(body?.planType)
  if (!planType) {
    return NextResponse.json({ error: 'Plan type is not one this firm drafts' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const { id: rawId } = await params
    const matterId = await resolveMatterId(rawId, admin).catch(error => {
      if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null
      throw error
    })
    if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const row = await fetchLatestSheet(admin, matterId)
      if (!row) {
        if (attempt === 0) {
          await ensureDesignSheetSeededFromIntake(matterId)
          continue
        }
        return NextResponse.json({ error: 'This matter has no design sheet yet' }, { status: 409 })
      }

      const sheet = inflateDesignSheetRow(row)
      if (!sheet) {
        return NextResponse.json({ error: 'This matter has no design sheet yet' }, { status: 409 })
      }

      const applied = applyDesignPlanType(sheet, planType)
      const now = new Date().toISOString()
      const sheetId = typeof row.id === 'string' ? row.id : null
      if (!sheetId) {
        return NextResponse.json({ error: 'This matter has no design sheet yet' }, { status: 409 })
      }

      let update = admin
        .from('design_sheets')
        .update({
          plan_type: applied.planType,
          updated_at: now,
          ...(applied.decisions ? { decisions: applied.decisions } : {}),
        })
        .eq('id', sheetId)
        .eq('matter_id', matterId)

      const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null
      if (updatedAt) update = update.eq('updated_at', updatedAt)

      const { data: updatedRows, error } = await update.select('id')
      if (error) throw new Error(error.message)
      if (updatedRows && updatedRows.length > 0) {
        return NextResponse.json({ matterId, planType: applied.planType })
      }
    }

    return NextResponse.json(
      { error: 'Design sheet was updated elsewhere.' },
      { status: 409 },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update plan type' },
      { status: 500 },
    )
  }
}

async function fetchLatestSheet(
  admin: ReturnType<typeof getAdminClient>,
  matterId: string,
): Promise<Record<string, unknown> | null> {
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
