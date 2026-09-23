import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listAllLawmaticsOptions } from '@/lib/integrations/lawmatics/options'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/settings/lawmatics/options — the firm's Lawmatics practice
 * areas, sources and campaigns, for the picklist mapping. Each list loads on
 * its own, so one Lawmatics failure leaves the others (and manual IDs) usable.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  return NextResponse.json(await listAllLawmaticsOptions())
}
