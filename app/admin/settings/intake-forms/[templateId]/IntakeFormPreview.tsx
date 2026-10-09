'use client'

import { useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CompiledIntakeSections } from '@/components/intake/formEngine/CompiledIntakeSections'
import { CompiledIntakeReview } from '@/components/intake/formEngine/CompiledIntakeReview'
import { compileIntakeForm } from '@/lib/intake/forms/compiler'
import { evaluateCompiledIntakeForm } from '@/lib/intake/forms/evaluator'
import { clonePreviewScenarioAnswers, INTAKE_PREVIEW_SCENARIOS, type PreviewScenarioId } from '@/lib/intake/forms/previewScenarios'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

const noOp = () => {}

/** Synthetic answers only: no intake identity or persistence capabilities. */
export function IntakeFormPreview({ localDefinition }: { localDefinition: IntakeFormDefinition }) {
  const [audience, setAudience] = useState<'client' | 'staff'>(localDefinition.purpose === 'discovery_call' ? 'staff' : 'client')
  const [scenario, setScenario] = useState<PreviewScenarioId>('empty')
  const [openId, setOpenId] = useState<string | null>(null)
  const compiled = useMemo(() => compileIntakeForm(localDefinition, audience), [localDefinition, audience])
  const data = useMemo(() => ({ ...clonePreviewScenarioAnswers(scenario), intake_track: localDefinition.key }), [scenario, localDefinition.key])
  const evaluation = useMemo(() => compiled.success ? evaluateCompiledIntakeForm(compiled.form, data) : null, [compiled, data])
  const activeOpenId = openId === '' ? '' : evaluation?.activeSections.some(section => section.id === openId) ? openId! : evaluation?.activeSections[0]?.id ?? ''

  return <section aria-label="Form preview" className="min-w-0 space-y-4 rounded-lg border p-4">
    <div><h2 className="text-lg font-semibold">{localDefinition.title || 'Form preview'}</h2>
      <p className="text-sm text-muted-foreground">Read-only preview with sample answers. Nothing entered here is saved or submitted.</p>
      {localDefinition.description && <p className="mt-2 text-sm">{localDefinition.description}</p>}
    </div>
    <Tabs value={audience} onValueChange={value => { if (value === 'client' || value === 'staff') { setAudience(value); setOpenId(null) } }}>
      <div className="flex flex-wrap items-end gap-4">
        <TabsList aria-label="Preview audience"><TabsTrigger value="client">Client</TabsTrigger><TabsTrigger value="staff">Staff</TabsTrigger></TabsList>
        <div className="space-y-1"><label htmlFor="intake-preview-scenario" className="text-sm font-medium">Sample scenario</label>
          <Select value={scenario} onValueChange={value => { if (Object.hasOwn(INTAKE_PREVIEW_SCENARIOS, value)) { setScenario(value as PreviewScenarioId); setOpenId(null) } }}>
            <SelectTrigger id="intake-preview-scenario"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(INTAKE_PREVIEW_SCENARIOS) as PreviewScenarioId[]).map(id => <SelectItem key={id} value={id}>{INTAKE_PREVIEW_SCENARIOS[id].label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <TabsContent value={audience} className="mt-3">
        {compiled.success && evaluation ? <CompiledIntakeSections form={compiled.form} evaluation={evaluation} data={data}
          mode={audience} readOnly openId={activeOpenId} onToggle={id => setOpenId(activeOpenId === id ? '' : id)}
          previewReview={<CompiledIntakeReview evaluation={evaluation} data={data}
            description="Review the current form with these sample answers. Missing answers reflect this form's requirements." />}
          update={noOp} onEditSection={noOp} showValidation={false} />
          : <div role="alert" className="rounded-lg border border-destructive p-4">
            <p>Preview is unavailable until the form checks below are resolved.</p>
          </div>}
      </TabsContent>
    </Tabs>
  </section>
}
