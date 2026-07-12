# Aubrey Estate Skill Creator Design

## Goal

Create a personal Codex skill named `aubrey-estate-skill-creator` that builds or revises one Aubrey Law Massachusetts estate-planning skill at a time. New skills default to `~/.codex/skills/<skill-name>` and must be reviewed and validated before installation.

The creator must coexist with existing estate-planning skills and must not modify Cornerstone drafting internals, invent firm or matter facts, or perform legal research from memory.

## Package Structure

The creator contains:

- `SKILL.md`: the concise creation workflow and resource-routing instructions.
- `agents/openai.yaml`: Codex display metadata and a default prompt that invokes `$aubrey-estate-skill-creator`.
- `references/estate-skill-patterns.md`: patterns for drafting, review and extraction, intake, client communications, execution and signing, and administrative workflows.
- `references/legal-safety.md`: Massachusetts authority, source-date, fact-provenance, uncertainty, and attorney-review requirements.
- `references/review-protocol.md`: the evidence an independent reviewer must receive and the conclusions it may reach.
- `references/aubrey-context-template.md`: an optional firm-context template that is never written or updated silently.

Do not add scripts unless deterministic behavior cannot be provided reliably by the official Codex skill tooling.

## Scope

The first version creates or revises one standalone skill. It may inspect and reference existing skills to avoid duplication, but it does not create orchestrators or automatically chain skills. Orchestration can be added in a later version after the focused creator is proven.

## Creation Workflow

For each requested skill:

1. Identify the repeated task, desired output, triggering language, variable inputs, edge cases, and applicable authority.
2. Inspect existing Aubrey Law skills and decide whether the request requires a new skill, an extension, or composition with an existing skill.
3. Select the closest pattern: drafting, review and extraction, intake, client communication, execution and signing, or administration.
4. Present the proposed name, scope, files, and destination before writing.
5. Establish a realistic baseline test without the proposed guidance.
6. Scaffold the skill with the official Codex initializer and add only required resources.
7. Apply the legal safeguards below.
8. Forward-test the completed skill with sufficient task evidence.
9. Run official structural validation.
10. Install only after validation succeeds and report exactly what was created.

## Legal Safeguards

- Use current Massachusetts primary authority whenever a legal rule affects the output.
- Record the authority and an as-of date.
- Do not treat a citation as proof until the cited source has been checked.
- Distinguish extracted, inferred, calculated, and user-supplied facts.
- Flag ambiguity and missing evidence instead of guessing.
- Require attorney review before filing, signing, sending, or relying on consequential work.
- Never invent client, firm, attorney, matter, testimonial, credential, or contact information.
- Keep analysis anchored to complete source material; summaries are navigation aids, not substitutes.

## Review Protocol

An independent reviewer must receive the output, task requirements, applicable checklist, and the source material necessary to verify factual claims. When the full source is impractical, provide cited excerpts plus an explicit limitation statement.

The reviewer may assess structure and internal consistency without source material, but may not issue an accuracy pass for facts, quotations, citations, dates, calculations, or legal conclusions it cannot verify.

Subagent review is conditional on availability and authorization. If unavailable, perform a clearly labeled self-review and disclose the reduced independence.

## Storage and Mutation Rules

- Default new skills to `~/.codex/skills/<skill-name>`.
- Show the proposed destination before writing.
- Stage and validate in an isolated temporary directory before installation.
- Never write `firm-context.md`, mutable learnings, or other firm data into the active project without explicit approval.
- Never silently update an installed skill after user feedback.
- Do not modify production systems, client records, or Cornerstone drafting code while testing.

## Error Handling

Stop the affected step when primary authority is unavailable, source documents are missing, ambiguity would materially change the result, validation fails, or installation permission is denied. Preserve validated work in the staging area when useful and report the exact unresolved condition. Never claim successful validation or installation when either was skipped.

## Acceptance Criteria

- Metadata triggers for creating or revising Aubrey Law estate-planning skills and not for ordinary drafting or legal questions.
- `SKILL.md` is concise and every linked resource exists.
- `agents/openai.yaml` matches the final skill.
- Official Codex validation passes.
- A baseline test demonstrates the behavior the guidance must improve.
- A forward test demonstrates compliance with the creation workflow and legal safeguards.
- Test artifacts are isolated and removed after evaluation.
- Existing personal skills and repository files remain unchanged except for explicitly approved work.
- Installation occurs only from a validated staged copy.

