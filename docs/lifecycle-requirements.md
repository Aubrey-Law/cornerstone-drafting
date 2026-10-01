# Lifecycle requirement registry

`lib/lifecycle/registry.ts` is the version-controlled source of requirement metadata for operational readiness. The first complete registry covers estate-planning leads and matters. It declares, for every requirement:

- record type and lifecycle stages;
- practice-area applicability and conditional applicability;
- source and confirmation level;
- severity, owner, and resolution type; and
- the forward matter stages it blocks.

Pure evaluation lives in `lib/lifecycle/lead.ts` and `lib/lifecycle/matter.ts`. Server-side loading of matter evidence lives in `lib/lifecycle/server.ts`. Drafting remains authoritative for design-sheet content; lifecycle code reads its public status and review flags without changing drafting internals.

## Shared consumers

- Lead readiness and lead operational brief
- Matter next action and matter operational brief
- Daily Command Center lead and matter actions
- Matter stage-transition preflight
- Assistant `read_matter_record` lifecycle section

The compatibility barrel at `lib/lifecycle/requirements.ts` is the staged migration path for Phase 0 imports. New code should import a focused lifecycle module directly. Remove the barrel only after all consumers have migrated.

## Fact confirmation

Values extracted from documents or communications are suggestions. Use the helpers in `lib/lifecycle/factEvidence.ts`; a suggested value cannot satisfy a requirement until an identified user explicitly confirms it. Client-submitted, recorded system, and attorney-confirmed values retain their declared source.

## Adding a practice area

Add a separately versioned registry rather than weakening estate-planning requirements. Reuse generic intake and communication checks where their meaning is identical, but give practice-specific legal judgments distinct keys. Add parity tests proving the record page, Today, stage preflight, and Assistant select the same next action and blockers.
