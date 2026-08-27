import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { extractStyleSetFromDocx } from '@/lib/styleSets/extract'

/**
 * Derive a style set from an uploaded Word document.
 *
 * Deliberately does **not** save anything. Extraction is a reading of a
 * template, and what it reads is sometimes a compromise — a document with three
 * fonts cannot be described by a style set that has one. So the settings and
 * the caveats come back together for somebody to look at, and saving is a
 * separate, deliberate POST.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith('.docx') && file.type !== DOCX_MIME) {
    return NextResponse.json({ error: 'Only Word .docx documents are supported' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Word document is too large (10 MB max)' }, { status: 400 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const { settings, notes } = extractStyleSetFromDocx(buffer)
    return NextResponse.json({ settings, notes, sourceFileName: file.name })
  } catch (error) {
    // A file that will not parse is the uploader's problem to fix, not a fault.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to read that document' },
      { status: 400 },
    )
  }
}
