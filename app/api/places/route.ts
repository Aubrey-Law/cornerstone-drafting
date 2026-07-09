import { NextResponse } from 'next/server'

const KEY = process.env.GOOGLE_PLACES_API_KEY

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30
const ipHits = new Map<string, { count: number; resetAt: number }>()

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = ipHits.get(ip)
  if (!entry || entry.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  entry.count += 1
  return entry.count <= RATE_MAX
}

// Same-origin guard: this endpoint is consumed by admin and intake forms.
// Both flows always issue the request from one of our own pages. Without a
// guard, anyone could front-run our Google Places quota.
function isSameOrigin(req: Request): boolean {
  const host = req.headers.get('host')
  if (!host) return false
  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const expected = [`http://${host}`, `https://${host}`]
  if (origin && expected.some(e => origin === e || origin.startsWith(`${e}/`))) return true
  if (referer && expected.some(e => referer.startsWith(`${e}/`) || referer === e)) return true
  return false
}

export async function GET(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!KEY) {
    return NextResponse.json({ error: 'Address search is not configured' }, { status: 503 })
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const input = searchParams.get('input')
  const placeId = searchParams.get('place_id')

  if (action === 'autocomplete' && input) {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&types=address&key=${KEY}`
    const res = await fetch(url)
    const data = await res.json()
    return NextResponse.json(data.predictions ?? [], {
      headers: { 'Cache-Control': 'private, max-age=600' },
    })
  }

  if (action === 'details' && placeId) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=address_components&key=${KEY}`
    const res = await fetch(url)
    const data = await res.json()
    const components: { types: string[]; long_name: string; short_name: string }[] = data.result?.address_components ?? []

    let streetNumber = '', route = '', city = '', state = '', zip = '', county = ''
    for (const c of components) {
      if (c.types.includes('street_number')) streetNumber = c.long_name
      else if (c.types.includes('route')) route = c.short_name
      else if (c.types.includes('locality')) city = c.long_name
      else if (c.types.includes('administrative_area_level_1')) state = c.short_name
      else if (c.types.includes('administrative_area_level_2')) county = c.long_name.replace(/ County$/i, '')
      else if (c.types.includes('postal_code')) zip = c.long_name
    }

    return NextResponse.json({
      address_line1: [streetNumber, route].filter(Boolean).join(' '),
      city, state, zip, county,
    }, {
      headers: { 'Cache-Control': 'private, max-age=86400' },
    })
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
}
