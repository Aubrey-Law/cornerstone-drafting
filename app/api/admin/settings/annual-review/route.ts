import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { parseSettingsPatch } from '@/lib/annualReview/model'
import { loadAnnualReviewSettings, previewAnnualReviewOutreach, updateAnnualReviewSettings } from '@/lib/annualReview/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — the campaign's settings and who would be asked in the next run. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    const [settings, preview] = await Promise.all([loadAnnualReviewSettings(), previewAnnualReviewOutreach()])
    return NextResponse.json({ settings, preview })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load annual review settings' }, { status: 500 })
  }
}

/** PATCH — change the cadence or switch the campaign on or off. Administrators only. */
export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err) return auth.err
  const body = await req.json().catch(() => null)
  let patch
  try {
    patch = parseSettingsPatch(body)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid settings' }, { status: 400 })
  }
  try {
    const settings = await updateAnnualReviewSettings(patch)
    return NextResponse.json({ settings })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save annual review settings' }, { status: 500 })
  }
}
