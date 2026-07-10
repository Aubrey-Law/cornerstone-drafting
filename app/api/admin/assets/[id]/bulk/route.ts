import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { insertAssetIntakeRows } from '@/lib/assets/insertAssetIntakeRows'
import { syncAssetIntakeToDesignSheetForIntake } from '@/lib/assets/syncAssetIntakeToDesignSheet'
import { ASSET_CATEGORIES, type AssetCategory, type Ownership } from '@/lib/estateTax'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { AssetIntakeInput } from '@/types/assetIntake'

const MAX_BULK_ASSETS = 100
const VALID_CATEGORIES = new Set(ASSET_CATEGORIES.map(c => c.key))
const VALID_OWNERSHIP = new Set<Ownership>(['client', 'spouse', 'joint'])

function makeClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

function coerceAssetInput(raw: unknown, index: number): AssetIntakeInput | string {
  if (!raw || typeof raw !== 'object') return `Row ${index + 1}: invalid asset`
  const record = raw as Record<string, unknown>
  const description = String(record.description ?? '').trim()
  if (!description) return `Row ${index + 1}: description is required`

  const category = String(record.category ?? 'other') as AssetCategory
  if (!VALID_CATEGORIES.has(category)) return `Row ${index + 1}: invalid category`

  const ownership = String(record.ownership ?? 'client') as Ownership
  if (!VALID_OWNERSHIP.has(ownership)) return `Row ${index + 1}: invalid ownership`

  const details =
    record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? (record.details as AssetIntakeInput['details'])
      : {}

  return {
    category,
    description,
    value: Number(record.value) || 0,
    ownership,
    details,
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: clientIntakeId } = await params
  const body = await req.json().catch(() => null)
  const rawAssets = Array.isArray(body?.assets) ? body.assets : null
  if (!rawAssets) return NextResponse.json({ error: 'assets array required' }, { status: 400 })
  if (rawAssets.length === 0) return NextResponse.json({ error: 'At least one asset is required' }, { status: 400 })
  if (rawAssets.length > MAX_BULK_ASSETS) {
    return NextResponse.json({ error: `Bulk add is limited to ${MAX_BULK_ASSETS} assets` }, { status: 400 })
  }

  const assets: AssetIntakeInput[] = []
  for (let i = 0; i < rawAssets.length; i++) {
    const coerced = coerceAssetInput(rawAssets[i], i)
    if (typeof coerced === 'string') return NextResponse.json({ error: coerced }, { status: 400 })
    assets.push(coerced)
  }

  const sb = makeClient(token)
  try {
    const result = await insertAssetIntakeRows(sb, clientIntakeId, assets)
    if (result.inserted > 0) {
      void syncAssetIntakeToDesignSheetForIntake(getAdminClient(), clientIntakeId)
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
