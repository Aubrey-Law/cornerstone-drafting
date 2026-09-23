import { redirect } from 'next/navigation'
import { getCachedClaims } from '@/lib/supabaseServer'
import { isSmsConfigured } from '@/lib/communications/config'
import { listSmsThreads } from '@/lib/queries/smsThreads'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { TextsClient } from './TextsClient'

export const dynamic = 'force-dynamic'

export default async function TextsPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>
}) {
  const user = await getCachedClaims()
  if (!user) redirect('/auth/login')

  const { phone } = await searchParams
  let threads: Awaited<ReturnType<typeof listSmsThreads>> = []
  let loadError: string | null = null
  try {
    threads = await listSmsThreads()
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Texts are unavailable.'
  }

  return (
    <TextsClient
      initialThreads={threads}
      initialPhone={optOutPhoneKey(phone ?? null)}
      sendingEnabled={isSmsConfigured()}
      loadError={loadError}
    />
  )
}
