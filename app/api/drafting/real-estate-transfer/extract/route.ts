import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { MAX_UPLOAD_BYTES } from '@/lib/documentUpload'
import { MAX_DEED_PDF_BYTES, PDF_MIME_TYPE } from '@/lib/realEstateTransfer/fields'
import { extractRealEstateTransferFields } from '@/lib/realEstateTransfer/extract'

function pdfValidationError(file: File | null): string | null {
  if (!file) return 'No file provided'
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES || file.size > MAX_DEED_PDF_BYTES) {
    return `PDF must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`
  }
  const name = file.name.toLowerCase()
  const type = file.type.trim().toLowerCase()
  if (type && type !== PDF_MIME_TYPE && type !== 'application/octet-stream') {
    return 'File must be a PDF'
  }
  if (!name.endsWith('.pdf')) return 'File must have a .pdf extension'
  return null
}

function errorStatus(message: string): number {
  if (message.includes('No real-estate transfer fields')) return 400
  if (message.startsWith('AI ') || message.includes('AI did not') || message.includes('AI returned')) {
    return 502
  }
  if (message.includes('PDF must') || message.includes('No file') || message.includes('must be a PDF')) {
    return 400
  }
  return 500
}

export async function POST(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const pdfFile = file instanceof File ? file : null
  const fileError = pdfValidationError(pdfFile)
  if (fileError || !pdfFile) {
    return NextResponse.json({ error: fileError ?? 'No file provided' }, { status: 400 })
  }

  try {
    const fields = await extractRealEstateTransferFields(pdfFile)
    return NextResponse.json({ ok: true, fields })
  } catch (error) {
    console.error('real-estate-transfer extract error:', error)
    const message = error instanceof Error ? error.message : 'Failed to extract deed fields'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}

export const runtime = 'nodejs'
