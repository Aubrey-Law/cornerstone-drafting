import { NextRequest, NextResponse } from 'next/server'
import { dispatchDueCampaignDeliveries } from '@/lib/crm/campaignDispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await dispatchDueCampaignDeliveries())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Campaign scheduler failed' }, { status: 500 })
  }
}
