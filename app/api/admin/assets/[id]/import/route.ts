import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic, PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { syncAssetIntakeToDesignSheetForIntake } from '@/lib/assets/syncAssetIntakeToDesignSheet'
import { insertImportedAssetRows } from '@/lib/import/assetImportRows'
import { extractDocumentText } from '@/lib/import/extractDocumentText'
import { isAssetSpreadsheetFile, parseAssetSpreadsheet } from '@/lib/import/parseAssetSpreadsheet'
import { getAdminClient } from '@/lib/supabaseAdmin'

function makeClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

const ASSETS_EXTRACT_PROMPT = `You are an estate planning paralegal. Extract ONLY asset / property / account line items from the following document and return JSON only — no explanation, no markdown, just raw JSON.

Return this shape:
{
  "assets": [
    {
      "category": string (one of: real_estate, bank_accounts, investments, retirement, life_insurance, business, vehicles, personal_property, inheritance, crypto, other),
      "description": string,
      "value": number,
      "ownership": string (one of: client, spouse, joint),
      "details": object (optional: institution, mortgage_balance, account_type, beneficiary, property_type, etc.)
    }
  ]
}

If no assets are found, return { "assets": [] }.

Document:
`

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: clientIntakeId } = await params
  const formData = await req.formData()
  const file = formData.get('file') as File | null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const sb = makeClient(token)

  if (isAssetSpreadsheetFile(file.name, file.type)) {
    try {
      const assets = await parseAssetSpreadsheet(file)
      const result = await insertImportedAssetRows(sb, clientIntakeId, assets)
      if (result.inserted > 0) {
        void syncAssetIntakeToDesignSheetForIntake(getAdminClient(), clientIntakeId)
      }
      return NextResponse.json({ ...result, source: 'spreadsheet' })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  let text: string
  try {
    text = await extractDocumentText(file)
  } catch (e) {
    return NextResponse.json({ error: `Could not read file: ${(e as Error).message}` }, { status: 400 })
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'File appears to be empty or unreadable' }, { status: 400 })
  }

  const message = await callAnthropic(
    {
      model: await resolveFirmModel('light'),
      max_tokens: 2048,
      system: PROMPT_INJECTION_GUARDRAIL,
      messages: [{
        role: 'user',
        content: ASSETS_EXTRACT_PROMPT + '\n' + quoteUserContent('imported_document', text.slice(0, 12000)),
      }],
    },
    { route: 'admin/assets/import', contextType: 'general', userId },
  )

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  let extracted: { assets?: unknown[] }
  try {
    extracted = JSON.parse(raw.replace(/^```json\n?/, '').replace(/\n?```$/, ''))
  } catch {
    return NextResponse.json({ error: 'AI could not parse assets from document', raw }, { status: 422 })
  }

  const assetList = Array.isArray(extracted.assets) ? extracted.assets : []
  if (assetList.length === 0) {
    return NextResponse.json({ inserted: 0, assets: [], source: 'document' })
  }

  try {
    const result = await insertImportedAssetRows(sb, clientIntakeId, assetList)
    if (result.inserted > 0) {
      void syncAssetIntakeToDesignSheetForIntake(getAdminClient(), clientIntakeId)
    }
    return NextResponse.json({ ...result, source: 'document' })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
