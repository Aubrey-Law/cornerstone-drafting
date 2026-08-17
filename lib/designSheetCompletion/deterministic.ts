/**
 * Everything a completion pass can answer without a model.
 *
 * Runs first, for three reasons: these answers are exact where a model's are
 * probabilistic, they cost nothing, and every field resolved here is one fewer
 * field in the prompt — which is what keeps a ~200-field sheet inside a set of
 * prompts small enough to stay accurate.
 *
 * Returns a patch, never a write. The caller decides whether it goes into the
 * review diff (autofill) or is applied directly (the section "fill with firm
 * defaults" action).
 */
import { computeDesignSheetDefaults } from '@/lib/designSheetDefaults'
import {
  applyAttorneyPreset,
  buildCopyClientToSpousePatch,
  type AttorneyDesignPreset,
} from '@/lib/designSheet/fastEntryWorkflow'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet, PipelineMatter } from '@/types/database'

export interface DeterministicResolution {
  patch: Partial<DesignSheet>
  /** Field → why it was filled, for the review row's provenance. */
  sources: Record<string, string>
}

export function resolveWithoutAi(args: {
  sheet: DesignSheet
  matter: Pick<PipelineMatter, 'client_name' | 'spouse_name'>
  attorneyPreset?: AttorneyDesignPreset | null
}): DeterministicResolution {
  const { sheet, matter, attorneyPreset } = args
  const patch: Partial<DesignSheet> = {}
  const sources: Record<string, string> = {}

  const record = (source: string, contribution: Partial<DesignSheet>) => {
    for (const [field, value] of Object.entries(contribution)) {
      // First writer wins: computed defaults are derived from the sheet itself and
      // are the most specific, the preset is a firm-wide habit, and the spouse
      // mirror is the broadest. Later passes must not overwrite earlier ones.
      if (field in patch) continue
      const current = (sheet as unknown as Record<string, unknown>)[field]
      if (current !== null && current !== undefined && current !== '') continue
      ;(patch as Record<string, unknown>)[field] = value
      sources[field] = source
    }
  }

  record('computed from the sheet', computeDesignSheetDefaults(sheet, matter))

  if (attorneyPreset) {
    // Never overwrite here: a preset is a default, and the attorney's own
    // dialog already owns the deliberate "replace what is there" path.
    record('your saved standards', applyAttorneyPreset(sheet, attorneyPreset, { overwrite: false }))
  }

  if (getDocumentInclusions(sheet).spouse_docs) {
    record('mirrored from the client', buildCopyClientToSpousePatch(sheet))
  }

  return { patch, sources }
}
