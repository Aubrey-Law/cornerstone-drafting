import { fetchCrmCampaignById } from '@/lib/queries/cornerstoneCrm'
import { CrmCampaignDetailClient } from './CampaignDetailClient'

interface PageProps {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params
  const { campaign, error } = await fetchCrmCampaignById(id)

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Campaign detail</h1>
        <p className="text-sm text-destructive">Could not load campaign ({error}).</p>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Campaign detail</h1>
        <p className="text-sm text-muted-foreground">Campaign not found.</p>
      </div>
    )
  }

  return <CrmCampaignDetailClient initialCampaign={campaign} />
}
