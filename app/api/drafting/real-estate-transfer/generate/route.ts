import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { RealEstateTransferGenerateRequestSchema } from '@/lib/realEstateTransfer/fields'
import {
  renderRealEstateTransferPackage,
  safeDownloadFilename,
} from '@/lib/realEstateTransfer/generate'

export async function POST(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RealEstateTransferGenerateRequestSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const { buffer, contentType, filename } = renderRealEstateTransferPackage(
      parsed.data.documents,
      parsed.data.fields,
    )

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeDownloadFilename(filename)}"`,
      },
    })
  } catch (error) {
    console.error('real-estate-transfer generate error:', error)
    const message = error instanceof Error ? error.message : 'Failed to generate documents'
    const status = message.includes('Template not found') ? 500 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

export const runtime = 'nodejs'
