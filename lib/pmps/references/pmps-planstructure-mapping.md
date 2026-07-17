# pmps-prep — planStructure Mapping Reference

How each `plan.planStructure` value toggles flags, tax logic, documents, and proposal/worksheet sections. Add to the skill's `references/` folder.

> **All tax figures produced by the skill are estimates pending attorney verification against the M-706 process.** This table describes *structure*, not final numbers.

## 1. Flag matrix

| Flag (`plan.*`) | joint_outright | joint_disclaimer | separate_clayton | individual_single |
|---|---|---|---|---|
| `clients.type` | couple | couple | couple | individual |
| `hasTrust` | true | true | true | true |
| `hasCreditShelter` | **false** | true | true | **false** |
| `clayton` | false | false | **true** | false |
| `maQtip` | false | true | **true** | false |
| Number of trusts | 1 joint | 1 joint | **2 (one per spouse)** | 1 individual |
| `clients.spouse2` | object | object | object | **null** |
| `fiduciaries.spouse2` | object | object | object | **null** |

## 2. Tax computation

| | joint_outright | joint_disclaimer | separate_clayton | individual_single |
|---|---|---|---|---|
| `scenario1` (live/baseline) | Full estate taxed at 2nd death; one exemption used | Without planning (no disclaimer) = full estate at 2nd death | Without planning = full estate at 2nd death | Tax at the individual's death |
| `scenario2` | **null** | With disclaimer: 2nd-death taxable = gross − **$4,000,000** | With CS + Clayton: 2nd-death taxable = gross − **$4,000,000** | **null** |
| `savings` | 0 | scenario1 − scenario2 | scenario1 − scenario2 | 0 |
| Sheltered amount | $0 | **$4M** (both $2M) | **$4M** (both $2M) | one $2M exemption |
| Comparison columns shown | No (baseline only) | Yes | Yes | No (single column) |

**Bug fix to enforce:** the "with planning" scenario must reduce the second-death taxable estate by **$4,000,000**, not $2,000,000 — and the rendered table must match the narrative.

## 3. Recommended-document differences

| | joint_outright | joint_disclaimer | separate_clayton | individual_single |
|---|---|---|---|---|
| Trust document(s) | 1 Joint RLT (`joint: true`) | 1 Joint RLT w/ disclaimer provisions | **2 RLTs** (`forSpouse: 1` / `forSpouse: 2`) | 1 RLT (no per-spouse flags) |
| Certificate of Trust | 1 joint | 1 joint | **per spouse** | 1 |
| Per-spouse docs (Will, DPOA, HCP, HIPAA, Living Will, APP) | `perSpouse: true` | `perSpouse: true` | `perSpouse: true` | single copy (no flag) |
| Guardian docs | if minor children | if minor children | if minor children | only if minor children |

## 4. Proposal / worksheet section behavior

| Section | joint_outright | joint_disclaimer | separate_clayton | individual_single |
|---|---|---|---|---|
| Exec summary framing | Minimal planning; quantify lost exemption | Flexible single trust; disclaimer-dependent | Premium; fiduciary-controlled, both exemptions | Single-client; no spouse/2nd-death refs |
| MA tax section | Portability gap; one exemption | + state-only QTIP note | + state-only QTIP note | Threshold-monitoring only |
| Clayton/QTIP subsection | omit | brief (disclaimer route) | **full** | omit |
| *Shaffer* election note | omit | brief | **full** (proposal) + fuller (worksheet) | omit |
| §35 out-of-state property note | if business/out-of-state assets | same | **emphasize** (illiquid business) | if applicable |
| Fiduciary table | side-by-side | side-by-side | side-by-side | **2-column (Role \| Client)** |
| ILIT consideration | optional | optional | optional (1–2 ILITs, concurrent/deferred) | optional (1 ILIT) |

## 5. Key risk/positioning notes per structure

- **joint_outright** — Baseline only. State plainly that the first spouse's $2M MA exemption is **not** preserved. Use to show the cost of doing nothing.
- **joint_disclaimer** — Preserves the exemption **only if** the survivor makes a valid, timely disclaimer (within 9 months, no acceptance of benefits/control). If not, reverts to the outright result. Lighter-touch option; flag the dependency.
- **separate_clayton** — Most reliable: election is **fiduciary-controlled**, not survivor-dependent. Coordinate federal vs. MA-only QTIP elections deliberately (*Shaffer*). Best fit for larger / illiquid-business estates.
- **individual_single** — No marital/credit-shelter/Clayton/QTIP machinery (requires a spouse). One $2M exemption. Still produce the worksheet to discuss exposure and strategies (gifting, charitable, ILIT).
