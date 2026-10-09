import type { FormFieldId } from '@/lib/discovery/catalog'
import type { IntakeCondition } from './types'

function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function evaluateIntakeCondition(
  condition: IntakeCondition | undefined,
  resolveValue: (fieldId: FormFieldId) => unknown,
): boolean {
  if (!condition) return true
  if ('conditions' in condition) {
    return condition.op === 'all'
      ? condition.conditions.every((entry) => evaluateIntakeCondition(entry, resolveValue))
      : condition.conditions.some((entry) => evaluateIntakeCondition(entry, resolveValue))
  }
  const value = resolveValue(condition.fieldId)
  if (condition.op === 'is_set') return isSet(value)
  return condition.op === 'equals' ? value === condition.value : value !== condition.value
}

/** Unique referenced registry IDs, in first-appearance order. */
export function collectConditionFieldIds(condition: IntakeCondition | undefined): FormFieldId[] {
  const fields = new Set<FormFieldId>()
  function visit(entry: IntakeCondition): void {
    if ('conditions' in entry) entry.conditions.forEach(visit)
    else fields.add(entry.fieldId)
  }
  if (condition) visit(condition)
  return [...fields]
}
