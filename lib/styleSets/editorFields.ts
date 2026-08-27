import {
  ALIGNMENTS,
  NUMBERING_FORMATS,
  ORIENTATIONS,
  PAPER_SIZES,
  PRESERVE,
  type StyleSetSettings,
} from '@/lib/styleSets/schema'

/**
 * The style set editor, described as data.
 *
 * The form is generated from this list rather than hand-written, because the
 * schema has around thirty fields whose controls differ only in type and units.
 * Spelling each one out as JSX would be six hundred lines in which a field
 * quietly bound to the wrong path is invisible; here the binding is the datum.
 *
 * Every control has a third state beyond its value and its empty string:
 * `'preserve'`, meaning "leave whatever the uploaded template already had".
 * That is the schema's central idea, so the editor makes it the *default* and
 * always the first option, never a checkbox tucked beside the input.
 */

export type FieldKind =
  | { type: 'text'; placeholder?: string }
  | { type: 'number'; unit: string; min?: number; max?: number; step?: number }
  | { type: 'boolean'; onLabel: string; offLabel: string }
  | { type: 'enum'; options: readonly string[]; labels: Record<string, string> }

export interface StyleSetField {
  /** Dotted path into StyleSetSettings, e.g. `body.fontSizePt`. */
  path: string
  label: string
  hint?: string
  kind: FieldKind
}

export interface StyleSetFieldGroup {
  key: string
  title: string
  description: string
  fields: StyleSetField[]
}

const ALIGNMENT_LABELS: Record<string, string> = {
  left: 'Left',
  center: 'Centred',
  right: 'Right',
  justify: 'Justified',
}

/** Named by what they look like on the page, not by their OOXML enum. */
const NUMBERING_LABELS: Record<string, string> = {
  hierarchicalDecimal: '1. / 1.1 / 1.1.1',
  lowerLetterParenthetical: '(a) (b) (c)',
  lowerRomanParenthetical: '(i) (ii) (iii)',
  upperLetterParenthetical: '(A) (B) (C)',
  upperRoman: 'I. II. III.',
}

const PAPER_LABELS: Record<string, string> = {
  letter: 'Letter (8.5 × 11 in)',
  legal: 'Legal (8.5 × 14 in)',
  a4: 'A4 (210 × 297 mm)',
}

const ORIENTATION_LABELS: Record<string, string> = {
  portrait: 'Portrait',
  landscape: 'Landscape',
}

function runFields(prefix: string, includeBold: boolean): StyleSetField[] {
  return [
    { path: `${prefix}.fontFamily`, label: 'Font', kind: { type: 'text', placeholder: 'Garamond' } },
    { path: `${prefix}.fontSizePt`, label: 'Size', kind: { type: 'number', unit: 'pt', min: 1, max: 400, step: 0.5 } },
    ...(includeBold
      ? [{
          path: `${prefix}.bold`,
          label: 'Bold',
          kind: { type: 'boolean' as const, onLabel: 'Bold', offLabel: 'Not bold' },
        }]
      : []),
  ]
}

function paragraphFields(prefix: string): StyleSetField[] {
  return [
    {
      path: `${prefix}.alignment`,
      label: 'Alignment',
      kind: { type: 'enum', options: ALIGNMENTS, labels: ALIGNMENT_LABELS },
    },
    { path: `${prefix}.spaceBeforePt`, label: 'Space before', kind: { type: 'number', unit: 'pt', min: 0, step: 1 } },
    { path: `${prefix}.spaceAfterPt`, label: 'Space after', kind: { type: 'number', unit: 'pt', min: 0, step: 1 } },
  ]
}

function levelGroup(index: 1 | 2 | 3, title: string, description: string): StyleSetFieldGroup {
  const prefix = `level${index}`
  return {
    key: prefix,
    title,
    description,
    fields: [
      {
        path: `${prefix}.numberingFormat`,
        label: 'Numbering',
        kind: { type: 'enum', options: NUMBERING_FORMATS, labels: NUMBERING_LABELS },
      },
      {
        path: `${prefix}.indentLeftPt`,
        label: 'Indent',
        hint: '72pt is one inch, so a quarter-inch indent is 18.',
        kind: { type: 'number', unit: 'pt', min: -2000, max: 2000, step: 1 },
      },
      {
        path: `${prefix}.hangingPt`,
        label: 'Hanging',
        hint: 'How far the number sits left of its text. Zero puts them on the same edge.',
        kind: { type: 'number', unit: 'pt', min: 0, step: 1 },
      },
      ...runFields(prefix, false),
    ],
  }
}

export const STYLE_SET_FIELD_GROUPS: StyleSetFieldGroup[] = [
  {
    key: 'body',
    title: 'Body text',
    description: 'Applied to the document defaults and to the Normal style, which is what body paragraphs carry.',
    fields: [
      ...runFields('body', true),
      ...paragraphFields('body'),
      {
        path: 'body.lineSpacing',
        label: 'Line spacing',
        hint: '1 is single, 2 is double.',
        kind: { type: 'number', unit: '×', min: 0.25, max: 10, step: 0.05 },
      },
    ],
  },
  {
    key: 'title',
    title: 'Titles',
    description:
      'Applied to every title-family style, including Heading 1 where a template reuses it for document titles. A style already smaller than this size is left alone.',
    fields: [...runFields('title', true), ...paragraphFields('title')],
  },
  levelGroup(1, 'First-level list', 'The outermost numbered level, usually Articles.'),
  levelGroup(2, 'Second-level list', 'Sections beneath an Article.'),
  levelGroup(3, 'Third-level list', 'The lettered subsections — (a), (b), (c).'),
  {
    key: 'numbering',
    title: 'Numbering',
    description: 'Switching this off removes the numbers from the three levels above.',
    fields: [
      {
        path: 'numbering.enabled',
        label: 'List numbering',
        kind: { type: 'boolean', onLabel: 'Numbered', offLabel: 'No numbers' },
      },
    ],
  },
  {
    key: 'page',
    title: 'Page',
    description: 'Applied to every section in the document, including mid-document section breaks.',
    fields: [
      {
        path: 'page.paperSize',
        label: 'Paper',
        kind: { type: 'enum', options: PAPER_SIZES, labels: PAPER_LABELS },
      },
      {
        path: 'page.orientation',
        label: 'Orientation',
        kind: { type: 'enum', options: ORIENTATIONS, labels: ORIENTATION_LABELS },
      },
      { path: 'page.margins.topPt', label: 'Top margin', kind: { type: 'number', unit: 'pt', min: 0, step: 1 } },
      { path: 'page.margins.rightPt', label: 'Right margin', kind: { type: 'number', unit: 'pt', min: 0, step: 1 } },
      { path: 'page.margins.bottomPt', label: 'Bottom margin', kind: { type: 'number', unit: 'pt', min: 0, step: 1 } },
      { path: 'page.margins.leftPt', label: 'Left margin', kind: { type: 'number', unit: 'pt', min: 0, step: 1 } },
    ],
  },
]

/** Read a dotted path out of a settings object. */
export function readField(settings: StyleSetSettings, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key]
    return undefined
  }, settings)
}

/**
 * Write a dotted path, returning a new settings object.
 *
 * Copies each level on the way down rather than mutating, so React sees a
 * changed reference and the caller's previous value stays intact for a cancel.
 */
export function writeField(
  settings: StyleSetSettings,
  path: string,
  value: unknown,
): StyleSetSettings {
  const keys = path.split('.')
  const next = { ...settings } as Record<string, unknown>
  let cursor = next

  for (const key of keys.slice(0, -1)) {
    cursor[key] = { ...(cursor[key] as Record<string, unknown>) }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
  return next as StyleSetSettings
}

/** How many fields state a value rather than preserving the template's. */
export function countOverrides(settings: StyleSetSettings): number {
  return STYLE_SET_FIELD_GROUPS.flatMap(group => group.fields).filter(
    field => readField(settings, field.path) !== PRESERVE,
  ).length
}

/** A one-line summary of a style set for the list, or null when it changes nothing. */
export function describeStyleSet(settings: StyleSetSettings): string | null {
  const parts: string[] = []
  if (settings.body.fontFamily !== PRESERVE) parts.push(String(settings.body.fontFamily))
  if (settings.body.fontSizePt !== PRESERVE) parts.push(`${settings.body.fontSizePt}pt`)
  if (settings.title.fontSizePt !== PRESERVE) parts.push(`${settings.title.fontSizePt}pt titles`)

  const total = countOverrides(settings)
  if (total === 0) return null

  const remainder = total - parts.length
  if (remainder > 0) parts.push(`${remainder} more setting${remainder === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
