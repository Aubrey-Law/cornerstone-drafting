import { manualCommunicationsEnabled } from '@/lib/communications/providers'
import { fetchContactsDirectory } from '@/lib/queries/contactsDirectory'
import { isSmsConfigured } from '@/lib/communications/config'
import { PageHeader } from '@/components/PageHeader'
import { ContactsClient } from '@/app/admin/contacts/ContactsClient'

export const dynamic = 'force-dynamic'

export default async function CrmPeoplePage() {
  const { rows, error } = await fetchContactsDirectory()
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="People" eyebrow="CRM directory" />
        <p role="alert" className="text-sm text-destructive">Could not load people ({error}).</p>
      </div>
    )
  }
  return (
    <ContactsClient
      contacts={rows}
      smsEnabled={manualCommunicationsEnabled() && isSmsConfigured()}
      title="People"
      eyebrow="CRM directory"
      description="Leads, clients, related people, and standalone contacts in one firm directory."
    />
  )
}
