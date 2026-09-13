import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import WorksClient from './WorksClient'

export default async function WorksPage() {
  // Every endpoint behind the Document masters tab is administrator-only. The
  // tab used to render for attorneys too and answered with "Could not load
  // document templates" — a 403 dressed up as a load failure.
  const auth = await getCachedClaims()
  const role = auth ? await getCachedUserRole(auth.id) : null
  return <WorksClient canManageMasters={role === 'admin'} />
}
