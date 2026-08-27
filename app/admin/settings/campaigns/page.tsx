import { CrmCampaignsClient } from './CampaignsClient'
import { fetchCrmCampaigns } from '@/lib/queries/cornerstoneCrm'

export const dynamic = 'force-dynamic'

export default async function CrmCampaignsPage() {
  const { campaigns, error } = await fetchCrmCampaigns({ limit: 250 })

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        <p className="text-sm text-destructive">Could not load campaign data ({error}).</p>
      </div>
    )
  }

  return <CrmCampaignsClient initialCampaigns={campaigns} />
}
