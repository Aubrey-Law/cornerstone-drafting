import { createHash } from 'node:crypto'
import type { EstateClauseContent } from '@/lib/estateClauses/types'

const FIELD_PATH_RE = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*(?:\[\])?$/
const OUTPUT_TAG_RE = /{{([\s\S]*?)}}/g
const BLOCK_TAG_RE = /{%([\s\S]*?)%}/g
const COMMENT_TAG_RE = /{#([\s\S]*?)#}/g
const INCLUDE_CLAUSE_RE = /^include_clause\(\s*(['"])([A-Za-z0-9._-]+)\1\s*\)$/
const SIMPLE_FILTER_RE = /^(?:name|NAME|optional)$/

type FilterChainResult =
  | { parts: string[]; error?: never }
  | { parts?: never; error: string }

function splitFilterChain(expression: string): FilterChainResult {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]
    if (quote) {
      current += character
      if (character === '\\') {
        index += 1
        if (index >= expression.length) {
          return { error: 'Unclosed quote in template expression' }
        }
        current += expression[index]
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
    } else if (character === '|') {
      parts.push(current)
      current = ''
    } else {
      current += character
    }
  }

  if (quote) return { error: 'Unclosed quote in template expression' }
  parts.push(current)
  return { parts }
}

function isValidOrMissingFilter(filter: string): boolean {
  if (filter === 'orMissing') return true
  if (!filter.startsWith('orMissing')) return false

  let index = 'orMissing'.length
  while (/\s/.test(filter[index] ?? '')) index += 1
  if (filter[index] !== '(') return false
  index += 1
  while (/\s/.test(filter[index] ?? '')) index += 1

  const quote = filter[index]
  if (quote !== '"' && quote !== "'") return false
  index += 1

  let closed = false
  while (index < filter.length) {
    const character = filter[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === quote) {
      index += 1
      closed = true
      break
    }
    index += 1
  }
  if (!closed) return false

  while (/\s/.test(filter[index] ?? '')) index += 1
  if (filter[index] !== ')') return false
  index += 1
  while (/\s/.test(filter[index] ?? '')) index += 1
  return index === filter.length
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }

  return [...duplicates].sort()
}

function validateVariableExpression(expression: string, declaredFields: ReadonlySet<string>): string[] {
  const filterChain = splitFilterChain(expression)
  if (filterChain.error) return [filterChain.error]

  const [rawField, ...rawFilters] = filterChain.parts
  const field = rawField.trim()
  const errors: string[] = []

  if (!FIELD_PATH_RE.test(field)) {
    return [`Unsupported template expression: ${expression}`]
  }
  if (!declaredFields.has(field)) {
    errors.push(`Undeclared placeholder field: ${field}`)
  }

  for (const rawFilter of rawFilters) {
    const filter = rawFilter.trim()
    if (!SIMPLE_FILTER_RE.test(filter) && !isValidOrMissingFilter(filter)) {
      errors.push(`Unsupported template filter: ${filter || '(empty)'}`)
    }
  }

  return errors
}

export function validateEstateClauseContent(
  content: EstateClauseContent,
  catalog: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  const declaredFields = new Set(content.requiredFields)
  const declaredNestedKeys = new Set(content.nestedClauseKeys)
  const includedNestedKeys = new Set<string>()

  for (const field of duplicateValues(content.requiredFields)) {
    errors.push(`Duplicate required field: ${field}`)
  }
  for (const field of [...declaredFields].sort()) {
    if (!FIELD_PATH_RE.test(field)) errors.push(`Invalid required field: ${field}`)
  }
  if (content.conditionField && !FIELD_PATH_RE.test(content.conditionField)) {
    errors.push(`Invalid condition field: ${content.conditionField}`)
  }

  for (const key of [...declaredNestedKeys].sort()) {
    if (!catalog.has(key)) errors.push(`Unknown nested clause key: ${key}`)
  }

  for (const match of content.text.matchAll(BLOCK_TAG_RE)) {
    errors.push(`Unsupported template block: ${match[1].trim()}`)
  }
  for (const match of content.text.matchAll(COMMENT_TAG_RE)) {
    errors.push(`Unsupported template comment: ${match[1].trim()}`)
  }

  for (const match of content.text.matchAll(OUTPUT_TAG_RE)) {
    const expression = match[1].trim()
    const include = INCLUDE_CLAUSE_RE.exec(expression)
    if (include) {
      includedNestedKeys.add(include[2])
      continue
    }
    errors.push(...validateVariableExpression(expression, declaredFields))
  }

  for (const key of [...includedNestedKeys].sort()) {
    if (!declaredNestedKeys.has(key)) {
      errors.push(`Nested clause key is included but not declared: ${key}`)
    }
  }
  for (const key of [...declaredNestedKeys].sort()) {
    if (!includedNestedKeys.has(key)) {
      errors.push(`Nested clause key is declared but not included: ${key}`)
    }
  }

  const textWithoutCompleteTags = content.text
    .replace(OUTPUT_TAG_RE, '')
    .replace(BLOCK_TAG_RE, '')
    .replace(COMMENT_TAG_RE, '')
  if (/{{|}}|{%|%}|{#|#}/.test(textWithoutCompleteTags)) {
    errors.push('Malformed template syntax')
  }

  return errors
}

export function hashEstateClauseContent(content: EstateClauseContent): string {
  const canonical = JSON.stringify({
    text: content.text.replace(/\r\n/g, '\n'),
    requiredFields: [...new Set(content.requiredFields)].sort(),
    nestedClauseKeys: [...new Set(content.nestedClauseKeys)].sort(),
    conditionField: content.conditionField ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function assertNoClauseCycles(catalog: ReadonlyMap<string, readonly string[]>): void {
  const visited = new Set<string>()
  const active = new Map<string, number>()
  const path: string[] = []

  function visit(clauseKey: string): void {
    const cycleStart = active.get(clauseKey)
    if (cycleStart !== undefined) {
      const cycle = [...path.slice(cycleStart), clauseKey]
      throw new Error(`Estate clause cycle: ${cycle.join(' -> ')}`)
    }
    if (visited.has(clauseKey)) return

    active.set(clauseKey, path.length)
    path.push(clauseKey)
    const nestedKeys = [...(catalog.get(clauseKey) ?? [])].sort()
    for (const nestedKey of nestedKeys) visit(nestedKey)
    path.pop()
    active.delete(clauseKey)
    visited.add(clauseKey)
  }

  for (const clauseKey of [...catalog.keys()].sort()) visit(clauseKey)
}
