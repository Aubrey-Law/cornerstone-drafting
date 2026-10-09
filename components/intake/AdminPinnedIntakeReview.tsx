'use client'

import { useMemo, useState } from 'react'
import { getBuilderField, readBuilderFieldValue } from '@aubrey-law/estate-fields/core'
import { saveAdminIntakeQuestion } from '@/app/actions/adminIntakeQuestion'
import { isStaffContactBlock, isStaffEditableBlock, isStaffEditableQuestion } from '@/lib/intake/forms/staffEditableFields'
import StaffAdditionalContactEditor from './StaffAdditionalContactEditor'
import StaffAppointmentEditor from './StaffAppointmentEditor'
import { APPOINTMENT_CHOICE_KEYS, isStaffAppointmentBlock, type StaffAppointmentData } from '@/lib/intake/forms/staffAppointments'
import { isStaffHouseholdBlock } from '@/lib/intake/forms/staffHousehold'
import StaffHouseholdEditor, { type SavedHouseholdContact } from './StaffHouseholdEditor'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { CompiledFormItem } from './formEngine/CompiledFormItem'
import { hipaaRecipientEditValue, STAFF_HIPAA_RECIPIENTS, withStaffHipaaRecipients } from '@/lib/intake/forms/staffHipaaRecipients'
import { financialEditValue, staffFinancialReadError, withStaffFinancialAnswers } from '@/lib/intake/forms/staffFinancialAnswers'
import { planningObjectivesEditValue } from '@/lib/intake/forms/staffPlanningObjectives'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import { CompiledIntakeReview } from './formEngine/CompiledIntakeReview'

export default function AdminPinnedIntakeReview({ form, data, intakeId, dirty, disabled, onEditingChange, onSaved }: {
  form: CompiledIntakeForm
  data: Record<string, unknown>
  intakeId: string
  dirty: boolean
  disabled?: boolean
  onEditingChange?: (editing: boolean) => void
  onSaved?: () => Promise<void>
}) {
  const reviewData = useMemo(() => unpackInitialIntakeData({ ...withStaffFinancialAnswers(withStaffHipaaRecipients(data)), planning_objectives: planningObjectivesEditValue(data.planning_objectives) }), [data])
  const financialReadError = useMemo(() => staffFinancialReadError(data), [data])
  const evaluation = useMemo(() => evaluateCompiledIntakeForm(form, reviewData), [form, reviewData])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [changes, setChanges] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = Boolean(onSaved) && !dirty && !disabled && data.status !== 'submitted' && data.status !== 'approved'
    && typeof data.form_version_id === 'string' && (data.updated_at === null || typeof data.updated_at === 'string')
  function finish() {
    setEditing(null)
    setError('')
    onEditingChange?.(false)
  }
  function editValue(fieldId: string) {
    if (isStaffAppointmentBlock(fieldId)) return draft._staff_appointment_edit
    if (isStaffHouseholdBlock(fieldId)) return draft._staff_household_edit
    if (fieldId === 'address' || fieldId === 'existing_document_uploads') return changes
    if (isStaffContactBlock(fieldId)) return draft._staff_contact_edit
    if (fieldId === STAFF_HIPAA_RECIPIENTS) return hipaaRecipientEditValue(draft.college_hipaa_recipients)
    if (fieldId === 'financial_assets') return financialEditValue(changes)
    if (fieldId === 'planning_objectives') return planningObjectivesEditValue(draft.planning_objectives)
    const field = getBuilderField(fieldId)
    return readBuilderFieldValue(fieldId, draft) ?? (field.control === 'boolean' ? null : field.control === 'multiselect' ? [] : '')
  }
  async function save(fieldId: string) {
    setSaving(true)
    setError('')
    try {
      await saveAdminIntakeQuestion({ intakeId, expectedVersionId: data.form_version_id as string,
        expectedUpdatedAt: data.updated_at as string | null, fieldId,
        value: editValue(fieldId),
      })
      await onSaved?.()
      finish()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save this answer.') }
    finally { setSaving(false) }
  }
  return <section aria-label="Saved pinned questionnaire" className="mb-6 space-y-3 rounded-lg border p-3">
    <h2 className="font-semibold">{form.title}</h2>
    {form.description && <p className="text-sm text-muted-foreground">{form.description}</p>}
    <p className="text-sm text-muted-foreground">Review and edit the saved answers for the client&apos;s questionnaire version here. Save or cancel each change before starting another. Household and appointment changes retain contact identities.</p>
    {dirty && <p role="status" className="text-sm text-amber">Save your edits to refresh this review before submitting.</p>}
    {editing && <p role="status" className="text-sm text-muted-foreground">Save or cancel this question before editing other details or closing the intake.</p>}
    <CompiledIntakeReview evaluation={evaluation} data={reviewData} intakeId={intakeId} renderItem={({ item, id }) => {
      if (item.kind === 'question') return undefined
      if (item.kind === 'block' && (item.blockId === 'attorney_plan_structure' || item.blockId === 'attorney_documents')) {
        const matterId = (data._staff_appointments as StaffAppointmentData | undefined)?.matterId
        return <div className="space-y-2"><CompiledFormItem item={item} data={reviewData} disabled update={() => {}} />
          {matterId && <a className="text-sm underline" href={`/admin/drafting/${matterId}`}>Edit plan and documents in the drafting workspace</a>}</div>
      }
      if (item.kind === 'field' ? !isStaffEditableQuestion(item.fieldId) : !isStaffEditableBlock(item.blockId)) return undefined
      if (item.kind === 'block' && item.blockId === 'financial_assets' && financialReadError) return <p role="alert" className="text-sm text-destructive">{financialReadError}</p>
      const fieldId = item.kind === 'field' ? item.fieldId : item.blockId
      if (isStaffAppointmentBlock(fieldId) && !data._staff_appointments) return <p role="alert">{String(data._staff_appointment_error ?? 'Reload the questionnaire to load appointment details.')}</p>
      const selected = editing === id
      const contactOperation = isStaffContactBlock(fieldId) ? (draft._staff_contact_edit as { operation?: string } | null)?.operation : undefined
      const label = item.kind === 'field' ? item.label ?? getBuilderField(item.fieldId).label : item.title ?? (isStaffHouseholdBlock(item.blockId) ? 'Household' : item.blockId === 'existing_document_uploads' ? 'Existing documents' : item.blockId === 'address' ? 'Address' : isStaffAppointmentBlock(item.blockId) ? 'Appointments' : isStaffContactBlock(item.blockId) ? 'Saved contacts' : item.blockId === 'financial_assets' ? 'Financial details' : item.blockId === 'planning_objectives' ? 'Planning objectives' : 'HIPAA recipients')
      return <div className="space-y-2">
        {selected && isStaffHouseholdBlock(fieldId) ? <StaffHouseholdEditor key={id} block={fieldId} contacts={(data._staff_household ?? []) as SavedHouseholdContact[]} disabled={saving}
          update={value => setDraft(current => ({ ...current, _staff_household_edit: value }))} /> : selected && isStaffAppointmentBlock(fieldId) ? <StaffAppointmentEditor key={id} block={fieldId} saved={data._staff_appointments as StaffAppointmentData} disabled={saving} reviewChoice={String((reviewData._review_choices as Record<string, unknown> | undefined)?.[APPOINTMENT_CHOICE_KEYS[fieldId]] ?? '')}
          excludedNames={Array.isArray(reviewData._fid_excluded_guardian) ? (reviewData._fid_excluded_guardian as Record<string, unknown>[]).map(row => [row.first_name,row.middle_name,row.last_name,row.suffix].filter(Boolean).join(' ')).join('\n') : String(data.excluded_guardian ?? '')}
          update={value => setDraft(current => ({ ...current, _staff_appointment_edit: value }))} /> : selected && isStaffContactBlock(fieldId) ? <StaffAdditionalContactEditor key={id} contacts={data._additional_contacts} removed={data._staff_removed_contacts} disabled={saving}
          update={value => setDraft(current => ({ ...current, _staff_contact_edit: value }))} /> : <CompiledFormItem key={`${id}-${selected ? 'edit' : 'review'}`} item={item} data={selected ? draft : reviewData} intakeId={intakeId} disabled={!selected || saving}
          update={(key, value) => { setDraft(current => ({ ...current, [key]: value })); setChanges(current => ({ ...current, [key]: value })) }} />}
        {selected ? <>
          {fieldId === 'existing_document_uploads' && <p className="text-sm text-muted-foreground">File uploads save immediately. Save answer applies the document questions; cancel does not remove uploaded files.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <button type="button" className="text-sm underline" disabled={saving || (isStaffContactBlock(fieldId) && !draft._staff_contact_edit) || (isStaffAppointmentBlock(fieldId) && !draft._staff_appointment_edit) || (isStaffHouseholdBlock(fieldId) && !draft._staff_household_edit)} onClick={() => void save(fieldId)}>{saving ? 'Saving…' : contactOperation === 'restore' ? 'Restore contact' : contactOperation === 'remove' ? 'Save removal' : contactOperation === 'add' ? 'Save new contact' : 'Save answer'}</button>
            <button type="button" className="text-sm underline" disabled={saving} onClick={finish}>Cancel question edit</button>
          </div>
        </> : onSaved && <button type="button" className="text-sm underline disabled:opacity-50" disabled={!canEdit || editing !== null}
          aria-label={`Edit ${label}`} onClick={() => { setDraft({ ...reviewData, _staff_contact_edit: null, _staff_appointment_edit: null, _staff_household_edit: null }); setChanges({}); setEditing(id); setError(''); onEditingChange?.(true) }}>Edit answer</button>}
      </div>
    }} />
  </section>
}
