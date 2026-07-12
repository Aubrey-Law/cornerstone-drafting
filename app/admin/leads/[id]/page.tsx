import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { LeadDetailClient } from './LeadDetailClient'

export const dynamic='force-dynamic'
export default async function LeadDetailPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const admin=getAdminClient();const [{data:lead},{data:spouse},{data:activity}]=await Promise.all([admin.from('client_intake').select('*').eq('id',id).maybeSingle(),admin.from('contacts').select('*').eq('client_intake_id',id).eq('relationship_type','spouse').maybeSingle(),admin.from('lead_activity').select('*').eq('lead_id',id).order('created_at',{ascending:false})]);if(!lead||!lead.lead_status)notFound();return <div className="space-y-5"><header><Link href="/admin/leads" className="text-sm text-muted-foreground">← Leads</Link><h1 className="mt-2 text-2xl font-semibold">{lead.full_name||lead.email}</h1><p className="text-sm text-muted-foreground">Lead matter · {lead.lead_status}</p></header><LeadDetailClient lead={lead} spouse={spouse} initialActivity={activity??[]}/></div>}
