'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Download, FileUp, Loader2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  DOCUMENT_TYPES,
  REAL_ESTATE_TRANSFER_DOC_TYPES,
  REAL_ESTATE_TRANSFER_FIELDS,
  type RealEstateTransferDocType,
  type RealEstateTransferFieldKey,
  type BoundaryCall,
} from '@/lib/realEstateTransfer/fields'
import {
  buildTemplateFields,
  createId,
  deriveLegacyTrusteeFields,
  mergeExtractedDeedFields,
  partySourceLabel,
  suggestRealtyTrustNames,
  type BeneficialOwnerEntry,
  type PartySelection,
  type PartySource,
  type RealEstateTransferFormState,
} from '@/lib/realEstateTransfer/formState'
import ContactPicker, {
  contactFullName,
  type Contact as PickerContact,
} from '@/app/admin/drafting/[matterId]/design/sections/ContactPicker'

const LEGACY_DEED_FIELDS = new Set<RealEstateTransferFieldKey>([
  'legal_description',
  'prior_deed_book',
  'prior_deed_page',
  'prior_deed_date',
  'registry_district',
  'certificate_number',
  'execution_date',
])

const PROPERTY_ADDRESS_FIELDS = new Set<RealEstateTransferFieldKey>([
  'property_address',
  'property_city',
  'property_state',
  'property_county',
])

const DEED_INPUT_FIELDS = REAL_ESTATE_TRANSFER_FIELDS.filter(
  field =>
    field.section === 'deed'
    && field.key !== 'grantee'
    && !PROPERTY_ADDRESS_FIELDS.has(field.key)
    && field.key !== 'recording_system'
    && field.key !== 'description_type'
    && !LEGACY_DEED_FIELDS.has(field.key),
)

export interface RealEstateTransferWorkflowOptions {
  clientInfoReadOnly?: boolean
  allowFiduciaryEditing?: boolean
  allowTrustNameEditing?: boolean
  /** When true, hide the local "Generate documents" card (docs are chosen in Estate Plan Design). */
  hideDocumentPicker?: boolean
}

export interface RealEstateTransferTrusteePickerProps {
  contacts: PickerContact[]
  onAddContact: (data: Omit<PickerContact, 'id'>) => Promise<PickerContact>
  onUpdateContact?: (id: string, data: Omit<PickerContact, 'id'>) => Promise<PickerContact>
  /** Synthetic client/spouse contacts included in the picker pool. */
  shortcutContacts?: PickerContact[]
}

export interface RealEstateTransferWorkflowProps {
  form: RealEstateTransferFormState
  onFormChange: (form: RealEstateTransferFormState) => void
  selectedDocs: Set<RealEstateTransferDocType>
  onSelectedDocsChange: (docs: Set<RealEstateTransferDocType>) => void
  uploadName: string | null
  onUploadNameChange: (name: string | null) => void
  hasExtracted: boolean
  onHasExtractedChange: (value: boolean) => void
  options?: RealEstateTransferWorkflowOptions
  /** When provided, Trustee uses ContactPicker (design-sheet contact pool). */
  trusteePicker?: RealEstateTransferTrusteePickerProps
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/filename="([^"]+)"/)
  return match?.[1] ?? null
}

function partyDisplayName(selection: PartySelection, form: RealEstateTransferFormState): string {
  switch (selection.source) {
    case 'client':
      return form.clientName.trim() || 'Client'
    case 'spouse':
      return form.spouseName.trim() || 'Spouse'
    case 'trust':
      return selection.trustName?.trim() || 'Trust'
    case 'realty_trust':
      return form.realtyTrustName.trim() || 'Realty trust'
    case 'custom':
      return selection.customName?.trim() || 'Custom'
    default:
      return ''
  }
}

function newPartySelection(source: PartySource, trustName?: string): PartySelection {
  return { id: createId(), source, trustName, customName: source === 'custom' ? '' : undefined }
}

function newBeneficialOwner(source: PartySource, trustName?: string): BeneficialOwnerEntry {
  return { ...newPartySelection(source, trustName), percentage: '' }
}

interface PartyPickerProps {
  label: string
  selections: PartySelection[]
  form: RealEstateTransferFormState
  onChange: (selections: PartySelection[]) => void
  allowRealtyTrust?: boolean
}

function PartyPicker({ label, selections, form, onChange, allowRealtyTrust = false }: PartyPickerProps) {
  const addSelection = (source: PartySource, trustName?: string) => {
    if (source === 'trust' && form.trustNames.length === 0) {
      toast.error('Add at least one trust name first.')
      return
    }
    if (source === 'trust') {
      const resolvedTrustName = trustName ?? (form.trustNames.length === 1 ? form.trustNames[0] : undefined)
      if (resolvedTrustName) {
        onChange([...selections, newPartySelection('trust', resolvedTrustName)])
        return
      }
    }
    onChange([...selections, newPartySelection(source)])
  }

  const updateSelection = (id: string, patch: Partial<PartySelection>) => {
    onChange(selections.map(item => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeSelection = (id: string) => {
    onChange(selections.filter(item => item.id !== id))
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => addSelection('client')}>
          <Plus className="mr-1 h-3 w-3" />
          Client
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => addSelection('spouse')}>
          <Plus className="mr-1 h-3 w-3" />
          Spouse
        </Button>
        {form.trustNames.map(name => (
          <Button
            key={name}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addSelection('trust', name)}
          >
            <Plus className="mr-1 h-3 w-3" />
            {name}
          </Button>
        ))}
        {allowRealtyTrust && form.realtyTrustName.trim() && (
          <Button type="button" size="sm" variant="outline" onClick={() => addSelection('realty_trust')}>
            <Plus className="mr-1 h-3 w-3" />
            Realty trust
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => addSelection('custom')}>
          <Plus className="mr-1 h-3 w-3" />
          Add custom
        </Button>
      </div>
      {selections.length === 0 ? (
        <p className="text-xs text-muted-foreground">No selections yet.</p>
      ) : (
        <div className="space-y-2">
          {selections.map(selection => (
            <div
              key={selection.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <Badge variant="secondary">{partySourceLabel(selection.source)}</Badge>
              {selection.source === 'trust' && form.trustNames.length > 1 ? (
                <Select
                  value={selection.trustName ?? ''}
                  onValueChange={value => updateSelection(selection.id, { trustName: value })}
                >
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue placeholder="Select trust" />
                  </SelectTrigger>
                  <SelectContent>
                    {form.trustNames.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : selection.source === 'custom' ? (
                <Input
                  className="h-8 max-w-xs"
                  placeholder="Name"
                  value={selection.customName ?? ''}
                  onChange={event => updateSelection(selection.id, { customName: event.target.value })}
                />
              ) : (
                <span className="text-sm">{partyDisplayName(selection, form)}</span>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="ml-auto h-7 w-7"
                onClick={() => removeSelection(selection.id)}
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function RealEstateTransferWorkflow({
  form,
  onFormChange,
  selectedDocs,
  onSelectedDocsChange,
  uploadName,
  onUploadNameChange,
  hasExtracted,
  onHasExtractedChange,
  options = {},
  trusteePicker,
}: RealEstateTransferWorkflowProps) {
  const {
    clientInfoReadOnly = false,
    allowFiduciaryEditing = true,
    allowTrustNameEditing = true,
    hideDocumentPicker = false,
  } = options

  const showDeedFields = selectedDocs.has('deed')
  const showTrustFields = selectedDocs.has('real_estate_trust') || selectedDocs.has('trustees_certificate')
  const showCertificateFields = selectedDocs.has('trustees_certificate')
  const showUpload = showDeedFields || showCertificateFields
  const showAnyTransferUi = showDeedFields || showTrustFields || showCertificateFields

  const accessToken = useAccessToken()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'extract' | 'generate' | null>(null)
  const [isPending, startTransition] = useTransition()
  const [newTrustName, setNewTrustName] = useState('')

  const trustNameSuggestions = useMemo(() => suggestRealtyTrustNames(form), [form])
  const deedPropertyAddress = form.deedFields.property_address ?? form.clientPropertyAddress
  const deedPropertyCity = form.deedFields.property_city ?? form.clientPropertyCity
  const deedPropertyState = form.deedFields.property_state ?? form.clientPropertyState
  const deedPropertyCounty = form.deedFields.property_county ?? form.clientPropertyCounty

  const pickerContacts = useMemo(() => {
    if (!trusteePicker) return [] as PickerContact[]
    const shortcuts = trusteePicker.shortcutContacts ?? []
    const seen = new Set<string>()
    const merged: PickerContact[] = []
    for (const contact of [...shortcuts, ...trusteePicker.contacts]) {
      if (!contact?.id || seen.has(contact.id)) continue
      seen.add(contact.id)
      merged.push(contact)
    }
    return merged
  }, [trusteePicker])

  const selectedTrusteeContact = useMemo(() => {
    if (!form.trusteeContactId) return null
    return pickerContacts.find(contact => contact.id === form.trusteeContactId) ?? null
  }, [form.trusteeContactId, pickerContacts])

  const updateForm = (patch: Partial<RealEstateTransferFormState>) => {
    onFormChange({ ...form, ...patch })
  }

  const mergeFiduciary = (contact: PickerContact | null) => {
    const name = contact ? contactFullName(contact).trim() : ''
    if (!contact || !name) return form.fiduciaries
    return form.fiduciaries.some(item => item.id === contact.id)
      ? form.fiduciaries.map(item => (item.id === contact.id ? { ...item, name } : item))
      : [...form.fiduciaries, { id: contact.id, name }]
  }

  const setTrusteeContact = (contact: PickerContact | null) => {
    const trusteeContactId = contact?.id ?? ''
    const legacy = deriveLegacyTrusteeFields(trusteeContactId)
    updateForm({
      trusteeContactId,
      ...legacy,
      fiduciaries: mergeFiduciary(contact),
      coTrusteeContactIds: form.coTrusteeContactIds.filter(id => id !== trusteeContactId),
    })
  }

  const setCoTrusteeContact = (index: number, contact: PickerContact | null) => {
    const next = [...form.coTrusteeContactIds]
    if (!contact) {
      next.splice(index, 1)
      updateForm({ coTrusteeContactIds: next })
      return
    }
    if (contact.id === form.trusteeContactId || next.some((id, i) => i !== index && id === contact.id)) {
      toast.error('That person is already serving as a trustee.')
      return
    }
    next[index] = contact.id
    updateForm({ coTrusteeContactIds: next, fiduciaries: mergeFiduciary(contact) })
  }

  const addCoTrusteeContact = (contact: PickerContact | null) => {
    if (!contact) return
    if (contact.id === form.trusteeContactId || form.coTrusteeContactIds.includes(contact.id)) {
      toast.error('That person is already serving as a trustee.')
      return
    }
    updateForm({
      coTrusteeContactIds: [...form.coTrusteeContactIds, contact.id],
      fiduciaries: mergeFiduciary(contact),
    })
  }

  const updateDeedField = (key: RealEstateTransferFieldKey, value: string) => {
    onFormChange({
      ...form,
      deedFields: { ...form.deedFields, [key]: value },
    })
  }

  const updateBoundaryCalls = (boundaryCalls: BoundaryCall[]) => {
    onFormChange({
      ...form,
      deedFields: { ...form.deedFields, boundary_calls: boundaryCalls },
    })
  }

  const updateBoundaryCall = (index: number, patch: Partial<BoundaryCall>) => {
    updateBoundaryCalls((form.deedFields.boundary_calls ?? []).map((call, callIndex) =>
      callIndex === index ? { ...call, ...patch } : call,
    ))
  }

  const toggleDoc = (docType: RealEstateTransferDocType) => {
    const next = new Set(selectedDocs)
    if (next.has(docType)) next.delete(docType)
    else next.add(docType)
    onSelectedDocsChange(next)
  }

  const addTrustName = () => {
    const name = newTrustName.trim()
    if (!name) return
    if (form.trustNames.includes(name)) {
      toast.error('That trust name is already listed.')
      return
    }
    updateForm({ trustNames: [...form.trustNames, name] })
    setNewTrustName('')
  }

  const removeTrustName = (name: string) => {
    updateForm({ trustNames: form.trustNames.filter(item => item !== name) })
  }

  const addFiduciary = () => {
    const id = createId()
    updateForm({
      fiduciaries: [...form.fiduciaries, { id, name: '' }],
      trusteeFiduciaryId: form.trusteeFiduciaryId || id,
      trusteeContactId: form.trusteeContactId || id,
      trusteeSource: 'fiduciary',
    })
  }

  const updateFiduciary = (id: string, name: string) => {
    updateForm({
      fiduciaries: form.fiduciaries.map(item => (item.id === id ? { ...item, name } : item)),
    })
  }

  const removeFiduciary = (id: string) => {
    const remaining = form.fiduciaries.filter(item => item.id !== id)
    const nextFiduciaryId = form.trusteeFiduciaryId === id ? (remaining[0]?.id ?? '') : form.trusteeFiduciaryId
    updateForm({
      fiduciaries: remaining,
      trusteeFiduciaryId: nextFiduciaryId,
      trusteeContactId: form.trusteeContactId === id ? nextFiduciaryId : form.trusteeContactId,
    })
  }

  const handleUpload = (file: File | null) => {
    if (!file || busy) return
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }

    setBusy('extract')
    onUploadNameChange(file.name)
    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/drafting/real-estate-transfer/extract', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })

        const data = await response.json().catch(() => ({})) as {
          error?: string
          fields?: RealEstateTransferFormState['deedFields']
        }

        if (!response.ok) {
          toast.error(data.error ?? 'Could not extract fields from the deed PDF.')
          return
        }

        onFormChange(mergeExtractedDeedFields(form, data.fields ?? {}))
        onHasExtractedChange(true)
        toast.success('Fields extracted from deed PDF.')
      } catch {
        toast.error('Network error. Please try again.')
      } finally {
        setBusy(null)
      }
    })
  }

  const handleGenerate = () => {
    if (busy) return
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }
    if (selectedDocs.size === 0) {
      toast.error('Select at least one document to generate.')
      return
    }

    setBusy('generate')
    startTransition(async () => {
      try {
        const fields = buildTemplateFields(form)
        const response = await fetch('/api/drafting/real-estate-transfer/generate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields,
            documents: Array.from(selectedDocs),
          }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string }
          toast.error(data.error ?? 'Document generation failed.')
          return
        }

        const blob = await response.blob()
        const filename = parseContentDispositionFilename(response.headers.get('Content-Disposition'))
          ?? (selectedDocs.size === 1 ? 'document.docx' : 'real-estate-transfer.zip')
        triggerBlobDownload(blob, filename)
        toast.success('Documents generated.')
      } catch {
        toast.error('Network error. Please try again.')
      } finally {
        setBusy(null)
      }
    })
  }

  const working = busy !== null || isPending

  if (!showAnyTransferUi && hideDocumentPicker) {
    return (
      <p className="text-sm text-muted-foreground">
        Select asset transfer documents in Estate Plan Design to configure transfer fields here.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {showUpload && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload deed PDF</CardTitle>
          <CardDescription>
            Upload the current deed. Text-based and scanned PDFs are supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0] ?? null
              handleUpload(file)
              event.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={working}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy === 'extract' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileUp className="mr-2 h-4 w-4" aria-hidden />
            )}
            {uploadName ? 'Upload a different PDF' : 'Choose PDF'}
          </Button>
          {uploadName && (
            <p className="text-xs text-muted-foreground">
              Current file: {uploadName}
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {showTrustFields && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{showUpload ? '2. Realty trust' : '1. Realty trust'}</CardTitle>
          <CardDescription>
            {clientInfoReadOnly
              ? 'Client and property details are pulled from the design sheet. Configure the realty trust, trustee, and beneficial owners.'
              : 'Enter client information, configure the realty trust, trustee, and beneficial owners.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Client information</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="clientName">Client name</Label>
                <Input
                  id="clientName"
                  value={form.clientName}
                  readOnly={clientInfoReadOnly}
                  className={clientInfoReadOnly ? 'bg-muted/40' : undefined}
                  onChange={event => updateForm({ clientName: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="spouseName">Spouse name</Label>
                <Input
                  id="spouseName"
                  value={form.spouseName}
                  readOnly={clientInfoReadOnly}
                  className={clientInfoReadOnly ? 'bg-muted/40' : undefined}
                  onChange={event => updateForm({ spouseName: event.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="clientPropertyAddress">Property street address</Label>
                <Input
                  id="clientPropertyAddress"
                  value={form.clientPropertyAddress}
                  readOnly={clientInfoReadOnly}
                  className={clientInfoReadOnly ? 'bg-muted/40' : undefined}
                  onChange={event => updateForm({ clientPropertyAddress: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clientPropertyCity">City / town</Label>
                <Input
                  id="clientPropertyCity"
                  value={form.clientPropertyCity}
                  readOnly={clientInfoReadOnly}
                  className={clientInfoReadOnly ? 'bg-muted/40' : undefined}
                  onChange={event => updateForm({ clientPropertyCity: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clientPropertyState">State</Label>
                <Input
                  id="clientPropertyState"
                  value={form.clientPropertyState}
                  readOnly={clientInfoReadOnly}
                  className={clientInfoReadOnly ? 'bg-muted/40' : undefined}
                  onChange={event => updateForm({ clientPropertyState: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clientPropertyCounty">County</Label>
                <Input
                  id="clientPropertyCounty"
                  value={form.clientPropertyCounty}
                  readOnly={clientInfoReadOnly}
                  className={clientInfoReadOnly ? 'bg-muted/40' : undefined}
                  onChange={event => updateForm({ clientPropertyCounty: event.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Trust names</h3>
            <p className="text-xs text-muted-foreground">
              {allowTrustNameEditing
                ? 'Add existing trust names to use when selecting trustees, grantees, or beneficial owners.'
                : 'Trust names from the design sheet are used when selecting grantees or beneficial owners.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {form.trustNames.map(name => (
                <Badge key={name} variant="secondary" className="gap-1 pr-1">
                  {name}
                  {allowTrustNameEditing && (
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-muted"
                      onClick={() => removeTrustName(name)}
                      aria-label={`Remove ${name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
            {allowTrustNameEditing && (
              <div className="flex gap-2">
                <Input
                  placeholder="Trust name"
                  value={newTrustName}
                  onChange={event => setNewTrustName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addTrustName()
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addTrustName}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Realty trust details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="realtyTrustName">Realty trust name</Label>
                <Input
                  id="realtyTrustName"
                  value={form.realtyTrustName}
                  onChange={event => updateForm({ realtyTrustName: event.target.value })}
                />
                {trustNameSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {trustNameSuggestions.map(suggestion => (
                      <Button
                        key={suggestion}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => updateForm({ realtyTrustName: suggestion })}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="realtyTrustDate">Realty trust date</Label>
                <Input
                  id="realtyTrustDate"
                  type="date"
                  value={form.realtyTrustDate}
                  onChange={event => updateForm({ realtyTrustDate: event.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Trustee</h3>
            {trusteePicker ? (
              <div className="space-y-2">
                <ContactPicker
                  role="Trustee"
                  required
                  value={selectedTrusteeContact}
                  onChange={setTrusteeContact}
                  contacts={pickerContacts}
                  onAddContact={trusteePicker.onAddContact}
                  onUpdateContact={trusteePicker.onUpdateContact}
                />
                {form.coTrusteeContactIds.map((contactId, index) => (
                  <ContactPicker
                    key={`${contactId}-${index}`}
                    role="Co-trustee"
                    value={pickerContacts.find(contact => contact.id === contactId) ?? null}
                    onChange={contact => setCoTrusteeContact(index, contact)}
                    contacts={pickerContacts}
                    onAddContact={trusteePicker.onAddContact}
                    onUpdateContact={trusteePicker.onUpdateContact}
                  />
                ))}
                <ContactPicker
                  role="Add a co-trustee"
                  value={null}
                  onChange={addCoTrusteeContact}
                  contacts={pickerContacts}
                  onAddContact={trusteePicker.onAddContact}
                  onUpdateContact={trusteePicker.onUpdateContact}
                />
              </div>
            ) : (
              <>
                <Select
                  value={form.trusteeSource}
                  onValueChange={value => {
                    const trusteeSource = value as RealEstateTransferFormState['trusteeSource']
                    const trusteeContactId = trusteeSource === 'spouse'
                      ? '__design_sheet_spouse__'
                      : trusteeSource === 'fiduciary'
                        ? (form.trusteeFiduciaryId || form.fiduciaries[0]?.id || '')
                        : '__design_sheet_client__'
                    updateForm({
                      trusteeSource,
                      trusteeContactId,
                      trusteeFiduciaryId: trusteeSource === 'fiduciary'
                        ? (form.trusteeFiduciaryId || form.fiduciaries[0]?.id || '')
                        : '',
                    })
                  }}
                >
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="spouse">Spouse</SelectItem>
                    <SelectItem value="fiduciary">Fiduciary</SelectItem>
                  </SelectContent>
                </Select>
                {form.trusteeSource === 'fiduciary' && (
                  <div className="space-y-2">
                    {form.fiduciaries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {allowFiduciaryEditing
                          ? 'Add a fiduciary to select as trustee.'
                          : 'Assign fiduciaries in the Fiduciaries section to select a trustee here.'}
                      </p>
                    ) : (
                      form.fiduciaries.map(fiduciary => (
                        <div
                          key={fiduciary.id}
                          className="flex items-center gap-2 rounded-md border border-border p-3"
                        >
                          <Checkbox
                            checked={form.trusteeFiduciaryId === fiduciary.id}
                            onCheckedChange={() => updateForm({
                              trusteeFiduciaryId: fiduciary.id,
                              trusteeContactId: fiduciary.id,
                              trusteeSource: 'fiduciary',
                            })}
                          />
                          {allowFiduciaryEditing ? (
                            <Input
                              placeholder="Fiduciary name"
                              value={fiduciary.name}
                              onChange={event => updateFiduciary(fiduciary.id, event.target.value)}
                            />
                          ) : (
                            <span className="text-sm">{fiduciary.name}</span>
                          )}
                          {allowFiduciaryEditing && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => removeFiduciary(fiduciary.id)}
                              aria-label="Remove fiduciary"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                    {allowFiduciaryEditing && (
                      <Button type="button" variant="outline" size="sm" onClick={addFiduciary}>
                        <Plus className="mr-1 h-4 w-4" />
                        Add fiduciary
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Beneficial owners</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => updateForm({ beneficialOwners: [...form.beneficialOwners, newBeneficialOwner('client')] })}
              >
                <Plus className="mr-1 h-3 w-3" />
                Client
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => updateForm({ beneficialOwners: [...form.beneficialOwners, newBeneficialOwner('spouse')] })}
              >
                <Plus className="mr-1 h-3 w-3" />
                Spouse
              </Button>
              {form.trustNames.map(name => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => updateForm({
                    beneficialOwners: [...form.beneficialOwners, newBeneficialOwner('trust', name)],
                  })}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {name}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => updateForm({ beneficialOwners: [...form.beneficialOwners, newBeneficialOwner('custom')] })}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add beneficial owner
              </Button>
            </div>
            {form.beneficialOwners.length === 0 ? (
              <p className="text-xs text-muted-foreground">No beneficial owners added yet.</p>
            ) : (
              <div className="space-y-2">
                {form.beneficialOwners.map(entry => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <Badge variant="secondary">{partySourceLabel(entry.source)}</Badge>
                    {entry.source === 'trust' && form.trustNames.length > 1 ? (
                      <Select
                        value={entry.trustName ?? ''}
                        onValueChange={value => updateForm({
                          beneficialOwners: form.beneficialOwners.map(item =>
                            item.id === entry.id ? { ...item, trustName: value } : item,
                          ),
                        })}
                      >
                        <SelectTrigger className="h-8 w-48">
                          <SelectValue placeholder="Select trust" />
                        </SelectTrigger>
                        <SelectContent>
                          {form.trustNames.map(name => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : entry.source === 'custom' ? (
                      <Input
                        className="h-8 max-w-xs"
                        placeholder="Name"
                        value={entry.customName ?? ''}
                        onChange={event => updateForm({
                          beneficialOwners: form.beneficialOwners.map(item =>
                            item.id === entry.id ? { ...item, customName: event.target.value } : item,
                          ),
                        })}
                      />
                    ) : (
                      <span className="text-sm">{partyDisplayName(entry, form)}</span>
                    )}
                    <Input
                      className="h-8 w-24"
                      placeholder="%"
                      value={entry.percentage}
                      onChange={event => updateForm({
                        beneficialOwners: form.beneficialOwners.map(item =>
                          item.id === entry.id ? { ...item, percentage: event.target.value } : item,
                        ),
                      })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="ml-auto h-7 w-7"
                      onClick={() => updateForm({
                        beneficialOwners: form.beneficialOwners.filter(item => item.id !== entry.id),
                      })}
                      aria-label="Remove beneficial owner"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {showDeedFields && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {showUpload && showTrustFields ? '3. Deed' : showUpload || showTrustFields ? '2. Deed' : '1. Deed'}
          </CardTitle>
          <CardDescription>
            {hasExtracted
              ? 'Review deed fields extracted from the uploaded PDF and select grantees.'
              : 'Upload a deed PDF to populate grantor and recording fields, or enter values manually.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="grantor">First grantor</Label>
              <Input
                id="grantor"
                value={form.deedFields.grantor ?? ''}
                onChange={event => updateDeedField('grantor', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grantor_2">Second grantor (if any)</Label>
              <Input
                id="grantor_2"
                value={form.deedFields.grantor_2 ?? ''}
                onChange={event => updateDeedField('grantor_2', event.target.value)}
              />
            </div>
          </div>

          <PartyPicker
            label="Grantee(s)"
            selections={form.grantees}
            form={form}
            onChange={grantees => updateForm({ grantees })}
            allowRealtyTrust
          />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Property address</h3>
            <p className="text-xs text-muted-foreground">
              Extracted from the uploaded deed. Client information is used only as a fallback and can be corrected here.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="property_address">Street address</Label>
                <Input
                  id="property_address"
                  value={deedPropertyAddress}
                  onChange={event => updateDeedField('property_address', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="property_city">City / town</Label>
                <Input
                  id="property_city"
                  value={deedPropertyCity}
                  onChange={event => updateDeedField('property_city', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="property_state">State</Label>
                <Input
                  id="property_state"
                  value={deedPropertyState}
                  onChange={event => updateDeedField('property_state', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="property_county">County</Label>
                <Input
                  id="property_county"
                  value={deedPropertyCounty}
                  onChange={event => updateDeedField('property_county', event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recording_system">Recording system</Label>
              <Select
                value={form.deedFields.recording_system ?? 'registry'}
                onValueChange={value => updateDeedField('recording_system', value)}
              >
                <SelectTrigger id="recording_system"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="registry">Registry of Deeds</SelectItem>
                  <SelectItem value="land_court">Land Court / registered land</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description_type">Legal-description type</Label>
              <Select
                value={form.deedFields.description_type ?? 'lot_plan'}
                onValueChange={value => updateDeedField('description_type', value)}
              >
                <SelectTrigger id="description_type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lot_plan">Lot / plan</SelectItem>
                  <SelectItem value="metes_and_bounds">Metes and bounds</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {DEED_INPUT_FIELDS.filter(field => {
              if (field.key === 'grantor' || field.key === 'grantor_2') return false
              if (form.deedFields.recording_system === 'land_court') {
                return field.key !== 'current_deed_book_number' && field.key !== 'current_deed_page'
              }
              return field.key !== 'current_deed_document_number' && field.key !== 'current_certificate_number'
            }).map(field => (
              <div
                key={field.key}
                className={field.multiline ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}
              >
                <Label htmlFor={field.key}>{field.label}</Label>
                {field.multiline ? (
                  <Textarea
                    id={field.key}
                    value={form.deedFields[field.key] ?? ''}
                    onChange={event => updateDeedField(field.key, event.target.value)}
                    rows={4}
                  />
                ) : (
                  <Input
                    id={field.key}
                    type={field.key.includes('date') ? 'date' : 'text'}
                    value={form.deedFields[field.key] ?? ''}
                    onChange={event => updateDeedField(field.key, event.target.value)}
                  />
                )}
              </div>
            ))}
            {form.deedFields.description_type === 'metes_and_bounds' && (
              <div className="space-y-3 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>Directional calls and bounds</Label>
                    <p className="text-xs text-muted-foreground">Rows render in deed order; add as many as the description requires.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => updateBoundaryCalls([
                      ...(form.deedFields.boundary_calls ?? []),
                      { directional_call: '', bound_description: '' },
                    ])}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add call
                  </Button>
                </div>
                {(form.deedFields.boundary_calls ?? []).map((call, index) => (
                  <div key={index} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_auto]">
                    <Input
                      aria-label={`Directional call ${index + 1}`}
                      placeholder="NORTHWESTERLY"
                      value={call.directional_call}
                      onChange={event => updateBoundaryCall(index, { directional_call: event.target.value })}
                    />
                    <Input
                      aria-label={`Bound description ${index + 1}`}
                      placeholder="by land now or formerly of..."
                      value={call.bound_description}
                      onChange={event => updateBoundaryCall(index, { bound_description: event.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove boundary call ${index + 1}`}
                      onClick={() => updateBoundaryCalls((form.deedFields.boundary_calls ?? []).filter((_, callIndex) => callIndex !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {showCertificateFields && (
              <div className="space-y-1.5">
                <Label htmlFor="certificate_execution_county">Certificate execution county</Label>
                <Input
                  id="certificate_execution_county"
                  value={form.deedFields.certificate_execution_county ?? ''}
                  onChange={event => updateDeedField('certificate_execution_county', event.target.value)}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {showCertificateFields && !showDeedFields && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trustee&apos;s Certificate</CardTitle>
            <CardDescription>Fields used for the Trustee&apos;s Certificate.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="certificate_execution_county">Certificate execution county</Label>
              <Input
                id="certificate_execution_county"
                value={form.deedFields.certificate_execution_county ?? ''}
                onChange={event => updateDeedField('certificate_execution_county', event.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {!hideDocumentPicker && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">4. Generate documents</CardTitle>
          <CardDescription>
            Choose which documents to create. Multiple selections download as a ZIP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {REAL_ESTATE_TRANSFER_DOC_TYPES.map(docType => (
              <label
                key={docType}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <Checkbox
                  checked={selectedDocs.has(docType)}
                  onCheckedChange={() => toggleDoc(docType)}
                />
                <span className="text-sm">{DOCUMENT_TYPES[docType].label}</span>
              </label>
            ))}
          </div>
          <Button type="button" disabled={working || selectedDocs.size === 0} onClick={handleGenerate}>
            {busy === 'generate' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden />
            )}
            Generate selected
          </Button>
        </CardContent>
      </Card>
      )}
    </div>
  )
}
