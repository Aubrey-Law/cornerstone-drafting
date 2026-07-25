import { getFirmConfig } from '@/lib/firmConfig'
import ManageBookingClient from './ManageBookingClient'

export const dynamic = 'force-dynamic'

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const firm = getFirmConfig()

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {firm.firmName}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">Manage your appointment</h1>
      <div className="mt-8">
        <ManageBookingClient token={token} />
      </div>
    </div>
  )
}
