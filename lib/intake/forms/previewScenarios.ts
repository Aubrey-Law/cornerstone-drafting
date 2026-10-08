type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

export const INTAKE_PREVIEW_SCENARIOS = deepFreeze({
  empty: { label: 'Empty', answers: {} },
  single: { label: 'Single', answers: {
    first_name: 'Jordan', last_name: 'Lee', marital_status: 'Single', has_children: false,
  } },
  married: { label: 'Married', answers: {
    first_name: 'Jordan', last_name: 'Lee', marital_status: 'Married', has_children: false,
    _spouse: { first_name: 'Morgan', last_name: 'Lee' },
  } },
  family: { label: 'Family with children', answers: {
    first_name: 'Jordan', last_name: 'Lee', marital_status: 'Married',
    has_children: true, has_minor_children: true,
    _spouse: { first_name: 'Morgan', last_name: 'Lee' },
    _children: [{ first_name: 'Riley', last_name: 'Lee', relationship_type: 'Child' }],
  } },
} as const)

export type PreviewScenarioId = keyof typeof INTAKE_PREVIEW_SCENARIOS

/** Each preview starts with its own mutable answers, including all nested people. */
export function clonePreviewScenarioAnswers(id: PreviewScenarioId): Record<string, unknown> {
  return structuredClone(INTAKE_PREVIEW_SCENARIOS[id].answers)
}
