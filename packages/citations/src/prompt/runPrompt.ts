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
  findingFor: (unit: Unit, input: Record<string, unknown>) => Finding
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
 * or a throwing `findingFor` each cost only that one unit, never the run.
 * This is what lets forty rules over one document, or forty checks over one
 * design sheet, survive a single bad response instead of losing the whole
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
    let finding: Finding
    try {
      const response = await deps.callModel(seams.requestFor(unit), deps.context)
      input = readToolInput(response, seams.toolName)

      if (!input) {
        failures.push({ unitId, reason: 'Model returned no tool call' })
        continue
      }

      // `findingFor` throws instead of returning a sentinel for input it
      // can't use — an unrecognised outcome, say — because a throw carries
      // its own message and a sentinel doesn't. There is one way a unit
      // fails here and one place its reason comes from: whatever the model
      // call or `findingFor` threw, caught below.
      finding = seams.findingFor(unit, input)
    } catch (error) {
      failures.push({ unitId, reason: (error as Error).message })
      continue
    }

    findings.push(finding)
  }

  return { findings, failures }
}
