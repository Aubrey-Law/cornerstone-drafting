'use client'

import { useState } from 'react'
import {
  emptyRealEstateTransferFormState,
  type RealEstateTransferFormState,
} from '@/lib/realEstateTransfer/formState'
import {
  REAL_ESTATE_TRANSFER_DOC_TYPES,
  type RealEstateTransferDocType,
} from '@/lib/realEstateTransfer/fields'
import { RealEstateTransferWorkflow } from '@/lib/realEstateTransfer/RealEstateTransferWorkflow'

export default function RealEstateTransferClient() {
  const [form, setForm] = useState<RealEstateTransferFormState>(emptyRealEstateTransferFormState())
  const [selectedDocs, setSelectedDocs] = useState<Set<RealEstateTransferDocType>>(
    () => new Set(REAL_ESTATE_TRANSFER_DOC_TYPES),
  )
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [hasExtracted, setHasExtracted] = useState(false)

  return (
    <RealEstateTransferWorkflow
      form={form}
      onFormChange={setForm}
      selectedDocs={selectedDocs}
      onSelectedDocsChange={setSelectedDocs}
      uploadName={uploadName}
      onUploadNameChange={setUploadName}
      hasExtracted={hasExtracted}
      onHasExtractedChange={setHasExtracted}
    />
  )
}
