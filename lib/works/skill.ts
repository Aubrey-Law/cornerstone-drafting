export type WorkSkillType = 'assistant' | 'tabular'
export type WorkExecutionMode = 'chat' | 'run'
export type WorkAllowedContext = 'matter' | 'documents' | 'intake' | 'design_sheet'

export interface WorkTableColumn {
  index: number
  name: string
  prompt: string
  format?: string
}

export interface WorkSkillMetadata {
  name: string
  description: string
  version: string
  type: WorkSkillType
  execution_mode: WorkExecutionMode
  practice: string | null
  jurisdictions: string[]
  allowed_context: WorkAllowedContext[]
  columns_config?: WorkTableColumn[]
}

export interface ParsedSkillMarkdown {
  metadata: WorkSkillMetadata
  body: string
  source: string
}

const REQUIRED = ['name', 'description', 'version', 'type', 'execution_mode'] as const

function unquote(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseValue(value: string) {
  const normalized = unquote(value)
  if (normalized === 'null' || normalized === '') return null
  return normalized
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const values: Record<string, unknown> = {}
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/)
    if (!match) throw new Error(`Invalid frontmatter line ${i + 1}`)
    const key = match[1]
    const value = match[2] ?? ''
    if (value === '') {
      const items: string[] = []
      let cursor = i + 1
      while (cursor < lines.length) {
        const item = lines[cursor].match(/^\s+-\s*(.*)$/)
        if (!item) break
        items.push(String(parseValue(item[1]) ?? ''))
        cursor += 1
      }
      if (items.length > 0) {
        values[key] = items
        i = cursor - 1
      } else {
        values[key] = null
      }
    } else {
      values[key] = parseValue(value)
    }
  }
  return values
}

function asString(value: unknown, key: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function asStringArray(value: unknown, key: string, fallback: string[] = []) {
  if (value === null || value === undefined) return fallback
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${key} must be a list of strings`)
  }
  return value.map(item => item.trim())
}

export function parseSkillMarkdown(source: string): ParsedSkillMarkdown {
  const normalized = source.replace(/\r\n/g, '\n').trim()
  if (!normalized.startsWith('---\n')) throw new Error('SKILL.md must start with frontmatter')
  const close = normalized.indexOf('\n---', 4)
  if (close < 0) throw new Error('SKILL.md frontmatter is not closed')
  const metadataRaw = normalized.slice(4, close)
  const body = normalized.slice(close + 4).replace(/^\n/, '').trim()
  const values = parseFrontmatter(metadataRaw)
  for (const key of REQUIRED) asString(values[key], key)
  const type = asString(values.type, 'type')
  const executionMode = asString(values.execution_mode, 'execution_mode')
  if (type !== 'assistant' && type !== 'tabular') throw new Error('type must be assistant or tabular')
  if (executionMode !== 'chat' && executionMode !== 'run') throw new Error('execution_mode must be chat or run')
  let columnsConfig: WorkTableColumn[] | undefined
  if (values.columns_config !== null && values.columns_config !== undefined) {
    if (typeof values.columns_config !== 'string') throw new Error('columns_config must be JSON')
    try {
      const parsed = JSON.parse(values.columns_config) as unknown
      if (!Array.isArray(parsed) || parsed.some(column => !column || typeof column !== 'object')) throw new Error()
      columnsConfig = parsed as WorkTableColumn[]
      if (columnsConfig.some(column => !Number.isInteger(column.index) || typeof column.name !== 'string' || typeof column.prompt !== 'string')) throw new Error()
    } catch {
      throw new Error('columns_config must be a JSON list of {index,name,prompt} objects')
    }
  }
  return {
    source: normalized,
    body,
    metadata: {
      name: asString(values.name, 'name'),
      description: asString(values.description, 'description'),
      version: asString(values.version, 'version'),
      type,
      execution_mode: executionMode,
      practice: values.practice === null || values.practice === undefined ? null : asString(values.practice, 'practice'),
      jurisdictions: asStringArray(values.jurisdictions, 'jurisdictions', ['General']),
      allowed_context: asStringArray(values.allowed_context, 'allowed_context', ['matter', 'documents']),
      ...(columnsConfig ? { columns_config: columnsConfig } : {}),
    },
  }
}

function yamlScalar(value: string | null) {
  if (value === null) return 'null'
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return value
  return JSON.stringify(value)
}

export function serializeSkillMarkdown(metadata: WorkSkillMetadata, body: string) {
  const lines = [
    '---',
    `name: ${yamlScalar(metadata.name)}`,
    `description: ${yamlScalar(metadata.description)}`,
    `version: ${yamlScalar(metadata.version)}`,
    `type: ${metadata.type}`,
    `execution_mode: ${metadata.execution_mode}`,
    `practice: ${yamlScalar(metadata.practice)}`,
    'jurisdictions:',
    ...metadata.jurisdictions.map(value => `  - ${yamlScalar(value)}`),
    'allowed_context:',
    ...metadata.allowed_context.map(value => `  - ${yamlScalar(value)}`),
    ...(metadata.columns_config ? [`columns_config: ${JSON.stringify(metadata.columns_config)}`] : []),
    '---',
    '',
    body.trim(),
  ]
  return `${lines.join('\n')}\n`
}
