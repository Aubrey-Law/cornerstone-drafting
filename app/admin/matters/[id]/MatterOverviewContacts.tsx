'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PersonContactCard, PersonContactCardGrid } from '@/components/matter/PersonContactCard'
import type { MatterContact, PipelineMatter } from '@/types/database'
import { formatPhoneDisplay } from '@/lib/phone'

interface ClientRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  date_of_birth: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
}

interface ContactRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  date_of_birth: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  relationship_type: string | null
  relationship_label: string | null
}

type ApiResponse = { client: ClientRow; contacts: ContactRow[] }

function clientToContact(client: ClientRow): MatterContact {
  const addressParts = [client.address_line1, client.city, client.state, client.zip].filter(Boolean)
  return {
    id: client.id,
    first_name: client.first_name ?? '',
    middle_name: client.middle_name,
    last_name: client.last_name ?? '',
    email: client.email,
    phone: formatPhoneDisplay(client.phone),
    address: addressParts.join(', ') || null,
    date_of_birth: client.date_of_birth,
    relationship: 'Client',
  }
}

function rowToContact(row: ContactRow): MatterContact {
  return {
    id: row.id,
    first_name: row.first_name ?? '',
    middle_name: row.middle_name,
    last_name: row.last_name ?? '',
    email: row.email,
    phone: formatPhoneDisplay(row.phone),
    address: row.address_line1,
    date_of_birth: row.date_of_birth,
    relationship: row.relationship_label ?? row.relationship_type,
  }
}

export function MatterOverviewContacts({ matterId, matter }: { matterId: string; matter: PipelineMatter }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/contacts`)
      if (!res.ok) throw new Error('Failed to load contacts')
      setData(await res.json() as ApiResponse)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => { void refresh() }, [refresh])

  const { clientContact, spouseContact, childContacts } = useMemo(() => {
    if (!data) {
      return { clientContact: null, spouseContact: null, childContacts: [] as MatterContact[] }
    }
    const spouse = data.contacts.find(c => c.relationship_type === 'spouse')
    const children = data.contacts.filter(c => c.relationship_type === 'child')
    return {
      clientContact: clientToContact(data.client),
      spouseContact: spouse ? rowToContact(spouse) : null,
      childContacts: children.map(rowToContact),
    }
  }, [data])

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        Loading family contacts…
      </div>
    )
  }

  const showSpouse = Boolean(spouseContact) || Boolean(matter.spouse_name?.trim())

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Family</h3>
        <p className="text-xs text-muted-foreground">
          Client, spouse, and children from intake.
        </p>
      </div>
      <PersonContactCardGrid>
        {clientContact && (
          <PersonContactCard contact={clientContact} roleLabel="(Client)" />
        )}
        {showSpouse && spouseContact && (
          <PersonContactCard contact={spouseContact} roleLabel="(Spouse)" />
        )}
        {childContacts.map(child => (
          <PersonContactCard key={child.id} contact={child} roleLabel="(Child)" />
        ))}
      </PersonContactCardGrid>
      {!clientContact && (
        <p className="text-xs text-muted-foreground">No family contact data yet. Use Intake to add client information.</p>
      )}
    </section>
  )
}
