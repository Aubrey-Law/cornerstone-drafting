import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchBillingMatterOptions } from '@/lib/queries/billing'
export async function GET(req:Request) {
  const auth=await requireAdmin(req)
  if(auth.err) return auth.err
  const params=new URL(req.url).searchParams,query=params.get('q') ?? '',selected=params.get('selected') ?? undefined
  if(query.length>200 || (selected && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected))) return NextResponse.json({error:'Invalid matter search'},{status:400})
  try {return NextResponse.json({matters:await fetchBillingMatterOptions(query,selected)},{headers:{'Cache-Control':'no-store'}})}
  catch {return NextResponse.json({error:'Matter choices unavailable'},{status:503})}
}
