import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { buildAlternateEmails } from '@/lib/contacts/additionalChannels'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface EmailComposeDocument {
  id: string
  name: string
  size: number | null
  source: string | null
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
  /**
   * Other addresses worth offering — the spouse on a matter, plus any
   * additional emails recorded for the client or the spouse.
   */
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
      const [pipeline, documents, matterRow] = await Promise.all([
        admin
          .from('v_matter_pipeline')
          .select('matter_id, client_name, client_email, spouse_name, spouse_email')
          .eq('matter_id', matterId)
          .maybeSingle(),
        admin
          .from('matter_documents')
          .select('id, name, size, source, created_at')
          .eq('matter_id', matterId)
          .is('superseded_at', null)
          .order('created_at', { ascending: false })
          .limit(100),
        admin.from('matters').select('client_intake_id').eq('id', matterId).maybeSingle(),
      ])
      if (pipeline.error) throw new Error(pipeline.error.message)
      if (!pipeline.data) return NextResponse.json({ context: null })

      const spouseEmail = (pipeline.data.spouse_email as string | null)?.trim() || null
      const spouseName = (pipeline.data.spouse_name as string | null)?.trim() || null
      const clientEmail = (pipeline.data.client_email as string | null)?.trim() || null

      // The pipeline view carries the primary addresses only; the extras live
      // on the intake row and the spouse contact behind it.
      const intakeId = (matterRow.data?.client_intake_id as string | null) ?? null
      const [intakeExtras, spouseExtras] = intakeId
        ? await Promise.all([
            admin.from('client_intake').select('additional_emails').eq('id', intakeId).maybeSingle(),
            // Through the join (step 3 of docs/matter-contacts-migration.md) —
            // this branch already has the matter.
            loadSpouseContact(admin, matterId, 'additional_emails').then(
              data => ({ data: data as Record<string, unknown> | null }),
              () => ({ data: null }),
            ),
          ])
        : [{ data: null }, { data: null }]

      const context: EmailComposeContext = {
        recordType: 'matter',
        recordId: matterId,
        recipientName: (pipeline.data.client_name as string | null) ?? null,
        recipientEmail: clientEmail,
        spouseName,
        spouseEmail,
        alternateEmails: buildAlternateEmails(
          [
            { person: spouseName || 'Spouse', primary: spouseEmail, additional: spouseExtras.data?.additional_emails },
            { person: 'Client', additional: intakeExtras.data?.additional_emails },
          ],
          clientEmail,
        ),
        documents: (documents.data ?? []).map(row => ({
          id: row.id as string,
          name: (row.name as string | null) ?? 'Document',
          size: (row.size as number | null) ?? null,
          source: (row.source as string | null) ?? null,
          createdAt: (row.created_at as string | null) ?? null,
        })),
      }
      return NextResponse.json({ context })
    }

    const { data, error } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, email, additional_emails, matter_id')
      .eq('id', leadId!)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ context: null })

    // A lead's spouse lives in `contacts`, reached through its matter since
    // step 3 of docs/matter-contacts-migration.md.
    const leadMatterId = (data.matter_id as string | null) ?? null
    const spouse = leadMatterId
      ? ((await loadSpouseContact(
          admin,
          leadMatterId,
          'first_name, last_name, preferred_name, email, additional_emails',
        )) as Record<string, unknown> | null)
      : null
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
      alternateEmails: buildAlternateEmails(
        [
          { person: spouseName || 'Spouse', primary: spouseEmail, additional: spouse?.additional_emails },
          { person: 'Client', additional: data.additional_emails },
        ],
        (data.email as string | null)?.trim() || null,
      ),
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
