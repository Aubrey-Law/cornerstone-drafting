'use client'

import { GuidedSection } from '@/components/intake/GuidedSection'
import type { EvaluatedIntakeSection } from '@/lib/intake/forms/evaluator'
import type { IntakeBlockRendererProps } from './blockRenderers'
import { CompiledFormItem } from './CompiledFormItem'

export interface CompiledFormSectionProps extends Omit<IntakeBlockRendererProps, 'config'> {
  section: EvaluatedIntakeSection
  number: number
  open: boolean
  disabled?: boolean
  showValidation?: boolean
  onToggle: () => void
  onContinue?: () => void
}

export function CompiledFormSection({ section, number, open, disabled = false, showValidation = true, onToggle, onContinue, ...itemProps }: CompiledFormSectionProps) {
  const time = section.timeEstimate > 0 ? `~${section.timeEstimate} min` : undefined
  const subtitle = [section.subtitle, time].filter(Boolean).join(' · ') || undefined
  const issues = showValidation ? section.issues : []
  return (
    <GuidedSection id={`intake-section-${section.id}`} number={number} title={section.title} subtitle={subtitle} complete={section.complete} open={open} onToggle={onToggle} onContinue={onContinue}>
      {issues.length > 0 ? (
        <div role={issues.some((issue) => issue.severity === 'error') ? 'alert' : 'status'} className="my-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <ul className="list-disc pl-4">
            {issues.map((issue, index) => <li key={`${issue.message}-${index}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}
      {disabled ? <p className="my-3 text-sm text-muted-foreground">Client&apos;s answers (read-only). Edit fields from the matter&apos;s intake editor.</p> : null}
      <div className="space-y-5 pt-3">
        {section.items.map((entry) => <CompiledFormItem key={entry.id} item={entry.item} {...itemProps} disabled={disabled} />)}
      </div>
    </GuidedSection>
  )
}
