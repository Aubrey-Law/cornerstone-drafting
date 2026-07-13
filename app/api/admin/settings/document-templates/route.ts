import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { listDocumentTemplates } from '@/lib/documentTemplates/repository'

export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  try {
    return NextResponse.json(await listDocumentTemplates())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export const runtime = 'nodejs'

