'use client'

import type { ReactNode } from 'react'
import type { EvaluatedIntakeItem, IntakeFormEvaluation } from '@/lib/intake/forms/evaluator'
import { CompiledFormItem } from './CompiledFormItem'

const noOp = () => {}

/** Read-only by default; an authorized staff wrapper may supply an item editor. */
export function CompiledIntakeReview({ evaluation, data, description, onEditSection, intakeId, publicIntakeToken, renderItem }: {
  renderItem?: (entry: EvaluatedIntakeItem) => ReactNode
  evaluation: IntakeFormEvaluation
  data: Record<string, unknown>
  intakeId?: string
  publicIntakeToken?: string
  description?: string
  onEditSection?: (id: string) => void
}) {
  return <section aria-label="Current form review" className="space-y-4">
    {description && <p className="text-sm text-muted-foreground">{description}</p>}
    {evaluation.activeSections.map(section => {
      const items = section.items.filter(({ item }) => item.kind !== 'block' || item.blockId !== 'review_submit')
      if (!items.length) return null
      return <div key={section.id} data-intake-section={section.id} tabIndex={-1} className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">{section.title}</h4>
          {onEditSection && <button type="button" className="text-sm underline" aria-label={`Edit ${section.title}`} onClick={() => onEditSection(section.id)}>Edit</button>}
        </div>
        {items.map(entry => <div key={entry.id} className="space-y-2">
          {renderItem?.(entry) ?? <CompiledFormItem item={entry.item} data={data} intakeId={intakeId} publicIntakeToken={publicIntakeToken} disabled update={noOp} onEditSection={noOp} />}
          {entry.issues.length > 0 && <ul className="space-y-1 text-sm">{entry.issues.map((issue, index) => <li key={index} className={issue.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{issue.message}</li>)}</ul>}
        </div>)}
      </div>
    })}
  </section>
}
