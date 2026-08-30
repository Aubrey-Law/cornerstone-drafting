import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { completeLlmText, resolveLlmConfig } from '@/lib/llm'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  buildDesignSheetImportPreview,
  coerceDesignSheetImport,
  getDesignSheetImportTextValidationError,
  listDesignSheetImportFieldNames,
  type DesignSheetImportResult,
} from './shared'

export const DESIGN_SHEET_IMPORT_SYSTEM_PROMPT = `You extract Massachusetts estate-planning design sheet data from attorney-provided notes, questionnaires, emails, or Word-document text.

Output ONLY one JSON object. Do not include markdown, explanation, comments, or additional text.

Use only these known design sheet fields from the shared allowlist:
${listDesignSheetImportFieldNames().join(', ')}

A field name containing a dot is a single JSON key, not a nested object: emit
{"trust_details.co_trustee_decision": "independent"}, never
{"trust_details": {"co_trustee_decision": "independent"}}.

Never invent facts. If a value is unknown, omitted, unclear, or only implied, omit that field entirely. Use ISO dates (YYYY-MM-DD) where possible. Put relevant notes that do not map cleanly to a known field into drafting_notes.`

function parseJsonFromModelText(raw: string): unknown {
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('AI did not return JSON')
  }
  return JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
}

/** Latest version of the matter's design sheet, inflated to the app-side shape. */
export async function loadCurrentDesignSheet(matterId: string) {
  const { data, error } = await getAdminClient()
    .from('design_sheets')
    .select('*')
    .eq('matter_id', matterId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return inflateDesignSheetRow(data as Record<string, unknown> | null)
}

export async function extractDesignSheetDocxText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

export async function parseDesignSheetImportText(args: {
  matterId: string
  text: string
  userId: string
}): Promise<DesignSheetImportResult> {
  const validationError = getDesignSheetImportTextValidationError(args.text)
  if (validationError) throw new Error(validationError)

  const admin = getAdminClient()
  const llmResolved = await resolveLlmConfig(admin, args.userId)
  if (!llmResolved.ok) throw new Error(llmResolved.error)

  const currentSheet = await loadCurrentDesignSheet(args.matterId)
  const response = await completeLlmText(llmResolved.config, {
    system: DESIGN_SHEET_IMPORT_SYSTEM_PROMPT,
    maxTokens: 4000,
    messages: [{
      role: 'user',
      content: `Matter ID: ${args.matterId}

Extract proposed design sheet fields from the untrusted text below.

---BEGIN UNTRUSTED DESIGN SHEET TEXT---
${args.text}
---END UNTRUSTED DESIGN SHEET TEXT---`,
    }],
  })

  const raw = response.text.trim()

  let parsed: unknown
  try {
    parsed = parseJsonFromModelText(raw)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('AI returned invalid JSON')
    throw error
  }

  const { proposed, rejected } = coerceDesignSheetImport(parsed)
  const preview = buildDesignSheetImportPreview({
    currentSheet: currentSheet as Record<string, unknown> | null,
    proposed,
  })

  // Rejections alone are still a result worth returning: the attorney needs to see
  // that the document said something for a field rather than that nothing was found.
  if (preview.length === 0 && rejected.length === 0) {
    throw new Error('No design-sheet fields were found')
  }
  return { proposed, preview, rejected }
}
