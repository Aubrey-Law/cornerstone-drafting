import type { ModelCaller, ModelCallContext, ModelRequest, ModelResponse } from '../review/model'

/**
 * The three seams a per-unit, forced-tool-use model loop actually has.
 *
 * review/runReview.ts and fieldAudit/runFieldAudit.ts turned out to be the
 * same loop wearing two costumes: call the model once per something, forced
 * into one tool, and turn whatever comes back into a finding or a failure
 * naming that something. Lined up against each other, what varies is only:
 *   - what a "unit" is — a rule checked against a document; a check read
 *     against a design sheet
 *   - what the request for one unit says — the rule's text; the check's
 *     text and its allowed fields
 *   - what a response becomes — a citation-backed finding; a
 *     field-reference-backed finding
 *
 * Verification is deliberately NOT a seam here. `verifyQuote` walks character
 * offsets in a text layer; `verifyFieldReference` walks scalar leaves in a
 * jsonb value — what counts as "the source" and what counts as "found in it"
 * differ so completely between the two that a shared signature covering both
 * would describe neither. It happens inside `findingFor`, where each kind's
 * own notion of evidence already lives, and this loop never needs to know it
 * exists.
 */
export interface PromptSeams<Unit, Finding> {
  units: Unit[]
  requestFor: (unit: Unit) => ModelRequest
  toolName: string
  findingFor: (unit: Unit, input: Record<string, unknown>) => Finding | null
  /** Names a unit for `failures`. Defaults to its index, stringified. */
  idFor?: (unit: Unit, index: number) => string
}

export interface RunPromptDependencies {
  callModel: ModelCaller
  context: ModelCallContext
}

export interface PromptRunResult<Finding> {
  findings: Finding[]
  failures: Array<{ unitId: string; reason: string }>
}

function readToolInput(response: ModelResponse, toolName: string): Record<string, unknown> | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === toolName) {
      return block.input as Record<string, unknown>
    }
  }
  return null
}

/**
 * Runs one model call per unit and turns each response into a finding or a
 * failure naming the unit — the loop `runReviewPlaybook` and `runFieldAudit`
 * both reduce to.
 *
 * Fail-soft per unit, unconditionally: a throwing call, a missing tool call,
 * or `findingFor` rejecting the input each cost only that one unit, never the
 * run. This is what lets forty rules over one document, or forty checks over
 * one design sheet, survive a single bad response instead of losing the whole
 * pass to it.
 */
export async function runPrompt<Unit, Finding>(
  seams: PromptSeams<Unit, Finding>,
  deps: RunPromptDependencies,
): Promise<PromptRunResult<Finding>> {
  const findings: Finding[] = []
  const failures: PromptRunResult<Finding>['failures'] = []

  for (let index = 0; index < seams.units.length; index++) {
    const unit = seams.units[index]
    const unitId = seams.idFor ? seams.idFor(unit, index) : String(index)

    let input: Record<string, unknown> | null
    try {
      const response = await deps.callModel(seams.requestFor(unit), deps.context)
      input = readToolInput(response, seams.toolName)
    } catch (error) {
      failures.push({ unitId, reason: (error as Error).message })
      continue
    }

    if (!input) {
      failures.push({ unitId, reason: 'Model returned no tool call' })
      continue
    }

    const finding = seams.findingFor(unit, input)
    if (finding === null) {
      // `findingFor`'s own reason for rejecting the input (an unrecognised
      // outcome, say) does not travel through this generic path — its
      // signature returns Finding | null, not a diagnosis, because a shared
      // failure-reason vocabulary is itself something the two kinds do not
      // actually share. Each adapter is free to fail loudly with a thrown
      // error instead, from inside requestFor or findingFor, whenever it
      // wants a specific reason recorded here.
      failures.push({ unitId, reason: 'Model input did not produce a finding' })
      continue
    }

    findings.push(finding)
  }

  return { findings, failures }
}
