import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface EmailComposeDocument {
  id: string
  name: string
  size: number | null
  folder: string | null
  createdAt: string | null
}

export interface EmailComposeContext {
  recordType: 'matter' | 'lead'
  recordId: string
  recipientName: string | null
  recipientEmail: string | null
  /** Spouse, when the record has one — drives the {{spouse_*}} template variables. */
  spouseName: string | null
  spouseEmail: string | null
  /** Second address worth offering — the spouse on a matter. */
  alternateEmails: { label: string; email: string }[]
  /** Matter documents available to attach. Empty for leads. */
  documents: EmailComposeDocument[]
}

/**
 * GET /api/admin/email/compose-context?matterId=… | ?leadId=…
 *
 * Everything the rail's email pane needs to open with the right recipient and
 * an attachable document list — one read, not one per widget.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const url = new URL(req.url)
  const matterId = url.searchParams.get('matterId')?.trim() || null
  const leadId = url.searchParams.get('leadId')?.trim() || null
  if (!matterId && !leadId) {
    return NextResponse.json({ error: 'matterId or leadId is required' }, { status: 400 })
  }

  const admin = getAdminClient()

  try {
    if (matterId) {
      const [pipeline, documents] = await Promise.all([
        admin
          .from('v_matter_pipeline')
          .select('matter_id, client_name, client_email, spouse_name, spouse_email')
          .eq('matter_id', matterId)
          .maybeSingle(),
        admin
          .from('matter_documents')
          .select('id, name, size, folder, created_at')
          .eq('matter_id', matterId)
          .is('superseded_at', null)
          .order('created_at', { ascending: false })
          .limit(100),
      ])
      if (pipeline.error) throw new Error(pipeline.error.message)
      if (!pipeline.data) return NextResponse.json({ context: null })

      const spouseEmail = (pipeline.data.spouse_email as string | null)?.trim() || null
      const spouseName = (pipeline.data.spouse_name as string | null)?.trim() || null
      const context: EmailComposeContext = {
        recordType: 'matter',
        recordId: matterId,
        recipientName: (pipeline.data.client_name as string | null) ?? null,
        recipientEmail: (pipeline.data.client_email as string | null)?.trim() || null,
        spouseName,
        spouseEmail,
        alternateEmails: spouseEmail
          ? [{ label: spouseName || 'Spouse', email: spouseEmail }]
          : [],
        documents: (documents.data ?? []).map(row => ({
          id: row.id as string,
          name: (row.name as string | null) ?? 'Document',
          size: (row.size as number | null) ?? null,
          folder: (row.folder as string | null) ?? null,
          createdAt: (row.created_at as string | null) ?? null,
        })),
      }
      return NextResponse.json({ context })
    }

    const { data, error } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, email')
      .eq('id', leadId!)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ context: null })

    // A lead's spouse lives in `contacts`, not on the intake row.
    const { data: spouse } = await admin
      .from('contacts')
      .select('first_name, last_name, preferred_name, email')
      .eq('client_intake_id', leadId!)
      .eq('relationship_type', 'spouse')
      .maybeSingle()
    const spouseName = spouse
      ? [
          (spouse.preferred_name as string | null)?.trim() || (spouse.first_name as string | null)?.trim(),
          (spouse.last_name as string | null)?.trim(),
        ]
          .filter(Boolean)
          .join(' ') || null
      : null
    const spouseEmail = (spouse?.email as string | null)?.trim() || null

    const name =
      (data.full_name as string | null)?.trim() ||
      `${(data.first_name as string | null) ?? ''} ${(data.last_name as string | null) ?? ''}`.trim() ||
      null

    const context: EmailComposeContext = {
      recordType: 'lead',
      recordId: leadId!,
      recipientName: name,
      recipientEmail: (data.email as string | null)?.trim() || null,
      spouseName,
      spouseEmail,
      alternateEmails: spouseEmail ? [{ label: spouseName || 'Spouse', email: spouseEmail }] : [],
      // Leads have no matter document library yet — computer uploads only.
      documents: [],
    }
    return NextResponse.json({ context })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load compose context' },
      { status: 500 },
    )
  }
}
