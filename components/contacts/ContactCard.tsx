import Link from 'next/link'
import { PropertyList, PropertyRow } from '@/components/ui/property-row'
import { phoneTelHref } from '@/lib/phone'
import { practiceAreaLabel } from '@/lib/practiceArea'
import type { ContactDirectoryRow } from '@/lib/adminTables/contactTable'

/**
 * A contact's standing facts, grouped into sections.
 *
 * Two things carry the layout, and both invert what a form would do:
 *
 * 1. **The section heading is quieter than the data inside it.** The heading is
 *    small and muted; the values are full strength. Reading down the card you see
 *    the contact, not the field names.
 * 2. **A section with nothing in it is omitted, not rendered empty.** A card of
 *    headings over em dashes looks broken; a shorter card looks finished.
 *
 * Rows come from `PropertyRow`, so a blank value inside a section that *does* have
 * content still holds its place and reads as "not recorded".
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h3>
      <PropertyList>{children}</PropertyList>
    </section>
  )
}

export function ContactCard({ contact }: { contact: ContactDirectoryRow }) {
  const tel = phoneTelHref(contact.phone)
  const location = [contact.city, contact.state].filter(Boolean).join(', ')
  const hasMatterFacts = Boolean(
    contact.practice_area || contact.matter_number || contact.relationship,
  )

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Communication">
        <PropertyRow
          label="Email"
          value={
            contact.email ? (
              <a href={`mailto:${contact.email}`} className="hover:underline">
                {contact.email}
              </a>
            ) : null
          }
        />
        <PropertyRow
          label="Phone"
          value={
            contact.phone ? (
              tel ? (
                <a href={tel} className="hover:underline">
                  {contact.phone}
                </a>
              ) : (
                contact.phone
              )
            ) : null
          }
        />
      </Section>

      {/* Omitted rather than shown empty — a contact with no address on file. */}
      {location && (
        <Section title="Location">
          <PropertyRow label="City & state" value={location} />
        </Section>
      )}

      {hasMatterFacts && (
        <Section title="Matter">
          <PropertyRow
            label="Practice"
            value={contact.practice_area ? practiceAreaLabel(contact.practice_area) : null}
          />
          <PropertyRow
            label="Matter number"
            value={
              contact.matter_number && contact.href ? (
                <Link href={contact.href} className="hover:underline">
                  {contact.matter_number}
                </Link>
              ) : (
                contact.matter_number
              )
            }
          />
          <PropertyRow label="Relationship" value={contact.relationship} />
        </Section>
      )}
    </div>
  )
}
