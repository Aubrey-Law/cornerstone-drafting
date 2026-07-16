import { requireAdmin } from '@/lib/apiAuth'
import {
  listEstateClauses,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import type { EstateDocumentType } from '@/lib/estateClauses/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

const DOCUMENT_TYPES = new Set<EstateDocumentType>([
  'will',
  'trust',
  'durable_power_of_attorney',
  'health_care_directive',
  'hipaa_authorization',
  'ancillary',
])

function validDocumentTypes(value: unknown): value is EstateDocumentType[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string' && DOCUMENT_TYPES.has(item as EstateDocumentType))
    && new Set(value).size === value.length
}

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  try {
    const clauses = await listEstateClauses({
      client: getAdminClient() as unknown as EstateClauseClient,
    })
    return Response.json({ clauses })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to list estate clauses' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const clauseKey = typeof body?.clauseKey === 'string' ? body.clauseKey.trim() : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const documentTypes = body?.documentTypes
  if (
    !userId
    || !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(clauseKey)
    || !title
    || !validDocumentTypes(documentTypes)
  ) {
    return Response.json({ error: 'A stable clause key, title, and compatible document types are required' }, { status: 400 })
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const { data, error } = await client
      .from('estate_clauses')
      .insert({
        clause_key: clauseKey,
        title,
        jurisdiction: 'MA',
        document_types: documentTypes,
        created_by: userId,
      })
      .select('id,clause_key,title,jurisdiction,document_types,is_active,created_at,updated_at')
      .single()
    if (error) {
      const status = /duplicate|unique/i.test(error.message) ? 409 : 500
      return Response.json({ error: error.message }, { status })
    }
    const row = data as {
      id: string
      clause_key: string
      title: string
      jurisdiction: 'MA'
      document_types: EstateDocumentType[]
      is_active: boolean
      created_at: string
      updated_at: string
    }
    return Response.json({
      clause: {
        id: row.id,
        clauseKey: row.clause_key,
        title: row.title,
        jurisdiction: row.jurisdiction,
        documentTypes: row.document_types,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    }, { status: 201 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create estate clause' }, { status: 500 })
  }
}
