# Task 2 Report: Clause contracts and fail-closed validation

Status: COMPLETE

Commit: `c2ffa89 Add estate clause validation contracts`

## Implemented

- Added the exact estate-clause domain contracts requested by the brief:
  `EstateClauseContent`, `PublishedEstateClause`, `EstateClauseSnapshot`,
  `EstateClauseOverride`, `EstateClauseManifestEntry`, and their supporting union types.
- Added canonical SHA-256 content hashing. Hash input normalizes CRLF to LF, sorts and
  deduplicates field/key arrays without mutating the caller, and normalizes an omitted
  condition to `null`.
- Added restricted, fail-closed clause validation:
  - accepts declared dotted variable paths and the filters registered by
    `renderNodeEstateText` (`name`, `NAME`, `orMissing`, and `optional`);
  - accepts only literal `include_clause("stable.key")` nested calls;
  - rejects undeclared fields, invalid field paths, unsupported expressions and filters,
    Nunjucks block tags, Nunjucks comments, malformed template delimiters, duplicate
    required fields, unknown nested keys, and inconsistent nested declarations/includes.
- Added deterministic cycle detection using sorted roots and sorted dependencies. Cycle
  errors include the reproducible path, such as `a -> b -> a`.

## TDD evidence

### Cycle 1: contracts, hashing, placeholders, nesting, and cycles

- RED command: `npx vitest run tests/estate-clause-validation.test.ts`
- RED result: failed at import because `@/lib/estateClauses/validation` did not exist;
  1 failed file and 0 collected tests. This was the expected missing-feature failure.
- GREEN command: `npx vitest run tests/estate-clause-validation.test.ts`
- GREEN result: 1 file passed, 9 tests passed.

### Cycle 2: fail-closed Nunjucks comments

- RED command: `npx vitest run tests/estate-clause-validation.test.ts`
- RED result: 1 of 10 tests failed because `{# hidden instruction #}` was accepted with
  no validation error.
- GREEN command: `npx vitest run tests/estate-clause-validation.test.ts`
- GREEN result: 1 file passed, 10 tests passed.

## Verification

- `npx vitest run tests/estate-clause-validation.test.ts`
  - PASS: 1 file, 10 tests.
- `npx eslint lib/estateClauses/types.ts lib/estateClauses/validation.ts tests/estate-clause-validation.test.ts`
  - PASS: no errors or warnings.
- `git diff --check`
  - PASS.
- `npx vitest run tests/estate-clause-validation.test.ts tests/node-estate-generator.test.ts --reporter=json --outputFile=/tmp/task-2-vitest.json`
  - 100 tests total; 96 passed and 4 failed.
  - All 10 new validation tests passed.
  - The 4 failures are the documented pre-existing Node generator baseline failures:
    parental guardian app-level generation, young-adult app-level generation, DPOA
    payload rendering, and HCP/HIPAA payload rendering.
  - No new renderer-suite failure was added.
- Vitest emitted the existing Node `module.register()` deprecation warning; it is unrelated
  to Task 2.

## Files

- `lib/estateClauses/types.ts`
- `lib/estateClauses/validation.ts`
- `tests/estate-clause-validation.test.ts`

No SQL, generator implementation, admin UI, plan, or specification file was modified by
the implementation commit.

## Self-review

- Re-read the Task 2 brief and checked every requested interface and function against it.
- Compared the validator subset to `renderNodeEstateText`. There is no renderer conflict:
  the renderer remains backward-compatible and broad, while library content is intentionally
  restricted to simple variables, registered filters, and one literal stable-key include.
- Found and fixed a fail-open comment path with a separate RED/GREEN cycle.
- Found and corrected a test-quality issue where the initial CRLF hash fixture contained no
  newline; the final test exercises actual CRLF/LF canonicalization.
- Confirmed hashing and cycle traversal do not mutate caller collections.
- Confirmed cycle paths are deterministic regardless of map insertion or dependency order.
- Confirmed the commit contains exactly the three requested implementation/test files.

## Concerns

- The repository retains the four documented Node generator baseline failures listed above.
- The clause-library validator intentionally rejects the renderer's broader Nunjucks control
  flow and two-argument legacy include form. This is the fail-closed library contract required
  by the brief, not a change to existing renderer behavior.

## Parser review follow-up

### Findings addressed

- Replaced the permissive `orMissing` regular expression and naive `expression.split('|')`
  with a non-executing restricted tokenizer/parser.
- Filter separators are now recognized only outside quoted strings.
- Quoted strings track backslash escapes consistently with the Nunjucks lexer, including
  escaped quote and backslash characters.
- `orMissing` remains valid as a no-argument filter, while its call form accepts exactly one
  single- or double-quoted string argument.
- Unclosed quotes, trailing junk, non-string arguments, and calls to no-argument filters are
  rejected fail closed.

### Follow-up TDD evidence

- RED command: `npx vitest run tests/estate-clause-validation.test.ts`
- RED result: 14 tests ran; 3 failed and 11 passed. The failures proved that a pipe inside an
  `orMissing` label was split as a filter separator, malformed trailing-quote syntax was
  accepted, and unclosed quotes lacked a parser error. The escaped quote/backslash fixture
  was also present and passed under the prior implementation.
- GREEN command: `npx vitest run tests/estate-clause-validation.test.ts`
- GREEN result: 1 file passed, 14 tests passed.

### Follow-up verification

- `npx vitest run tests/estate-clause-validation.test.ts tests/node-estate-generator.test.ts -t "estate clause validation|node estate generator text rendering"`
  - PASS: 2 files, 33 tests passed, 71 unrelated tests skipped.
- `npx eslint lib/estateClauses/types.ts lib/estateClauses/validation.ts tests/estate-clause-validation.test.ts`
  - PASS: no errors or warnings.
- `git diff --check`
  - PASS.
- Baseline comparison run after the parser fix: 104 tests total, 100 passed, and only the
  same 4 documented Node generator baseline failures remained.
- A separate one-off `npx tsx -e` compatibility probe was abandoned after sandbox IPC failed
  with `listen EPERM` and its escalated retry stalled awaiting approval. It made no changes and
  was unnecessary because the focused Vitest renderer tests passed.

### Follow-up self-review

- The tokenizer is linear, local, deterministic, and never evaluates template content.
- Escaped characters are consumed as pairs only while inside a quoted string; an escaped
  closing quote cannot prematurely terminate the string.
- The call parser requires a closing quote, closing parenthesis, and end of input after optional
  whitespace, preventing the prior backreference regex from swallowing trailing junk.
- No SQL, generator implementation, admin UI, plan, or specification file changed.
