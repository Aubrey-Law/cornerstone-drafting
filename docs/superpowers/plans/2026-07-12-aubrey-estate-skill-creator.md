# Aubrey Estate Skill Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and install a validated personal Codex skill that builds one Aubrey Law Massachusetts estate-planning skill at a time.

**Architecture:** Establish a clean-context behavioral baseline, build the skill in an isolated staging directory with the official Codex initializer, then forward-test and validate before copying it into `~/.codex/skills`. Keep legal patterns, legal-safety rules, reviewer evidence requirements, and optional firm context in separate one-level references routed directly from `SKILL.md`.

**Tech Stack:** Codex skills (`SKILL.md`, `agents/openai.yaml`), Markdown references, official `init_skill.py` and `quick_validate.py`, clean-context subagent evaluation.

## Global Constraints

- Build or revise one standalone Aubrey Law Massachusetts estate-planning skill at a time.
- Default created skills to `~/.codex/skills/<skill-name>` and show the destination before writing.
- Never modify Cornerstone drafting internals, production systems, client records, or existing personal skills during testing.
- Use current Massachusetts primary authority whenever a legal rule affects output; record the authority and as-of date.
- Never treat a citation as proof without checking the cited source.
- Distinguish extracted, inferred, calculated, and user-supplied facts.
- Require attorney review before filing, signing, sending, or relying on consequential work.
- Never invent firm, attorney, client, matter, testimonial, credential, or contact information.
- Do not silently create firm context or mutable learnings.
- Install only after the staged skill passes structural and behavioral validation.

---

### Task 1: Establish the Behavioral Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-12-aubrey-estate-skill-creator-design.md`
- Create temporarily: `/tmp/aubrey-estate-skill-creator-eval/baseline.md`

**Interfaces:**
- Consumes: the approved design and a realistic request to create a Massachusetts estate-planning skill.
- Produces: a baseline record listing omissions or unsafe assumptions that the new skill must correct.

- [ ] **Step 1: Prepare an isolated evaluation directory**

Run: `mkdir -p /tmp/aubrey-estate-skill-creator-eval`

Expected: the directory exists and contains no installed skill copy.

- [ ] **Step 2: Run a clean-context baseline scenario without the proposed skill**

Dispatch a fresh subagent with this task and no proposed skill content:

```text
Create a reusable Codex skill for Aubrey Law that reviews a Massachusetts revocable trust questionnaire, identifies missing information, and prepares a structured attorney review report. The skill should be ready to install when you finish. Do not modify the active repository or any existing personal skill.
```

Expected: the response exhibits at least one target gap, such as missing authoritative-source controls, unsafe installation behavior, inadequate fact provenance, missing reviewer evidence, or no official Codex validation.

- [ ] **Step 3: Record the observed baseline behavior**

Write `/tmp/aubrey-estate-skill-creator-eval/baseline.md` with:

```markdown
# Baseline Evaluation

## Scenario
[Exact prompt]

## Observed Behavior
- [Concrete action or omission]

## Requirements the New Skill Must Add
- [Mapped requirement from the approved design]
```

- [ ] **Step 4: Review the baseline against the design**

Expected: every recorded requirement is present in the approved design; do not expand scope to unrelated legal drafting behavior.

---

### Task 2: Scaffold and Author the Staged Skill

**Files:**
- Create: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/SKILL.md`
- Create: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/agents/openai.yaml`
- Create: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/references/estate-skill-patterns.md`
- Create: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/references/legal-safety.md`
- Create: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/references/review-protocol.md`
- Create: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/references/aubrey-context-template.md`

**Interfaces:**
- Consumes: the approved design, baseline gaps, official Codex skill initializer, and existing skill names discovered in `~/.codex/skills` and `~/.agents/skills`.
- Produces: a complete staged skill folder named `aubrey-estate-skill-creator`.

- [ ] **Step 1: Initialize the staged skill with official tooling**

Run:

```bash
python3 /Users/scottaubrey/.codex/skills/.system/skill-creator/scripts/init_skill.py aubrey-estate-skill-creator \
  --path /tmp/aubrey-estate-skill-creator-stage \
  --resources references \
  --interface display_name="Aubrey Estate Skill Creator" \
  --interface short_description="Create safe estate-planning skills" \
  --interface default_prompt="Use $aubrey-estate-skill-creator to create a Codex skill for a repeated Aubrey Law estate-planning workflow."
```

Expected: initializer reports creation of `SKILL.md`, `agents/openai.yaml`, and `references/`.

- [ ] **Step 2: Replace the generated `SKILL.md`**

Write a concise imperative workflow with this frontmatter:

```yaml
---
name: aubrey-estate-skill-creator
description: Use when creating or revising a reusable Codex skill for Aubrey Law Massachusetts estate-planning work, including trusts, incapacity documents, intake, review, execution, client communications, or administration.
---
```

The body must route directly to all four references and require: existing-skill inspection; one-at-a-time scope; proposed name, file set, and destination approval; baseline testing; official initialization; source and fact-provenance safeguards; forward testing; official validation; and validated installation. It must state explicit non-triggers for performing ordinary legal work or modifying Cornerstone drafting internals.

- [ ] **Step 3: Author `estate-skill-patterns.md`**

Define six selection patterns with inputs, outputs, and special gates:

```text
Drafting; review and extraction; intake; client communication; execution and signing; administration.
```

Require each generated skill to have one primary outcome, to compose with existing skills when appropriate, and to keep full-source analysis separate from summaries.

- [ ] **Step 4: Author `legal-safety.md`**

Include exact contracts for:

```text
AUTHORITY: primary source, URL or document identifier, proposition supported, checked date, effective date if available.
FACT PROVENANCE: USER-SUPPLIED, EXTRACTED, INFERRED, CALCULATED, or UNRESOLVED.
CONSEQUENTIAL ACTION: pause for attorney approval before filing, signing, sending, or reliance.
```

Require current primary authority for legal propositions, source checking before reliance, uncertainty over guessing, and no invented identities or firm facts.

- [ ] **Step 5: Author `review-protocol.md`**

Require reviewers to receive the task, output, checklist, and verifying sources. State that source-free review can assess structure and internal consistency but cannot pass factual, citation, calculation, quotation, or legal accuracy. Provide a fallback labeled `SELF-REVIEW — INDEPENDENCE LIMITED` when subagents are unavailable.

- [ ] **Step 6: Author `aubrey-context-template.md`**

Provide optional blank fields for practice scope, jurisdiction, formatting conventions, approved sources, review preferences, and prohibited assumptions. State that the creator must ask before saving the completed context and must never place it in an active project by default.

- [ ] **Step 7: Check content integrity**

Run:

```bash
rg -n 'TODO|TBD|Claude|AskUserInput|claude\.md|trust(ed)? with normal review' /tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator
```

Expected: no matches.

Run:

```bash
find /tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator -maxdepth 2 -type f -print | sort
```

Expected: exactly the six planned files.

---

### Task 3: Forward-Test, Validate, and Install

**Files:**
- Read: `/tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/**`
- Create temporarily: `/tmp/aubrey-estate-skill-creator-eval/forward-test.md`
- Create after validation: `~/.codex/skills/aubrey-estate-skill-creator/**`

**Interfaces:**
- Consumes: the staged skill and the same scenario used in Task 1.
- Produces: evaluation evidence, a structurally valid installed skill, and a precise delivery summary.

- [ ] **Step 1: Run the same scenario with the staged skill**

Dispatch a fresh subagent with:

```text
Use $aubrey-estate-skill-creator at /tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator to create a reusable Codex skill for Aubrey Law that reviews a Massachusetts revocable trust questionnaire, identifies missing information, and prepares a structured attorney review report. Do not modify the active repository, production systems, or existing personal skills. Work only in a new temporary directory and report the proposed install destination without installing.
```

Expected: the agent inspects existing skills, narrows the outcome, proposes the file set and destination before writing, applies authority and provenance requirements, creates isolated artifacts, and validates rather than claiming unsupported completion.

- [ ] **Step 2: Record and compare the forward test**

Write `/tmp/aubrey-estate-skill-creator-eval/forward-test.md` with pass or fail for each acceptance criterion and compare it with `baseline.md`. If a criterion fails, revise the minimum relevant skill text and rerun the forward test with a fresh subagent.

- [ ] **Step 3: Run official structural validation**

Run:

```bash
python3 /Users/scottaubrey/.codex/skills/.system/skill-creator/scripts/quick_validate.py /tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator
```

Expected: `Skill is valid!`. If PyYAML is unavailable, install it only into an isolated temporary Python target and rerun the official validator with that target on `PYTHONPATH`.

- [ ] **Step 4: Verify interface metadata**

Run:

```bash
sed -n '1,120p' /tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator/agents/openai.yaml
```

Expected: display name, 25-64 character short description, and a default prompt explicitly containing `$aubrey-estate-skill-creator`.

- [ ] **Step 5: Install the validated staged folder**

Copy the complete staged folder to `~/.codex/skills/aubrey-estate-skill-creator` only after confirming that destination does not already exist. Writing outside the workspace requires user approval through the sandbox permission mechanism.

Expected: installed files are byte-identical to the validated staged copy.

- [ ] **Step 6: Verify installation without mutation**

Run:

```bash
diff -ru /tmp/aubrey-estate-skill-creator-stage/aubrey-estate-skill-creator ~/.codex/skills/aubrey-estate-skill-creator
```

Expected: no output and exit status 0.

- [ ] **Step 7: Clean temporary generated test skills**

Remove only the temporary generated-skill artifacts created during forward testing. Retain `baseline.md` and `forward-test.md` until delivery is complete, then remove the evaluation and staging directories.

- [ ] **Step 8: Deliver the result**

Report the installed path, validation result, forward-test result, exact files installed, and any limitation. Do not claim that the skill performed substantive legal work; its verified function is creating safer Codex skills for that work.

