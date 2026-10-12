import { fetchFirmDashboard } from '@/lib/queries/firmDashboard'
import { FirmDashboardView } from './FirmDashboardView'

export async function FirmDashboard({ viewerId }: { viewerId: string }) {
  const data = await fetchFirmDashboard(viewerId)
  return (
    <FirmDashboardView
      snapshot={data.snapshot}
      matters={data.matters}
      crm={data.crm}
      recent={data.recent}
      closeout={data.closeout}
      workSummaries={data.workSummaries}
      mattersError={data.mattersError}
      crmError={data.crmError}
      truncated={data.truncated}
      peopleCeiling={data.peopleCeiling}
    />
  )
}
