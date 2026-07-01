import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import PizZip from 'pizzip'
import { requireAdmin } from '@/lib/apiAuth'
import { generateDocuments } from '@/lib/drafting/generateDocuments'

function makeClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

export async function POST(req: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const token = req.headers.get('authorization')!.replace('Bearer ', '')
  const sb = makeClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sheetId } = await params

  const result = await generateDocuments(sb, sheetId, user.id)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // Pack individual files into a ZIP archive for the response
  const outputZip = new PizZip()
  for (const file of result.files) {
    outputZip.file(file.name, file.buffer)
  }
  const zipBuffer = new Uint8Array(outputZip.generate({ type: 'uint8array', compression: 'DEFLATE' }))

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="drafts-${result.clientSlug}.zip"`,
      'X-Missing-Templates': result.missing.join(','),
    },
  })
}
