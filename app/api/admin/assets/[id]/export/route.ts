import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { calculateMAEstateTax, ASSET_CATEGORIES } from '@/lib/estateTax'
import { requireAdmin } from '@/lib/apiAuth'

function makeClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const token = req.headers.get('authorization')!.replace('Bearer ', '')
  const sb = makeClient(token)

  const { id } = await params

  const [intakeRes, assetsRes] = await Promise.all([
    sb.from('client_intake').select('full_name').eq('id', id).single(),
    sb.from('asset_intake').select('*').eq('client_intake_id', id).order('category').order('created_at'),
  ])

  const clientName = intakeRes.data?.full_name ?? 'Client'
  const assets = assetsRes.data ?? []

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Assets')

  ws.addRow([`Asset Inventory — ${clientName}`])
  ws.addRow([`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`])
  ws.addRow([])
  ws.addRow(['Category', 'Description', 'Ownership', 'Value', 'Property Type', 'Mortgage Balance', 'Institution', 'Account Type', 'Beneficiary', 'Insured', 'From Whom', 'Timeline', 'Exchange/Wallet'])

  let grandTotal = 0, clientTotal = 0, spouseTotal = 0, jointTotal = 0

  for (const cat of ASSET_CATEGORIES) {
    const catAssets = assets.filter(a => a.category === cat.key)
    if (catAssets.length === 0) continue

    let catTotal = 0
    for (const a of catAssets) {
      const d = (a.details ?? {}) as Record<string, string | number>
      const ownership = a.ownership === 'client' ? 'Client' : a.ownership === 'spouse' ? 'Spouse' : 'Joint'
      const val = Number(a.value)
      ws.addRow([
        cat.label,
        a.description ?? '',
        ownership,
        val,
        d.property_type ?? '',
        d.mortgage_balance ? Number(d.mortgage_balance) : '',
        d.institution ?? '',
        d.account_type ?? '',
        d.beneficiary ?? '',
        d.insured ?? '',
        d.from_whom ?? '',
        d.timeline ?? '',
        (d.institution && cat.key === 'crypto') ? String(d.institution) : '',
      ])
      catTotal += val
      if (a.ownership === 'client') clientTotal += val
      else if (a.ownership === 'spouse') spouseTotal += val
      else jointTotal += val
    }
    ws.addRow([`${cat.label} Subtotal`, '', '', catTotal])
    ws.addRow([])
    grandTotal += catTotal
  }

  ws.addRow(['SUMMARY'])
  ws.addRow(['Client Owned', '', '', clientTotal])
  ws.addRow(['Spouse Owned', '', '', spouseTotal])
  ws.addRow(['Joint Owned', '', '', jointTotal])
  ws.addRow(['Grand Total', '', '', grandTotal])
  ws.addRow([])

  const tax = calculateMAEstateTax(grandTotal)
  ws.addRow(['MA ESTATE TAX (2023)'])
  ws.addRow(['Total Estate', '', '', grandTotal])
  ws.addRow(['Estimated MA Estate Tax', '', '', tax])
  if (tax === 0) {
    ws.addRow(['Estate is below $2M threshold — no MA estate tax due'])
  } else {
    ws.addRow(['Note: Consult an attorney for exact calculation.'])
  }

  ws.columns = [
    { width: 24 }, { width: 30 }, { width: 10 }, { width: 16 }, { width: 18 },
    { width: 16 }, { width: 20 }, { width: 16 }, { width: 18 }, { width: 16 },
    { width: 16 }, { width: 14 }, { width: 18 },
  ]

  // Currency format on Value (col 4) and Mortgage Balance (col 6) starting at the data row
  for (let r = 5; r <= ws.rowCount; r++) {
    for (const c of [4, 6]) {
      const cell = ws.getRow(r).getCell(c)
      if (typeof cell.value === 'number') cell.numFmt = '"$"#,##0.00'
    }
  }

  const buf = await wb.xlsx.writeBuffer()

  const safeName = clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="assets_${safeName}.xlsx"`,
    },
  })
}
