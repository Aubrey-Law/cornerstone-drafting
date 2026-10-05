import { getFirmConfig } from '@/lib/firmConfig'
import { loadFirmSettings } from '@/lib/firmSettings'
import { firmOfficeAddress } from '@/lib/appointments/officeAddress'
import ManageBookingClient from './ManageBookingClient'

export const dynamic = 'force-dynamic'

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const firm = getFirmConfig()
  const officeAddress = firmOfficeAddress(await loadFirmSettings())

  return (
    <div className="client-root client-booking min-h-dvh bg-background">
      <main className="mx-auto flex max-w-[1144px] flex-col items-center md:px-8 md:py-14">
        <div className="w-full">
          <ManageBookingClient token={token} firmName={firm.firmName} officeAddress={officeAddress} />
        </div>
        <p className="mt-5 mb-8 px-5 text-center text-compact text-muted-foreground">
          Need help? Call {firm.firmName} at{' '}
          <a
            className="font-medium underline-offset-4 hover:underline"
            href={`tel:${firm.phone.replace(/[^\d+]/g, '')}`}
          >
            {firm.phone}
          </a>{' '}
          and we&apos;ll take care of it for you.
        </p>
      </main>
    </div>
  )
}
