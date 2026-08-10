'use client'

import { Trash2 } from 'lucide-react'

import {
  AddButton,
  ContactAddressFields,
  FormField,
  InfoBox,
  PhoneInput,
  Row2,
  SectionDivider,
  SelectInput,
  TextInput,
  ToggleSwitch,
} from '@/components/intake/IntakeFormPrimitives'
import {
  DEFAULT_FIDUCIARY_ENTRY,
  ExpandableHelp,
  FiduciaryRole,
  ReviewChoiceControl,
  intakeResidentialAddress,
  type AdditionalContactEntry,
  type FiduciaryEntry,
  type StepProps,
} from '@/components/intake/IntakeWizard'
import { IntakeField } from '@/components/sharedFields/IntakeField'
import {
  COLLEGE_DPOA_EFFECTIVE_OPTIONS,
  COLLEGE_DPOA_POWER_OPTIONS,
  COLLEGE_FERPA_RECORD_OPTIONS,
  COLLEGE_HIPAA_EXPIRATION_OPTIONS,
  COLLEGE_HIPAA_SCOPE_OPTIONS,
  COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS,
  COLLEGE_LIFE_SUPPORT_OPTIONS,
  COLLEGE_LIVING_WILL_INCLUDE_OPTIONS,
  COLLEGE_ORGAN_DONATION_OPTIONS,
  COLLEGE_TREATMENT_CHOICE_OPTIONS,
  DISCUSS_AT_MEETING,
  emptyHipaaRecipient,
  type CollegeHipaaRecipient,
} from '@/lib/collegePrepFields'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { formatPhoneInput } from '@/lib/phone'
import { SUFFIX_OPTIONS } from '@/lib/sharedFields'

import { CheckboxGrid, ChoiceCards, DocumentPrimer, NotesField } from './CollegePrepPrimitives'

const SUFFIX_SELECT_OPTIONS = SUFFIX_OPTIONS.map((option) => ({
  value: option.value,
  label: option.value,
}))

function str(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? (data[key] as string) : ''
}

function list(data: Record<string, unknown>, key: string): string[] {
  const value = data[key]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function studentFirstName(data: Record<string, unknown>): string {
  return str(data, 'preferred_name').trim() || str(data, 'first_name').trim() || 'the student'
}

// ── A. Student ───────────────────────────────────────────────────────────────

export function StepCollegeStudent({ data, update }: StepProps) {
  return (
    <div className="space-y-5">
      <InfoBox>
        The student is the client. Every document in this package is signed by the student and can be
        revoked by the student at any time, for any reason. A parent or guardian may fill this in, but
        the student should review the answers before the drafting appointment.
      </InfoBox>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="First name (as it appears on government ID)">
          <TextInput value={str(data, 'first_name')} onChange={(v) => update('first_name', v)} required />
        </FormField>
        <FormField label="Middle name">
          <TextInput value={str(data, 'middle_name')} onChange={(v) => update('middle_name', v)} />
        </FormField>
        <FormField label="Last name">
          <TextInput value={str(data, 'last_name')} onChange={(v) => update('last_name', v)} required />
        </FormField>
        <FormField label="Suffix">
          <SelectInput
            value={str(data, 'suffix')}
            onChange={(v) => update('suffix', v)}
            placeholder="—"
            options={SUFFIX_SELECT_OPTIONS}
          />
        </FormField>
      </div>

      <Row2>
        <FormField label="Preferred name">
          <TextInput value={str(data, 'preferred_name')} onChange={(v) => update('preferred_name', v)} />
        </FormField>
        <FormField label="Pronouns">
          <IntakeField
            fieldId="client_pronouns"
            value={data.preferred_pronoun}
            onChange={(v) => update('preferred_pronoun', v)}
            placeholder="Select pronouns"
          />
        </FormField>
      </Row2>

      <Row2>
        <FormField label="Date of birth">
          <TextInput
            value={str(data, 'date_of_birth')}
            onChange={(v) => update('date_of_birth', v)}
            type="date"
          />
        </FormField>
        <div className="flex items-end pb-1">
          <ToggleSwitch
            checked={(data.is_us_citizen as boolean) ?? true}
            onChange={(v) => update('is_us_citizen', v)}
            label="U.S. citizen"
          />
        </div>
      </Row2>

      <SectionDivider title="Contact information" />
      <Row2>
        <FormField label="Cell phone">
          <PhoneInput value={str(data, 'phone')} onChange={(v) => update('phone', v)} />
        </FormField>
        <FormField label="Email">
          <TextInput value={str(data, 'email')} onChange={(v) => update('email', v)} type="email" />
        </FormField>
      </Row2>

      <SectionDivider title="Permanent legal address" />
      <p className="text-xs text-muted-foreground">
        The student&apos;s home address, not the campus address — this is what the documents recite.
      </p>
      <ContactAddressFields
        street={str(data, 'street_address')}
        city={str(data, 'city')}
        state={str(data, 'state') || 'MA'}
        zip={str(data, 'zip')}
        county={str(data, 'county')}
        onStreetChange={(v) => update('street_address', v)}
        onCityChange={(v) => update('city', v)}
        onStateChange={(v) => update('state', v)}
        onZipChange={(v) => update('zip', v)}
        onCountyChange={(v) => update('county', v)}
        onAddressSelect={(address) => {
          update('street_address', address.street)
          update('city', address.city)
          update('state', address.state || 'MA')
          update('zip', address.zip)
          if (address.county) update('county', address.county)
        }}
      />
    </div>
  )
}

// ── B. School ────────────────────────────────────────────────────────────────

export function StepCollegeSchool({ data, update }: StepProps) {
  const ferpaOn = data.college_ferpa_release === true

  return (
    <div className="space-y-5">
      <Row2>
        <FormField label="College / university / program">
          <TextInput
            value={str(data, 'college_school_name')}
            onChange={(v) => update('college_school_name', v)}
          />
        </FormField>
        <FormField label="Move-in / orientation date">
          <TextInput
            value={str(data, 'college_move_in_date')}
            onChange={(v) => update('college_move_in_date', v)}
            type="date"
          />
        </FormField>
      </Row2>

      <Row2>
        <FormField label="Campus city">
          <TextInput
            value={str(data, 'college_school_city')}
            onChange={(v) => update('college_school_city', v)}
          />
        </FormField>
        <FormField label="Campus state">
          <TextInput
            value={str(data, 'college_school_state')}
            onChange={(v) => update('college_school_state', v)}
            placeholder="MA"
          />
        </FormField>
      </Row2>

      <div className="space-y-3">
        <ToggleSwitch
          checked={(data.college_studying_abroad as boolean) ?? false}
          onChange={(v) => update('college_studying_abroad', v)}
          label="The student will study or travel abroad during the program"
        />
        {data.college_studying_abroad === true && (
          <FormField label="Country / countries">
            <TextInput
              value={str(data, 'college_abroad_country')}
              onChange={(v) => update('college_abroad_country', v)}
            />
          </FormField>
        )}
      </div>

      <SectionDivider title="School records (FERPA)" />
      <DocumentPrimer title="Why we ask about FERPA">
        <p>
          HIPAA covers medical information. Education records — grades, the bursar&apos;s office,
          financial aid, housing, and disciplinary files — are covered by a different law, FERPA, and a
          health care proxy does nothing for them. Once the student turns 18 those records belong to
          the student alone, and most schools will not discuss a tuition bill without a signed release.
        </p>
        <p>
          Colleges each publish their own FERPA form. We can prepare a general authorization and tell
          you which of the school&apos;s own forms to file alongside it.
        </p>
      </DocumentPrimer>

      <ToggleSwitch
        checked={ferpaOn}
        onChange={(v) => update('college_ferpa_release', v)}
        label="Include a FERPA release for education records"
      />

      {ferpaOn && (
        <div className="space-y-4">
          <CheckboxGrid
            legend="Which records should the release cover?"
            options={COLLEGE_FERPA_RECORD_OPTIONS}
            values={list(data, 'college_ferpa_records')}
            onChange={(v) => update('college_ferpa_records', v)}
          />
          <NotesField
            label="Who should be able to receive education records?"
            hint="Usually the same parents named elsewhere, but the student may choose differently."
            value={str(data, 'college_ferpa_recipients')}
            onChange={(v) => update('college_ferpa_recipients', v)}
            rows={2}
          />
        </div>
      )}
    </div>
  )
}

// ── C. Parents & guardians ───────────────────────────────────────────────────

export function StepCollegeParents({ data, update }: StepProps) {
  const parents = ((data._additional_contacts as AdditionalContactEntry[]) ?? []).filter(Boolean)

  function syncAddress(row: AdditionalContactEntry): AdditionalContactEntry {
    return {
      ...row,
      address:
        composedAddressOneLine({
          street: row.street,
          city: row.city,
          state: row.state,
          zip: row.zip,
        }) || '',
    }
  }

  function setParents(next: AdditionalContactEntry[]) {
    update('_additional_contacts', next.map(syncAddress))
  }

  function addParent() {
    setParents([
      ...parents,
      syncAddress({
        id: crypto.randomUUID(),
        first_name: '',
        middle_name: '',
        last_name: '',
        suffix: '',
        email: '',
        phone: '',
        relationship: parents.length === 0 ? 'Parent' : '',
        street: '',
        city: '',
        state: 'MA',
        zip: '',
        address: '',
      }),
    ])
  }

  function patchParent(index: number, patch: Partial<AdditionalContactEntry>) {
    const next = [...parents]
    next[index] = syncAddress({ ...next[index], ...patch })
    setParents(next)
  }

  function removeParent(index: number) {
    setParents(parents.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-5">
      <InfoBox>
        List the parents, guardians, or trusted adults the student may name in the documents. Everyone
        added here becomes selectable in the next section, so you only have to type a name once.
      </InfoBox>

      {parents.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No one added yet. Use &quot;Add parent or guardian&quot; to start.
        </p>
      )}

      {parents.map((row, index) => (
        <div key={row.id} className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              Parent / guardian {index + 1}
            </span>
            <button
              type="button"
              onClick={() => removeParent(index)}
              aria-label={`Remove parent or guardian ${index + 1}`}
              className="text-red-500 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="First name">
                <TextInput value={row.first_name} onChange={(v) => patchParent(index, { first_name: v })} />
              </FormField>
              <FormField label="Middle name">
                <TextInput value={row.middle_name ?? ''} onChange={(v) => patchParent(index, { middle_name: v })} />
              </FormField>
              <FormField label="Last name">
                <TextInput value={row.last_name} onChange={(v) => patchParent(index, { last_name: v })} />
              </FormField>
              <FormField label="Suffix">
                <SelectInput
                  value={row.suffix ?? ''}
                  onChange={(v) => patchParent(index, { suffix: v })}
                  placeholder="—"
                  options={SUFFIX_SELECT_OPTIONS}
                />
              </FormField>
            </div>
            <Row2>
              <FormField label="Relationship to the student">
                <TextInput
                  value={row.relationship}
                  onChange={(v) => patchParent(index, { relationship: v })}
                  placeholder="e.g. Mother, Father, Guardian, Aunt"
                />
              </FormField>
              <FormField label="Cell phone">
                <PhoneInput value={row.phone} onChange={(v) => patchParent(index, { phone: v })} />
              </FormField>
            </Row2>
            <Row2>
              <FormField label="Email">
                <TextInput value={row.email} onChange={(v) => patchParent(index, { email: v })} type="email" />
              </FormField>
              <div />
            </Row2>
            <ContactAddressFields
              street={row.street}
              city={row.city}
              state={row.state || 'MA'}
              zip={row.zip}
              county=""
              onStreetChange={(v) => patchParent(index, { street: v })}
              onCityChange={(v) => patchParent(index, { city: v })}
              onStateChange={(v) => patchParent(index, { state: v })}
              onZipChange={(v) => patchParent(index, { zip: v })}
              onCountyChange={() => {}}
              onAddressSelect={(address) =>
                patchParent(index, {
                  street: address.street,
                  city: address.city,
                  state: address.state || 'MA',
                  zip: address.zip,
                })
              }
            />
          </div>
        </div>
      ))}

      <AddButton onClick={addParent} label="Add parent or guardian" />

      <SectionDivider />

      <NotesField
        label="Family circumstances we should know about"
        hint="Divorce or separation, a parent living abroad, estrangement, a family member with health issues, or anything else that affects who should be named. This helps us avoid recommending someone the student would not actually want called."
        value={str(data, 'college_family_circumstances')}
        onChange={(v) => update('college_family_circumstances', v)}
        rows={4}
      />
    </div>
  )
}

// ── D. Agent designations ────────────────────────────────────────────────────

export function StepCollegeAgents({ data, update, intakeId }: StepProps) {
  const id = intakeId ?? ''
  const name = studentFirstName(data)
  const home = intakeResidentialAddress(data)

  const studentEntry: FiduciaryEntry = {
    ...DEFAULT_FIDUCIARY_ENTRY,
    first_name: str(data, 'first_name'),
    last_name: str(data, 'last_name'),
    email: str(data, 'email'),
    phone: formatPhoneInput(str(data, 'phone')),
    street: home.line,
    city: home.city,
    state: home.state || 'MA',
    zip: home.zip,
    address: home.composed,
    relationship: 'client',
  }

  const parentEntries: FiduciaryEntry[] = ((data._additional_contacts as AdditionalContactEntry[]) ?? [])
    .filter((row) => row?.first_name?.trim() && row?.last_name?.trim())
    .map((row) => ({
      ...DEFAULT_FIDUCIARY_ENTRY,
      first_name: row.first_name,
      middle_name: row.middle_name ?? '',
      last_name: row.last_name,
      suffix: row.suffix ?? '',
      email: row.email ?? '',
      phone: formatPhoneInput(row.phone ?? ''),
      street: row.street ?? '',
      city: row.city ?? '',
      state: row.state ?? 'MA',
      zip: row.zip ?? '',
      address: row.address ?? '',
      relationship: row.relationship || 'parent',
    }))

  const poaEntries = (data._fid_poa_client as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const hcpEntries = (data._fid_hcp_client as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]

  const allLocalContacts = [studentEntry, ...parentEntries, ...poaEntries, ...hcpEntries].filter(
    (entry) => entry.first_name && entry.last_name,
  )

  const recipients = (data.college_hipaa_recipients as CollegeHipaaRecipient[]) ?? []

  function setRecipients(next: CollegeHipaaRecipient[]) {
    update('college_hipaa_recipients', next)
  }

  function patchRecipient(index: number, patch: Partial<CollegeHipaaRecipient>) {
    const next = [...recipients]
    next[index] = { ...next[index], ...patch }
    setRecipients(next)
  }

  return (
    <div className="space-y-8">
      <DocumentPrimer title="Durable power of attorney — financial and legal agent">
        <p>
          At 18 the student gains independence in signing contracts, taking loans and credit cards, and
          in being sued. A durable power of attorney lets the student give a parent, guardian, or
          trusted adult authority over financial and legal matters. The student can grant all or some of
          these rights, and can give different aspects to different people.
        </p>
        <p>
          &ldquo;Durable&rdquo; means the authority survives the student&apos;s incapacity. That is the
          entire point: a power of attorney that stops working when the person becomes unable to act is
          a power of attorney that stops working exactly when it is needed.
        </p>
      </DocumentPrimer>

      <ReviewChoiceControl
        data={data}
        update={update}
        choiceKey="cp_agents"
        label="If you would rather choose the agents at the meeting, mark that here so your attorney knows the blanks are intentional."
      />

      <FiduciaryRole
        title="Financial and legal agent"
        description={`Handles ${name}'s bills, bank accounts, tuition, loans, leases, and disputes. Name a primary agent and one or two alternates.`}
        example="Most students name a parent as primary and the other parent, or an aunt or older sibling, as alternate."
        entries={poaEntries}
        onChange={(entries) => update('_fid_poa_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider />

      <DocumentPrimer title="Health care proxy — health care agent">
        <p>
          Once the student turns 18 parents can no longer access medical records or make most medical
          decisions. Emergency rooms sometimes work around this, but relying on a gray area during the
          worst hour of your life is not a plan.
        </p>
        <p>
          In Massachusetts the operative document is the Health Care Proxy. The agent steps in only when
          a physician determines the student cannot make or communicate a health care decision. Until
          that determination, the student remains fully in charge.
        </p>
        <p>
          Massachusetts permits only one health care agent at a time — name a single agent and one
          alternate, not co-agents.
        </p>
      </DocumentPrimer>

      <FiduciaryRole
        title="Health care agent"
        description={`Makes medical decisions for ${name} if a physician determines ${name} cannot make or communicate them.`}
        example="Someone who knows the student's wishes and can be reached quickly."
        entries={hcpEntries}
        onChange={(entries) => update('_fid_hcp_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
        allowCoAgent={false}
      />

      <SectionDivider />

      <DocumentPrimer title="HIPAA authorization — who may receive medical information">
        <p>
          HIPAA requires providers to keep medical details private. In an emergency, though, you may
          want doctors to be able to share updates with family, or to give family enough information to
          make informed decisions when the student cannot speak.
        </p>
        <p>
          A HIPAA authorization is narrower and quieter than a proxy. It grants no decision-making power
          at all — it simply permits a provider to talk. That is why we usually give HIPAA authority to
          more people than hold the proxy.
        </p>
      </DocumentPrimer>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">
          Everyone a provider should be allowed to talk to
        </p>
        {recipients.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No one listed yet. Grandparents, siblings, and a roommate&apos;s parent are common additions.
          </p>
        )}
        {recipients.map((row, index) => (
          <div key={row.id} className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Recipient {index + 1}</span>
              <button
                type="button"
                onClick={() => setRecipients(recipients.filter((_, i) => i !== index))}
                aria-label={`Remove HIPAA recipient ${index + 1}`}
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <Row2>
              <FormField label="Name">
                <TextInput value={row.name} onChange={(v) => patchRecipient(index, { name: v })} />
              </FormField>
              <FormField label="Relationship">
                <TextInput
                  value={row.relationship}
                  onChange={(v) => patchRecipient(index, { relationship: v })}
                  placeholder="e.g. Mother, Grandfather, Sister"
                />
              </FormField>
            </Row2>
            <Row2>
              <FormField label="Phone">
                <PhoneInput value={row.phone} onChange={(v) => patchRecipient(index, { phone: v })} />
              </FormField>
              <FormField label="Email">
                <TextInput
                  value={row.email}
                  onChange={(v) => patchRecipient(index, { email: v })}
                  type="email"
                />
              </FormField>
            </Row2>
          </div>
        ))}
        <AddButton
          onClick={() => setRecipients([...recipients, emptyHipaaRecipient(crypto.randomUUID())])}
          label="Add someone who may receive information"
        />
      </div>

      <NotesField
        label="Anyone who should specifically NOT receive access"
        hint="Naming someone here is not an accusation — it is an instruction we can put in writing so a provider is never left guessing."
        value={str(data, 'college_excluded_people')}
        onChange={(v) => update('college_excluded_people', v)}
        rows={3}
      />
    </div>
  )
}

// ── E. DPOA scope ────────────────────────────────────────────────────────────

export function StepCollegeDpoa({ data, update }: StepProps) {
  const effective = str(data, 'college_dpoa_effective')

  return (
    <div className="space-y-6">
      <ChoiceCards
        legend="When does the power of attorney take effect?"
        options={COLLEGE_DPOA_EFFECTIVE_OPTIONS}
        value={effective}
        onChange={(v) => update('college_dpoa_effective', v)}
      />

      <ExpandableHelp title="Why we usually recommend “immediately”">
        <p>
          A springing power of attorney only works once someone produces a physician&apos;s written
          determination of incapacity. Banks and bursars are cautious, and collecting that
          determination takes days you may not have. An immediate power of attorney is not a transfer
          of control — the student keeps every right to act, and can revoke the document at any time.
        </p>
      </ExpandableHelp>

      {effective !== DISCUSS_AT_MEETING && (
        <CheckboxGrid
          legend="Powers to grant"
          options={COLLEGE_DPOA_POWER_OPTIONS}
          values={list(data, 'college_dpoa_powers')}
          onChange={(v) => update('college_dpoa_powers', v)}
        />
      )}

      <NotesField
        label="Powers to expressly withhold or limit"
        hint="For example: no authority over a brokerage account, or no authority to sign a lease without speaking to the student first."
        value={str(data, 'college_dpoa_withheld')}
        onChange={(v) => update('college_dpoa_withheld', v)}
      />

      <NotesField
        label="Notes or concerns about financial authority"
        value={str(data, 'college_dpoa_notes')}
        onChange={(v) => update('college_dpoa_notes', v)}
      />
    </div>
  )
}

// ── F. Health care proxy ─────────────────────────────────────────────────────

export function StepCollegeHealthcare({ data, update }: StepProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        By default the health care agent may make any health care decision the student could make. Both
        questions below are optional — leave them blank if nothing comes to mind.
      </p>

      <NotesField
        label="Limits on the agent's authority"
        hint="Anything the agent should not be able to decide alone."
        value={str(data, 'college_hcp_limits')}
        onChange={(v) => update('college_hcp_limits', v)}
      />

      <NotesField
        label="Religious, cultural, or personal instructions"
        hint="Dietary requirements, observances, a preference about who is in the room, a clinician the student would want called."
        value={str(data, 'college_hcp_instructions')}
        onChange={(v) => update('college_hcp_instructions', v)}
        rows={4}
      />
    </div>
  )
}

// ── G. HIPAA ─────────────────────────────────────────────────────────────────

export function StepCollegeHipaa({ data, update }: StepProps) {
  const scope = str(data, 'college_hipaa_scope')
  const expiration = str(data, 'college_hipaa_expiration')

  return (
    <div className="space-y-6">
      <ChoiceCards
        legend="What health information may be released?"
        options={COLLEGE_HIPAA_SCOPE_OPTIONS}
        value={scope}
        onChange={(v) => update('college_hipaa_scope', v)}
      />

      {scope === 'all_except' && (
        <CheckboxGrid
          legend="Categories to withhold"
          options={COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS}
          values={list(data, 'college_hipaa_excluded_categories')}
          onChange={(v) => update('college_hipaa_excluded_categories', v)}
          columns={1}
        />
      )}

      <NotesField
        label="Different scope for different people?"
        hint="For example: full access to one parent, emergency-only information to another."
        value={str(data, 'college_hipaa_different_scope')}
        onChange={(v) => update('college_hipaa_different_scope', v)}
      />

      <SectionDivider title="Expiration" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        A HIPAA authorization has to state when it ends. Most families choose no expiration — the
        student can revoke it at any time in writing — but you can set a date instead, such as
        graduation.
      </p>
      <ChoiceCards
        legend="When should the authorization expire?"
        options={COLLEGE_HIPAA_EXPIRATION_OPTIONS}
        value={expiration}
        onChange={(v) => update('college_hipaa_expiration', v)}
      />
      {expiration === 'date' && (
        <FormField label="Expiration date">
          <TextInput
            value={str(data, 'college_hipaa_expiration_date')}
            onChange={(v) => update('college_hipaa_expiration_date', v)}
            type="date"
          />
        </FormField>
      )}
    </div>
  )
}

// ── H. Living will ───────────────────────────────────────────────────────────

export function StepCollegeLivingWill({ data, update }: StepProps) {
  const include = str(data, 'college_living_will_include')
  const organDonation = str(data, 'college_organ_donation')

  return (
    <div className="space-y-6">
      <DocumentPrimer title="What a living will does">
        <p>
          A living will is a written statement of the care the student would and would not want if they
          could not speak for themselves. Massachusetts does not give living wills the same statutory
          force as a health care proxy, but doctors and agents read them, and families rely on them.
        </p>
        <p>
          Its real value is that it takes the weight off the agent. Whoever the student names should
          never have to guess — or carry a decision alone that the student already made.
        </p>
      </DocumentPrimer>

      <ChoiceCards
        legend="Should the package include a living will?"
        options={COLLEGE_LIVING_WILL_INCLUDE_OPTIONS}
        value={include}
        onChange={(v) => update('college_living_will_include', v)}
      />

      {include === 'yes' && (
        <>
          <ChoiceCards
            legend="If there is no reasonable hope of recovery, what should happen?"
            options={COLLEGE_LIFE_SUPPORT_OPTIONS}
            value={str(data, 'college_life_support')}
            onChange={(v) => update('college_life_support', v)}
          />

          <SectionDivider title="Specific treatments" />
          <div className="space-y-5">
            <ChoiceCards
              legend="Attempted resuscitation (CPR)"
              options={COLLEGE_TREATMENT_CHOICE_OPTIONS}
              value={str(data, 'college_cpr')}
              onChange={(v) => update('college_cpr', v)}
              columns={2}
            />
            <ChoiceCards
              legend="Artificial nutrition and hydration (feeding tube)"
              options={COLLEGE_TREATMENT_CHOICE_OPTIONS}
              value={str(data, 'college_artificial_nutrition')}
              onChange={(v) => update('college_artificial_nutrition', v)}
              columns={2}
            />
            <ChoiceCards
              legend="Mechanical ventilation (breathing machine)"
              options={COLLEGE_TREATMENT_CHOICE_OPTIONS}
              value={str(data, 'college_ventilation')}
              onChange={(v) => update('college_ventilation', v)}
              columns={2}
            />
          </div>

          <ToggleSwitch
            checked={(data.college_comfort_always as boolean) ?? true}
            onChange={(v) => update('college_comfort_always', v)}
            label="Provide pain relief and comfort care at all times, even if it may hasten death"
          />

          <SectionDivider title="Organ and tissue donation" />
          <ChoiceCards
            legend="Would the student want to donate organs or tissue?"
            options={COLLEGE_ORGAN_DONATION_OPTIONS}
            value={organDonation}
            onChange={(v) => update('college_organ_donation', v)}
            columns={2}
          />
          {organDonation === 'specific' && (
            <NotesField
              label="Which organs, tissue, or purposes?"
              value={str(data, 'college_organ_donation_notes')}
              onChange={(v) => update('college_organ_donation_notes', v)}
              rows={2}
            />
          )}
        </>
      )}

      <NotesField
        label="Anything else the family and doctors should know"
        value={str(data, 'college_other_medical_notes')}
        onChange={(v) => update('college_other_medical_notes', v)}
        rows={4}
      />
    </div>
  )
}

// ── J. Other matters ─────────────────────────────────────────────────────────

export function StepCollegeOther({ data, update }: StepProps) {
  return (
    <div className="space-y-6">
      <NotesField
        label="Anything worrying you that we have not asked about"
        value={str(data, 'college_concerns')}
        onChange={(v) => update('college_concerns', v)}
        rows={4}
      />
    </div>
  )
}
