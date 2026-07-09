'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildFormStateFromDesignSheet,
  commitRealEstateTransferToSheet,
  getPersistedRealEstateTransfer,
} from '@/lib/designSheetRealEstateTransfer'
import { REAL_ESTATE_TRANSFER_DOC_TYPES, type RealEstateTransferDocType } from '@/lib/realEstateTransfer/fields'
import { RealEstateTransferWorkflow } from '@/lib/realEstateTransfer/RealEstateTransferWorkflow'
import type { RealEstateTransferFormState } from '@/lib/realEstateTransfer/formState'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import { SectionBlock, type SectionProps } from './shared'

interface TransfersAssignmentsSectionProps extends SectionProps {
  matter: PipelineMatter
  contacts: MatterContact[]
}

export function TransfersAssignmentsSection({
  sheet,
  onChange,
  matter,
  contacts,
}: TransfersAssignmentsSectionProps) {
  const persisted = useMemo(() => getPersistedRealEstateTransfer(sheet), [sheet.decisions])

  const [form, setForm] = useState<RealEstateTransferFormState>(() =>
    buildFormStateFromDesignSheet(sheet, matter, contacts),
  )
  const [selectedDocs, setSelectedDocs] = useState<Set<RealEstateTransferDocType>>(
    () => new Set(persisted.selectedDocs.length > 0 ? persisted.selectedDocs : REAL_ESTATE_TRANSFER_DOC_TYPES),
  )
  const [uploadName, setUploadName] = useState<string | null>(persisted.uploadName)
  const [hasExtracted, setHasExtracted] = useState(persisted.hasExtracted)

  const commit = useCallback((
    nextForm: RealEstateTransferFormState,
    meta?: {
      selectedDocs?: Set<RealEstateTransferDocType>
      uploadName?: string | null
      hasExtracted?: boolean
    },
  ) => {
    setForm(nextForm)
    const decisions = commitRealEstateTransferToSheet(sheet, nextForm, {
      selectedDocs: Array.from(meta?.selectedDocs ?? selectedDocs),
      uploadName: meta?.uploadName !== undefined ? meta.uploadName : uploadName,
      hasExtracted: meta?.hasExtracted !== undefined ? meta.hasExtracted : hasExtracted,
    })
    onChange('decisions', decisions)
  }, [sheet, onChange, selectedDocs, uploadName, hasExtracted])

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
          }}
        />
      </SectionBlock>
    </div>
  )
}
