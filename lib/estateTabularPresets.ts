/**
 * Estate-specific tabular review column presets (not corporate presets).
 */

export interface TabularColumnConfig {
  index: number
  name: string
  prompt: string
  format?: 'text' | 'yes_no' | 'list'
}

export const ESTATE_TABULAR_PRESETS: Record<string, { label: string; columns: Omit<TabularColumnConfig, 'index'>[] }> = {
  estate_package_review: {
    label: 'Estate package consistency',
    columns: [
      {
        name: 'Document type',
        prompt: 'Identify the estate planning document type (e.g. revocable trust, pour-over will, DPOA, HCP, HIPAA, AHD, PPM).',
        format: 'text',
      },
      {
        name: 'Grantor / client names',
        prompt: 'List the primary grantor or testator full legal name(s) as they appear in the document.',
        format: 'list',
      },
      {
        name: 'Fiduciaries',
        prompt: 'List key fiduciaries (trustee, executor/PR, DPOA agent, HCP surrogate, guardian) with role labels.',
        format: 'list',
      },
      {
        name: 'Residuary / distribution',
        prompt: 'Summarize residuary beneficiaries and any age-based or staggered distribution terms.',
        format: 'text',
      },
      {
        name: 'Unresolved markers',
        prompt: 'List any leftover [TODO:], [[ MISSING ]], template braces, or blank fill-in fields.',
        format: 'list',
      },
      {
        name: 'Signing readiness',
        prompt: 'Is this document ready for client review / signing? Answer Yes/No and note blockers.',
        format: 'yes_no',
      },
    ],
  },
  fiduciary_cross_check: {
    label: 'Fiduciary cross-check',
    columns: [
      {
        name: 'Primary fiduciaries',
        prompt: 'Extract primary trustee/executor/agent names.',
        format: 'list',
      },
      {
        name: 'Successors',
        prompt: 'Extract successor / alternate fidaries.',
        format: 'list',
      },
      {
        name: 'Conflicts / gaps',
        prompt: 'Flag missing successors, same person in conflicting roles without explanation, or co-agent ambiguity.',
        format: 'text',
      },
    ],
  },
}

export function columnsFromPreset(presetKey: string): TabularColumnConfig[] {
  const preset = ESTATE_TABULAR_PRESETS[presetKey]
  if (!preset) return []
  return preset.columns.map((col, index) => ({ ...col, index }))
}

export function defaultEstateColumns(): TabularColumnConfig[] {
  return columnsFromPreset('estate_package_review')
}
