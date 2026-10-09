/** Synthetic local-only fixtures. Requires published bundles and LOCAL pinning enabled. */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
async function main() {
config({ path: '.env.local', quiet: true })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Acceptance fixtures require a local Supabase URL')
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { data: users, error: usersError } = await admin.auth.admin.listUsers()
if (usersError) throw usersError
for (const track of ['estate', 'college_prep']) {
  const email = `${track}-acceptance@example.test`
  let user = users.users.find(user => user.email === email)
  if (!user) {
    const created = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true })
    if (created.error) throw created.error
    user = created.data.user
  }
  const profile = await admin.from('users').upsert({ id: user!.id, email, role: 'client', display_name: `${track} Acceptance` })
  if (profile.error) throw profile.error
  let result = await admin.from('client_intake').select('id,form_version_id').eq('email', email).maybeSingle()
  if (result.error) throw result.error
  if (!result.data) result = await admin.from('client_intake').insert({
    user_id: user!.id, client_user_id: user!.id, email, first_name: track === 'estate' ? 'Estate' : 'College', last_name: 'Acceptance',
    phone: '6175550100', date_of_birth: '2000-01-01', address_line1: '1 Test Street', city: 'Boston', state: 'MA', zip: '02108', county: 'Suffolk',
    practice_area: track === 'estate' ? 'EP' : 'CP', intake_track: track, status: 'draft', marital_status: 'Single', has_children: false, has_minor_children: false,
  }).select('id,form_version_id').single()
  if (result.error || !result.data?.form_version_id) throw result.error ?? new Error('Fixture was not pinned; enable rollout in the disposable stack only')
  let matter = await admin.from('matters').select('id').eq('client_intake_id', result.data.id).maybeSingle()
  if (!matter.error && !matter.data) matter = await admin.from('matters').insert({
    client_intake_id: result.data.id, client_id: user!.id, name: `${track} Acceptance`, matter_number: `ACCEPT-${track}`,
  }).select('id').single()
  if (matter.error) throw matter.error
  console.log(JSON.stringify({ track, email, intakeId: result.data.id, versionId: result.data.form_version_id, matterId: matter.data?.id }))
}

}
main().catch(error => { console.error(error?.message ?? 'Local fixture creation failed'); process.exitCode = 1 })
