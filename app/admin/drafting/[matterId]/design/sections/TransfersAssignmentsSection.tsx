'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildFormStateFromDesignSheet,
  commitRealEstateTransferToSheet,
  getPersistedRealEstateTransfer,
} from '@/lib/designSheetRealEstateTransfer'
import { type RealEstateTransferDocType } from '@/lib/realEstateTransfer/fields'
import { RealEstateTransferWorkflow } from '@/lib/realEstateTransfer/RealEstateTransferWorkflow'
import type { RealEstateTransferFormState } from '@/lib/realEstateTransfer/formState'
import type { MatterContact, PipelineMatter } from '@/types/database'
import type { Contact as PickerContact } from './ContactPicker'
import {
  CLIENT_PRIMARY_CONTACT_ID,
  SPOUSE_PRIMARY_CONTACT_ID,
  findClientContact,
  findSpouseContact,
} from './fiduciary-blocks'
import { SectionBlock, type SectionProps } from './shared'

interface TransfersAssignmentsSectionProps extends SectionProps {
  matter: PipelineMatter
  contacts: MatterContact[]
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

export function TransfersAssignmentsSection({
  sheet,
  onChange,
  matter,
  contacts,
  onAddContact,
  onUpdateContact,
}: TransfersAssignmentsSectionProps) {
  const persisted = useMemo(() => getPersistedRealEstateTransfer(sheet), [sheet.decisions])

  const [form, setForm] = useState<RealEstateTransferFormState>(() =>
    buildFormStateFromDesignSheet(sheet, matter, contacts),
  )
  const [selectedDocs, setSelectedDocs] = useState<Set<RealEstateTransferDocType>>(
    () => new Set(persisted.selectedDocs),
  )
  const [uploadName, setUploadName] = useState<string | null>(persisted.uploadName)
  const [hasExtracted, setHasExtracted] = useState(persisted.hasExtracted)

  const clientContact = useMemo(
    () => findClientContact(contacts, matter, sheet),
    [contacts, matter, sheet],
  )
  const spouseContact = useMemo(
    () => findSpouseContact(contacts, matter, sheet),
    [contacts, matter, sheet],
  )

  // Prefer stable design-sheet shortcut ids so persisted trusteeContactId resolves in the picker.
  const shortcutContacts = useMemo(() => {
    const shortcuts: PickerContact[] = []
    if (clientContact) {
      shortcuts.push({
        ...(clientContact as unknown as PickerContact),
        id: CLIENT_PRIMARY_CONTACT_ID,
      })
    }
    if (spouseContact) {
      shortcuts.push({
        ...(spouseContact as unknown as PickerContact),
        id: SPOUSE_PRIMARY_CONTACT_ID,
      })
    }
    return shortcuts
  }, [clientContact, spouseContact])

  const commit = useCallback((
    nextForm: RealEstateTransferFormState,
    meta?: {
      selectedDocs?: Set<RealEstateTransferDocType>
      uploadName?: string | null
      hasExtracted?: boolean
    },
  ) => {
    setForm(nextForm)
    onChange('decisions', prevSheet => commitRealEstateTransferToSheet(prevSheet, nextForm, {
      selectedDocs: Array.from(meta?.selectedDocs ?? selectedDocs),
      uploadName: meta?.uploadName !== undefined ? meta.uploadName : uploadName,
      hasExtracted: meta?.hasExtracted !== undefined ? meta.hasExtracted : hasExtracted,
    }))
  }, [onChange, selectedDocs, uploadName, hasExtracted])

  const handleFormChange = (nextForm: RealEstateTransferFormState) => {
    commit(nextForm)
  }

  const handleSelectedDocsChange = (docs: Set<RealEstateTransferDocType>) => {
    setSelectedDocs(docs)
    commit(form, { selectedDocs: docs })
  }

  const handleUploadNameChange = (name: string | null) => {
    setUploadName(name)
    commit(form, { uploadName: name })
  }

  const handleHasExtractedChange = (value: boolean) => {
    setHasExtracted(value)
    commit(form, { hasExtracted: value })
  }

  const adaptAdd = async (data: Omit<PickerContact, 'id'>): Promise<PickerContact> => {
    const created = await onAddContact(data as Omit<MatterContact, 'id'>)
    return created as unknown as PickerContact
  }

  const adaptUpdate = onUpdateContact
    ? async (id: string, data: Omit<PickerContact, 'id'>): Promise<PickerContact> => {
      const updated = await onUpdateContact(id, data as Omit<MatterContact, 'id'>)
      return updated as unknown as PickerContact
    }
    : undefined

  useEffect(() => {
    setSelectedDocs(new Set(persisted.selectedDocs))
    setUploadName(persisted.uploadName)
    setHasExtracted(persisted.hasExtracted)
  }, [persisted])

  useEffect(() => {
    const fresh = buildFormStateFromDesignSheet(sheet, matter, contacts)
    setForm(current => ({
      ...current,
      clientName: fresh.clientName,
      spouseName: fresh.spouseName,
      clientPropertyAddress: fresh.clientPropertyAddress,
      clientPropertyCity: fresh.clientPropertyCity,
      clientPropertyState: fresh.clientPropertyState,
      clientPropertyCounty: fresh.clientPropertyCounty,
      trustNames: fresh.trustNames,
      fiduciaries: fresh.fiduciaries,
      trusteeContactId: current.trusteeContactId || fresh.trusteeContactId,
      trusteeSource: current.trusteeContactId ? current.trusteeSource : fresh.trusteeSource,
      trusteeFiduciaryId: current.trusteeContactId ? current.trusteeFiduciaryId : fresh.trusteeFiduciaryId,
    }))
  }, [
    sheet,
    matter,
    contacts,
    sheet.client_name,
    sheet.spouse_name,
    sheet.street,
    sheet.city,
    sheet.state,
    sheet.county,
    sheet.trust_name,
    sheet.spouse_trust_name,
    sheet.trustee_slots,
    sheet.spouse_trustee_slots,
    sheet.executor_slots,
    sheet.poa_slots,
    matter.client_name,
    matter.spouse_name,
  ])

  return (
    <div>
      <SectionBlock
        title="Real Estate Transfer"
        subtitle="Upload the current deed, configure the realty trust, and generate transfer documents for this matter."
      >
        <RealEstateTransferWorkflow
          form={form}
          onFormChange={handleFormChange}
          selectedDocs={selectedDocs}
          onSelectedDocsChange={handleSelectedDocsChange}
          uploadName={uploadName}
          onUploadNameChange={handleUploadNameChange}
          hasExtracted={hasExtracted}
          onHasExtractedChange={handleHasExtractedChange}
          options={{
            clientInfoReadOnly: true,
            allowFiduciaryEditing: false,
            allowTrustNameEditing: true,
            hideDocumentPicker: true,
          }}
          trusteePicker={{
            contacts: contacts as unknown as PickerContact[],
            shortcutContacts,
            onAddContact: adaptAdd,
            onUpdateContact: adaptUpdate,
          }}
        />
      </SectionBlock>
    </div>
  )
}
