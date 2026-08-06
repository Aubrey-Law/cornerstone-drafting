import { fetchContactsDirectory } from '@/lib/queries/contactsDirectory'
import { isSmsConfigured } from '@/lib/communications/config'
import { ContactsClient } from '@/app/admin/contacts/ContactsClient'

export const dynamic = 'force-dynamic'

export default async function CrmPeoplePage() {
  const { rows, error } = await fetchContactsDirectory()
  if (error) {
    return <div className="space-y-4"><h1 className="text-xl font-semibold">People</h1><p className="text-sm text-destructive">Could not load people ({error}).</p></div>
  }
  return (
    <ContactsClient
      contacts={rows}
      smsEnabled={isSmsConfigured()}
      title="People"
      eyebrow="CRM directory"
      description="Leads, clients, related people, and standalone contacts in one firm directory."
    />
  )
}
