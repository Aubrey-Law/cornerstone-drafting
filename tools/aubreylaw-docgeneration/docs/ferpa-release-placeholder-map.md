# FERPA Release Placeholder Map

Source form:

- None. The firm had no FERPA release form; this template was drafted from the
  statute and the College Preparation Plan questionnaire. **The legal language is
  new and has not been attorney-approved — treat it as a draft.**

Generated template:

- `templates/ferpa-release.docx`

Package:

- `packages/ferpa-release.json`

Build (regenerates the DOCX from scratch — edit the script, not the binary):

```bash
npx tsx scripts/generate-ferpa-release-template.ts
```

## Why this is a separate document

Education records are governed by the Family Educational Rights and Privacy Act
(20 U.S.C. § 1232g; 34 C.F.R. Part 99), not HIPAA. The College Preparation
Plan's HIPAA authorization reaches health information only, so a student who
wants a parent to see grades, a bursar account, or a financial aid file signs
this release as well. At a postsecondary institution the FERPA rights belong to
the student regardless of age or who pays tuition.

## Key Placeholders

| Document line | Template field |
| --- | --- |
| Student name (header and signature block) | `{{ client.full_name \| name }}` |
| Date of birth | `{{ client.date_of_birth }}` |
| Institution | `{{ ferpa.school_name }}` |
| Campus (conditional line) | `{{ ferpa.school_location }}` |
| Authorized Recipients | `{{ ferpa.recipients }}` |
| Record category bullets | `{{ record.label }}` inside `{% for record in ferpa.records %}` |
| Execution date | `{{ execution.display_doc_date }}` |

## Conditional Logic

| Condition | Effect |
| --- | --- |
| `ferpa.all_records` | Section 2 authorizes all education records in one sentence instead of iterating the category list |
| `ferpa.school_location` | Prints the "Campus:" line; omitted when neither city nor state is known |
| `ferpa_includes_health_center` | Adds the campus-treatment-records paragraph to section 2, stating that health and counseling records fall outside FERPA's "education records" definition (34 C.F.R. § 99.3) and are covered by the separate HIPAA authorization |

The campus-treatment paragraph deliberately rides inside section 2 rather than
taking a number of its own, so sections 3–7 keep static numbering whether or not
the student selected the health center.

## Design sheet source

Every field comes from `decisions.college_prep` on a College Preparation Plan
design sheet (`lib/draftPayload/ferpa.ts` → `payload.ferpa_release` →
`toEstateGeneratorData`). The package selects when
`decisions.document_inclusions.ferpa_release` is on, which defaults to the
student's own answer to the FERPA question on the questionnaire.

`ferpa.records` is required by `packageValidation.ts` only when
`ferpa.all_records` is false — a release naming no records authorizes nothing,
but the all-records branch never iterates the list.

## Not covered

The school's own release form. Most institutions require their release to be
submitted on their form or through their student portal; section 7 says this
authorization is in addition to that, not a substitute for it.
