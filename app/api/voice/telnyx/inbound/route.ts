import { buildTelnyxInboundTexml, telnyxInboundRouteConfig } from '@/lib/telnyx/inbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function response(): Response {
  const config = telnyxInboundRouteConfig()
  if (!config) console.error('Telnyx inbound routing is not configured')
  return new Response(buildTelnyxInboundTexml(config), {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export const GET = response
export const POST = response
