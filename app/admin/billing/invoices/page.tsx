import { getCachedClaims } from '@/lib/supabaseServer'
import { InvoiceRegister } from '../InvoiceRegister'
export const dynamic = 'force-dynamic'
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  if (!await getCachedClaims()) return null
  return <InvoiceRegister params={await searchParams} />
}
