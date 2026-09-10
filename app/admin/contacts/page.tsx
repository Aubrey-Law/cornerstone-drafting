import { manualCommunicationsEnabled } from '@/lib/communications/providers'
import { fetchContactsDirectory } from '@/lib/queries/contactsDirectory'
import { isSmsConfigured } from '@/lib/communications/config'
import { ContactsClient } from './ContactsClient'

export const dynamic = 'force-dynamic'

export default async function ContactsPage() {
  const { rows, error } = await fetchContactsDirectory()

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="text-sm text-destructive">Could not load contacts ({error}).</p>
      </div>
    )
  }

  return <ContactsClient contacts={rows} smsEnabled={manualCommunicationsEnabled() && isSmsConfigured()} />
}
