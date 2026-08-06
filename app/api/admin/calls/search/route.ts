import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchFirmPeople } from '@/lib/queries/firmDirectory'

export const dynamic = 'force-dynamic'

/** Search the shared firm directory for call assignment. */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ matters: [], leads: [], contacts: [] })

  const { people, error } = await fetchFirmPeople()
  if (error) return NextResponse.json({ error }, { status: 500 })

  const needle = q.toLocaleLowerCase()
  const matches = people
    .filter(person => [
      person.name,
      person.email,
      person.phone,
      person.detail,
      person.matterNumber,
    ].some(value => value?.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))

  const label = (person: (typeof matches)[number]) =>
    [person.name, person.detail, person.email ?? person.phone].filter(Boolean).join(' · ')

  const unique = <T extends { id: string }>(items: T[]) =>
    Array.from(new Map(items.map(item => [item.id, item])).values()).slice(0, 15)

  const matters = unique(matches.flatMap(person =>
    person.source === 'intake' && person.matterId
      ? [{ id: person.matterId, label: label(person) }]
      : [],
  ))
  const leads = unique(matches.flatMap(person =>
    person.source === 'intake' && person.leadId
      ? [{ id: person.leadId, label: label(person) }]
      : [],
  ))
  const contacts = unique(matches.flatMap(person =>
    person.contactId
      ? [{ id: person.contactId, label: label(person) }]
      : [],
  ))

  return NextResponse.json({ matters, leads, contacts })
}
