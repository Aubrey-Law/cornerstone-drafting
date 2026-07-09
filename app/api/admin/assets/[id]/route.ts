import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

function makeClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

async function requireAdminWithClient(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return { sb: null, err }
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  return { sb: makeClient(token), err: null }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sb, err } = await requireAdminWithClient(req)
  if (err) return err
  const { id } = await params

  const { data, error } = await sb!
    .from('asset_intake')
    .select('*')
    .eq('client_intake_id', id)
    .order('category')
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sb, err } = await requireAdminWithClient(req)
  if (err) return err
  const { id } = await params
  const body = await req.json()

  const { data, error } = await sb!
    .from('asset_intake')
    .insert({
      client_intake_id: id,
      category: body.category,
      description: body.description || '',
      value: Number(body.value) || 0,
      ownership: body.ownership ?? 'client',
      details: body.details ?? {},
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sb, err } = await requireAdminWithClient(req)
  if (err) return err
  const { id } = await params
  const { asset_id, ...fields } = await req.json()

  const { error } = await sb!
    .from('asset_intake')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', asset_id)
    .eq('client_intake_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sb, err } = await requireAdminWithClient(req)
  if (err) return err
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const assetId = searchParams.get('asset_id')
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const { error } = await sb!
    .from('asset_intake')
    .delete()
    .eq('id', assetId)
    .eq('client_intake_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
