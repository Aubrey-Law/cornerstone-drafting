import { createHash } from 'node:crypto'
import { parseIntakeFormDefinition } from './schema'
import type { IntakeFormDefinition } from './types'

/** Check descriptors before the parser can evaluate untrusted getters. */
function assertJsonInput(raw: unknown): void {
  const active = new Set<object>()
  const pending: { value: unknown; leave?: boolean }[] = [{ value: raw }]
  const invalid = () => { throw new Error('Invalid intake form definition: Must be a serializable JSON value') }
  while (pending.length) {
    const { value, leave } = pending.pop()!
    if (leave) { active.delete(value as object); continue }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue
    if (typeof value === 'number' && Number.isFinite(value)) continue
    if (typeof value !== 'object' || value === null) invalid()
    const object = value as object
    const array = Array.isArray(object)
    const prototype = Object.getPrototypeOf(object)
    if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) || active.has(object)) invalid()
    const keys = Reflect.ownKeys(object).filter((key) => !(array && key === 'length'))
    if (array && keys.length !== object.length) invalid()
    active.add(object)
    pending.push({ value: object, leave: true })
    for (const key of keys) {
      if (typeof key !== 'string') invalid()
      if (array && (!/^(0|[1-9]\d*)$/.test(key as string) || Number(key) >= object.length)) invalid()
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) invalid()
      pending.push({ value: descriptor.value })
    }
  }
}

function sortJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortJson) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, sortJson(child)])) as T
  }
  return value
}

/** Strictly parse before canonicalizing; array order remains meaningful. */
export function canonicalizeIntakeFormDefinition(raw: unknown): IntakeFormDefinition {
  assertJsonInput(raw)
  const parsed = parseIntakeFormDefinition(raw)
  if (!parsed.success) throw new Error(`Invalid intake form definition: ${parsed.errors.join('; ')}`)
  return sortJson(parsed.data)
}

export function hashIntakeFormDefinition(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalizeIntakeFormDefinition(raw))).digest('hex')
}
