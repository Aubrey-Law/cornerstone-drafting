'use client'

import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import type { IntakeFormEvaluation } from '@/lib/intake/forms/evaluator'
import type { IntakeBlockRendererProps } from './blockRenderers'
import { CompiledFormSection } from './CompiledFormSection'

export interface CompiledIntakeSectionsProps extends Omit<IntakeBlockRendererProps, 'config'> {
  form: CompiledIntakeForm
  evaluation: IntakeFormEvaluation
  mode?: 'client' | 'public_link' | 'attorney' | 'staff'
  openId: string
  onToggle: (sectionId: string) => void
  onContinue?: (sectionId: string, nextSectionId: string) => void
  showValidation?: boolean
  /** The interview shell may render its own progress rail using this same evaluation. */
  showProgress?: boolean
  /** The attorney shell may prepend its existing plan/document cards. */
  numberOffset?: number
  onLastContinue?: (sectionId: string) => void
}

/** Evaluation owns active ordering, completion, issues, estimates and progress. */
export function CompiledIntakeSections({ form, evaluation, mode = 'client', openId, onToggle, onContinue, onLastContinue, numberOffset = 0, showValidation = true, showProgress = false, ...itemProps }: CompiledIntakeSectionsProps) {
  const isStaff = mode === 'attorney' || mode === 'staff'
  return (
    <div aria-label={`${form.title} sections`} className="space-y-4">
      {showProgress ? (
        <div className="space-y-2">
          <div role="progressbar" aria-label="Intake progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={evaluation.percentComplete} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${evaluation.percentComplete}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">{evaluation.completedRequired} of {evaluation.requiredSections.length} done · ~{evaluation.remainingMinutes} min remaining</p>
        </div>
      ) : null}
      {evaluation.activeSections.map((section, index) => {
        const next = evaluation.activeSections[index + 1]
        return (
          <CompiledFormSection
            key={section.id}
            {...itemProps}
            section={section}
            number={index + 1 + numberOffset}
            open={openId === section.id}
            disabled={isStaff && section.audience === 'client_and_staff'}
            showValidation={showValidation}
            onToggle={() => onToggle(section.id)}
            onContinue={next && onContinue ? () => onContinue(section.id, next.id) : !next && onLastContinue ? () => onLastContinue(section.id) : undefined}
            continueLabel={onLastContinue ? next ? `Continue to ${next.title}${next.timeEstimate ? ` · ~${next.timeEstimate} min` : ''}` : 'Review questionnaire' : undefined}
          />
        )
      })}
    </div>
  )
}
