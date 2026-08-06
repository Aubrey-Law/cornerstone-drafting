import { fetchCrmPeople } from '@/lib/queries/cornerstoneCrm'
import { CrmPeopleClient } from '../CrmPeopleClient'

export const dynamic = 'force-dynamic'

export default async function CrmPeoplePage() {
  const result = await fetchCrmPeople(250)
  if (result.error) {
    return <div className="space-y-4"><h1 className="text-xl font-semibold">People</h1><p className="text-sm text-destructive">Could not load people ({result.error}).</p></div>
  }
  return <CrmPeopleClient initialPeople={result.people} />
}
