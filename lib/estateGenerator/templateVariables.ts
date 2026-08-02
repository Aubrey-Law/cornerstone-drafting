import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { repairSplitNunjucksInXml } from '@/lib/estateGenerator/node/templateRenderer'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import { resolveNodeEstateGeneratorRoot } from '@/lib/estateGenerator/node/config'

// ── Token extraction from DOCX templates ──────────────────────────────────────
// Static analysis of the Nunjucks merge fields inside a template: which data
// paths it reads, which clauses it includes, and which loop/set variables are
// template-local. Powers the generated variable catalog, the CI cross-check,
// and custom-template upload reports.

/** Nunjucks keywords, literals, and operators that are not data paths. */
const EXPRESSION_KEYWORDS = new Set([
  'if', 'else', 'elif', 'endif', 'for', 'endfor', 'in', 'not', 'and', 'or', 'is',
  'set', 'endset', 'true', 'false', 'none', 'null', 'True', 'False', 'None',
])

/** Filters and callables that appear in expressions but are not data paths. */
const KNOWN_CALLABLES = new Set([
  'name', 'NAME', 'orMissing', 'optional', 'include_clause',
  // Common nunjucks builtins seen in templates.
  'default', 'length', 'join', 'upper', 'lower', 'title', 'trim', 'first', 'last',
  'capitalize', 'replace', 'safe', 'string', 'int', 'float', 'round', 'abs',
  'defined', 'undefined', 'divisibleby', 'odd', 'even', 'sameas', 'range',
])

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

/** Strip any interior XML tags a token may still carry, then decode entities. */
function cleanToken(raw: string): string {
  return decodeXmlEntities(raw.replace(/<[^>]*>/g, '')).trim()
}

const PATH_RE = /[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+|\[\d+\])*/g
const STRING_LITERAL_RE = /'[^']*'|"[^"]*"/g
const CLAUSE_CALL_RE = /include_clause\(\s*['"]([^'"]+)['"]/g

interface TokenAccumulator {
  variables: Set<string>
  clauses: Set<string>
  localVars: Set<string>
}

function collectPathsFromExpression(expression: string, into: TokenAccumulator): void {
  for (const clauseMatch of expression.matchAll(CLAUSE_CALL_RE)) {
    into.clauses.add(clauseMatch[1])
  }
  const withoutStrings = expression.replace(STRING_LITERAL_RE, ' ')
  for (const match of withoutStrings.matchAll(PATH_RE)) {
    const token = match[0]
    const root = token.split(/[.[]/)[0]
    if (EXPRESSION_KEYWORDS.has(token) || EXPRESSION_KEYWORDS.has(root)) continue
    if (KNOWN_CALLABLES.has(token)) continue
    into.variables.add(token)
  }
}

function collectFromControlTag(rawTag: string, into: TokenAccumulator): void {
  // `{%tr if … %}` / `{%tr for … %}` are table-row control tags; the `tr`
  // prefix is hoisted away before rendering and is not a variable.
  const tag = rawTag.replace(/^\s*tr\b/, '')
  const forMatch = tag.match(/^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)\s+in\s+([\s\S]+)$/)
  if (forMatch) {
    for (const loopVar of forMatch[1].split(',')) into.localVars.add(loopVar.trim())
    collectPathsFromExpression(forMatch[2], into)
    return
  }
  const setMatch = tag.match(/^\s*set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]+)$/)
  if (setMatch) {
    into.localVars.add(setMatch[1])
    collectPathsFromExpression(setMatch[2], into)
    return
  }
  const stripped = tag.replace(/^\s*(if|elif|endif|else|endfor|endset)\b/, '')
  collectPathsFromExpression(stripped, into)
}

export interface TemplateVariableReport {
  /** Data paths the template reads (loop/set locals excluded), sorted. */
  variables: string[]
  /** Clause ids passed to include_clause, sorted. */
  clauses: string[]
  /** Template-local loop/set variable names, sorted. */
  localVariables: string[]
}

/** Extract merge-field usage from a DOCX template buffer. */
export function extractTemplateVariables(templateBuffer: Buffer): TemplateVariableReport {
  const zip = new PizZip(templateBuffer)
  const acc: TokenAccumulator = { variables: new Set(), clauses: new Set(), localVars: new Set() }

  for (const fileName of Object.keys(zip.files)) {
    const file = zip.files[fileName]
    if (file.dir || !fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue
    const xml = repairSplitNunjucksInXml(file.asText())

    for (const match of xml.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      collectPathsFromExpression(cleanToken(match[1]), acc)
    }
    for (const match of xml.matchAll(/\{%([\s\S]*?)%\}/g)) {
      collectFromControlTag(cleanToken(match[1]), acc)
    }
  }

  const localVariables = Array.from(acc.localVars).sort()
  const variables = Array.from(acc.variables)
    .filter(variable => !acc.localVars.has(variable.split(/[.[]/)[0]))
    .sort()
  return { variables, clauses: Array.from(acc.clauses).sort(), localVariables }
}

// ── Known-root allowlist ──────────────────────────────────────────────────────

/**
 * Every top-level name a template may legitimately reference: runtime context
 * keys (computed flags and defaulted blocks), data-dictionary roots, and the
 * roots present in the QA example payloads. `extras` is the attorney-defined
 * namespace; `loop` is the Nunjucks loop helper.
 */
export function knownTemplateRoots(root = resolveNodeEstateGeneratorRoot()): Set<string> {
  // `young_adult` and `summary` are produced by package-data reshaping /
  // generator data but do not appear in an empty context build.
  const roots = new Set<string>(['extras', 'loop', 'young_adult', 'summary'])

  for (const key of Object.keys(buildNodeEstateContext({ data: {}, state: 'MA', root }))) {
    roots.add(key)
  }

  try {
    const dictionary = JSON.parse(
      fs.readFileSync(path.join(root, 'schemas', 'data-dictionary.json'), 'utf8'),
    ) as Record<string, unknown>
    for (const fieldPath of Object.keys(dictionary)) {
      roots.add(fieldPath.split('.')[0].replace(/\[\]$/, ''))
    }
  } catch {
    // Dictionary is optional for root discovery.
  }

  const examplesDir = path.join(root, 'examples')
  if (fs.existsSync(examplesDir)) {
    for (const fileName of fs.readdirSync(examplesDir).filter(name => name.endsWith('.json'))) {
      try {
        const example = JSON.parse(fs.readFileSync(path.join(examplesDir, fileName), 'utf8')) as Record<string, unknown>
        for (const key of Object.keys(example)) roots.add(key)
      } catch {
        // Skip malformed example files.
      }
    }
  }

  return roots
}

/** Clause ids available from the base library plus every state override dir. */
export function knownClauseIds(root = resolveNodeEstateGeneratorRoot()): Set<string> {
  const ids = new Set<string>()
  const clauseDirs = [path.join(root, 'clauses')]
  const statesDir = path.join(root, 'states')
  if (fs.existsSync(statesDir)) {
    for (const state of fs.readdirSync(statesDir)) {
      clauseDirs.push(path.join(statesDir, state, 'clauses'))
    }
  }
  for (const dir of clauseDirs) {
    if (!fs.existsSync(dir)) continue
    for (const fileName of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
      ids.add(fileName.replace(/\.json$/, ''))
    }
  }
  return ids
}

/**
 * Pre-existing dangling references, grandfathered so the catalog check can
 * gate new regressions. Shrink this list — never grow it.
 * - design-summary-detailed.docx references `important_persons`, which nothing
 *   in the generator populates (renders as an empty loop today).
 */
export const BASELINE_UNKNOWN_ROOTS: Record<string, string[]> = {
  'design-summary-detailed.docx': ['important_persons'],
}

export interface TemplateCatalogEntry extends TemplateVariableReport {
  template: string
  unknownRoots: string[]
  unknownClauses: string[]
}

/** Analyze every bundled `templates/*.docx` against the known roots/clauses. */
export function buildTemplateVariableCatalog(root = resolveNodeEstateGeneratorRoot()): TemplateCatalogEntry[] {
  const templatesDir = path.join(root, 'templates')
  const roots = knownTemplateRoots(root)
  const clauseIds = knownClauseIds(root)
  const entries: TemplateCatalogEntry[] = []

  for (const fileName of fs.readdirSync(templatesDir).filter(name => name.endsWith('.docx')).sort()) {
    const report = extractTemplateVariables(fs.readFileSync(path.join(templatesDir, fileName)))
    const unknownRoots = Array.from(
      new Set(
        report.variables
          .map(variable => variable.split(/[.[]/)[0])
          .filter(variableRoot => !roots.has(variableRoot)),
      ),
    ).sort()
    const unknownClauses = report.clauses.filter(clauseId => !clauseIds.has(clauseId)).sort()
    entries.push({ template: fileName, ...report, unknownRoots, unknownClauses })
  }
  return entries
}
