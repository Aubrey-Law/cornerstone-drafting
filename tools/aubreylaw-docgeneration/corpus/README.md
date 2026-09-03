# Golden-document corpus

Every package rendered from its example payload, fingerprinted by content, with
the attorney's approval recorded alongside. This is scope-reduction task 8.5.2 —
"templates versioned atomically with their expected output".

## Commands

| | |
|---|---|
| `npm run corpus:check` | Regenerate everything and compare to `manifest.json`. What CI runs. |
| `npm run corpus:update -- --reason "…"` | Rewrite the manifest. The reason is required; it is the record of why output changed. |
| `npm run corpus:list` | What is approved and what is not. |

## What the gate actually enforces

`corpus:check` sorts drift into two kinds and treats them differently:

- **An approved document changed** — output a person signed off on is now
  different. This **fails**, because it is the case worth stopping for.
- **An unreviewed document changed** — reported, does not fail. Most drafting
  work changes unreviewed output on purpose, and blocking on that would train
  everyone to run `corpus:update` reflexively, which is how a gate stops
  meaning anything.

## Approvals belong to bytes, not to documents

When a document's content changes, its approval is **cleared** rather than
carried forward, and `corpus:update` says how many it cleared. An approval that
survived an edit would assert that an attorney reviewed text they never saw.

## Recording an approval

Review the rendered document, then set its entry in `manifest.json`:

```json
"approval": { "status": "approved", "by": "Scott Aubrey", "at": "2026-09-03", "note": "optional" }
```

Render a package to look at it with
`npm run estate:render -- --package <name> --out /tmp/review`.

## Why content hashing, not file hashing

A DOCX is a zip and each entry carries a modification timestamp, so two renders
of identical input produce different bytes seconds apart. An early attempt at a
byte-level gate passed only because both renders landed inside one timestamp
granularity — a false green that would have hidden real changes. The manifest
hashes every entry's name and decompressed bytes instead, ignoring zip metadata.
`lib/drafting/documentContentHash.ts`, and `tests/golden-corpus.test.ts` pins the
property.

## What this does not cover

Packages with no example payload are skipped — `corpus:update` names them. And
the corpus renders from **bundled** templates, never the database, so it
fingerprints what the repository produces. A published template override is
deliberately outside its scope.
