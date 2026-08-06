import { NextResponse } from 'next/server'
import { suppressCampaignDeliveryByToken } from '@/lib/crm/campaignDispatch'

type Context = { params: Promise<{ token: string }> }
export async function GET(_req: Request, { params }: Context) {
  const token = (await params).token
  if (!/^[a-f0-9]{64}$/i.test(token)) return new NextResponse('Invalid unsubscribe link', { status: 400 })
  const updated = await suppressCampaignDeliveryByToken(token, 'unsubscribed')
  if (!updated) return new NextResponse('This unsubscribe link is no longer valid.', { status: 404 })
  return new NextResponse('<!doctype html><title>Unsubscribed</title><main style="font-family:system-ui;max-width:36rem;margin:4rem auto"><h1>You have been unsubscribed.</h1><p>You will no longer receive Cornerstone marketing emails at this address.</p></main>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
