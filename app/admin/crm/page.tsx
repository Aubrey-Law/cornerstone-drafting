import { fetchCrmPeople, fetchCrmStages } from '@/lib/queries/cornerstoneCrm'
import { CrmPeopleClient } from './CrmPeopleClient'

export const dynamic = 'force-dynamic'

const CRM_DEFAULT_LIMIT = 250

export default async function AdminCrmPage() {
  const [peopleResult, stageResult] = await Promise.all([
    fetchCrmPeople(CRM_DEFAULT_LIMIT),
    fetchCrmStages(),
  ])

  if (peopleResult.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Cornerstone CRM</h1>
        <p className="text-sm text-destructive">Could not load CRM data ({peopleResult.error}).</p>
      </div>
    )
  }

  if (stageResult.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Cornerstone CRM</h1>
        <p className="text-sm text-destructive">Could not load CRM stages ({stageResult.error}).</p>
      </div>
    )
  }

  const twentyContactUrlTemplate =
    process.env.NEXT_PUBLIC_TWENTY_CONTACT_URL_TEMPLATE
    || process.env.NEXT_PUBLIC_CORNERSTONE_TWENTY_CONTACT_URL_TEMPLATE
    || ''

  return (
    <CrmPeopleClient
      initialPeople={peopleResult.people}
      twentyContactUrlTemplate={twentyContactUrlTemplate}
    />
  )
}
