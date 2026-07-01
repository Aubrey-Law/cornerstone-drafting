# Individual Disclaimer Trust — Placeholder Map

Package: `indv-disclaimer-trust`
Template: `templates/indv-disclaimer-trust.docx`
Source form: `Indv_Disclaimer Trust.docx`

## Overview

Massachusetts individual disclaimer trust for a married grantor. Default disposition is outright to surviving spouse; disclaimer by the spouse triggers a Marital Trust (QTIP) / Family Trust (bypass) split. Descendants receive shares in trust with staged withdrawal rights (50% at age 25, balance at age 30). Common trust holds assets for all descendants if youngest child is under 23.

## Merge Fields Used

### Client / Grantor

| Merge Field | Location in Document | Notes |
| --- | --- | --- |
| `client.full_name` | Art. 1 (parties), Art. 2, signature block, notary | With `\| name` in formal contexts |
| `client.full_name \| name` | Title page, trust identification, signature, notary | Uppercase legal name |

### Spouse

| Merge Field | Location in Document | Notes |
| --- | --- | --- |
| `spouse.full_name` | Art. 2 family declaration | Plain text |
| `spouse.pronoun_possessive` | Sec. 5.05 (portability), Sec. 8.01–8.02 (Marital Trust), Sec. 14.05 (dissolution) | Replaces hardcoded "her" from source |

### Children

| Merge Field | Location in Document | Notes |
| --- | --- | --- |
| `children[]` | Art. 2 family declaration | Loop: `{% for child in children %}` |
| `child.full_name` | Art. 2 child listing | Inside children loop |

### Trust

| Merge Field | Location in Document | Notes |
| --- | --- | --- |
| `trust.name` | Title page, Art. 1 (Sec. 1.01 identification) | With `\| name` on title page |
| `trust.display_date` | Title page, Art. 1 opening, Sec. 1.01, execution clause | Trust date or blank fallback |

### Fiduciaries — Trustees

| Merge Field | Location in Document | Notes |
| --- | --- | --- |
| `fiduciaries.trustee.co_primary.full_name` | Art. 1 (parties), Sec. 1.01, Sec. 3.03, signature, notary | Initial co-trustee; with `\| name` |
| `fiduciaries.trustee.successor.full_name` | Sec. 3.02 (incapacity), Sec. 3.03 (after death) | Successor trustee; with `\| name` |

### Execution / Signing

| Merge Field | Location in Document | Notes |
| --- | --- | --- |
| `execution.display_doc_date` | Notary block | Signing date |
| `execution.display_signing_county` | Notary block | With `\| name` |

### Conditional Flags

| Flag | Controls |
| --- | --- |
| `has_spouse` | Art. 2 spouse declaration (if/else married/unmarried) |
| `has_children` | Art. 2 children listing (entire children paragraph) |

## Source-Form Markers Replaced

| Source Marker | Replaced With |
| --- | --- |
| `[TRUST NAME]` | `{{ trust.name }}` or `{{ trust.name \| name }}` |
| `[DocDate]` | `{{ trust.display_date }}` or `{{ execution.display_doc_date }}` |
| `[GRANTOR]` | `{{ client.full_name \| name }}` |
| `[SPOUSE]` | `{{ spouse.full_name }}` |
| `[INITIAL CO-TRUSTEE]` | `{{ fiduciaries.trustee.co_primary.full_name \| name }}` |
| `[SUCCESSOR TRUSTEE]` | `{{ fiduciaries.trustee.successor.full_name \| name }}` |
| `[SIGNING COUNTY]` | `{{ execution.display_signing_county }}` |
| `CHILD 2 and CHILD 2` | `{% for child in children %}` loop |
| `her` (spouse pronoun) | `{{ spouse.pronoun_possessive }}` (5 instances) |

## Hardcoded Values That Could Be Templated in Future

| Value | Location | Potential Field |
| --- | --- | --- |
| Age 23 (Common Trust termination) | Sec. 10.01 | `trust.common_trust_age` (new) |
| Age 25 (50% withdrawal) | Sec. 10.03(d) | `trust.descendants_distribution.stage_1_age` |
| Age 30 (remaining 50% withdrawal) | Sec. 10.03(d) | `trust.descendants_distribution.stage_2_age` |
| Age 21 (underage threshold, Art. 12) | Sec. 12 | Standard MA UTMA age |
| Age 18 (adoption cutoff) | Sec. 14.07(a) | Standard legal definition |
| 45 days (survivorship period) | Sec. 14.04 | Standard provision |

## Repo Destination Paths

| Artifact | Destination |
| --- | --- |
| DOCX template | `tools/aubreylaw-docgeneration/templates/indv-disclaimer-trust.docx` |
| Package manifest | `tools/aubreylaw-docgeneration/packages/indv-disclaimer-trust.json` |
| Example payload | `tools/aubreylaw-docgeneration/examples/client-ma-disclaimer-trust.json` |
| This placeholder map | `tools/aubreylaw-docgeneration/docs/indv-disclaimer-trust-placeholder-map.md` |
