#!/usr/bin/env python3
"""Convert the firm parental-delegation.docx temporary delegation form.

Replaces legacy merge-field tokens ([CLIENT], [GUARDIAN], etc.) with Jinja
placeholders and writes templates/temporary-delegation-parental-powers.docx
for the temporary-delegation-parental-powers package.

This is the Aubrey Law OneDrive template (MGL c.190B §5-103), distinct from
the older Cornerstone cv1 conversion in convert_cornerstone_temp_delegation_doc.py.
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-forms" / "guardianship" / "parental-delegation.docx"
TARGET = ROOT / "templates" / "temporary-delegation-parental-powers.docx"

PARENT_INTRO_MARRIED = (
    'We, {{ client.full_name | name }} and {{ spouse.full_name | name }}, '
    '("the Parents" "we" "us" "our"), both of {{ client.city }}, {{ client.state }}, state:'
)
PARENT_INTRO_SINGLE = (
    'I, {{ client.full_name | name }}, ("the Parent" "I" "me" "my"), '
    'of {{ client.city }}, {{ client.state }}, state:'
)

CHILDREN_LOOP = (
    "{% for child in minor_children %}"
    "{{ child.full_name | name }} born on {{ child.date_of_birth }}"
    "{% if not loop.last %}\n{% endif %}"
    "{% endfor %}"
)

TEMP_AGENT_NAME = (
    "Name:\t\t{{ guardians.temporary.full_name | name }}"
    "{% if guardians.temporary_co.full_name %} and {{ guardians.temporary_co.full_name | name }}{% endif %}"
)

WITNESS_ATTESTATION_MARRIED = (
    "On this {{ execution.display_ordinal_doc_date }}, "
    "{{ client.full_name | name }} and {{ spouse.full_name | name }}, "
    "both of {{ client.city }} in the County of {{ execution.display_signing_county | name }} "
    "and Commonwealth of Massachusetts, signed the foregoing instrument in our presence, "
    "declaring it to be their Massachusetts Temporary Delegation of Powers of Parents, "
    "and as witnesses both of us being over the age of 18 and neither having been appointed "
    "Temporary Agent within this document, thereof we two do now, at their request, in their "
    "presence and in the presence of each other hereto subscribe our names."
)

WITNESS_ATTESTATION_SINGLE = (
    "On this {{ execution.display_ordinal_doc_date }}, "
    "{{ client.full_name | name }}, of {{ client.city }}, "
    "in the County of {{ execution.display_signing_county | name }} "
    "and Commonwealth of Massachusetts, signed the foregoing instrument in our presence, "
    "declaring it to be {{ client.pronoun_possessive }} Massachusetts Temporary Delegation "
    "of Powers of Parent, and as witnesses both of us being over the age of 18 and neither "
    "having been appointed Temporary Agent within this document, thereof we two do now, "
    "at {{ client.pronoun_possessive }} request, in {{ client.pronoun_possessive }} presence "
    "and in the presence of each other hereto subscribe our names."
)

NOTARY_ACKNOWLEDGMENT_MARRIED = (
    "On this {{ execution.display_ordinal_doc_date }}, before me, the undersigned notary public "
    "personally appeared {{ client.full_name | name }}, and {{ spouse.full_name | name }}, the Parents, "
    "and _______________________ and ________________________, the Witnesses, who proved to me "
    "through satisfactory evidence of identification, which was __________________________ to be the "
    "Parents and Witnesses, respectively, and whose names are signed to the above instrument and all "
    "of these persons being by me sworn, {{ client.full_name | name }}, and {{ spouse.full_name | name }}, "
    "the Parents, declared to me and to the Witnesses in my presence that the instrument is their free "
    "and voluntary act for the purposes therein expressed, and each of the Witnesses stated to me in "
    "presence of the Parents that said Witness signed the document as such Witness and that to the best "
    "of said Witness's knowledge and belief both Parents were eighteen years of age or older, of sound "
    "mind and under no constraint or influence."
)

NOTARY_ACKNOWLEDGMENT_SINGLE = (
    "On this {{ execution.display_ordinal_doc_date }}, before me, the undersigned notary public "
    "personally appeared {{ client.full_name | name }}, the Parent, and _______________________ "
    "and ________________________, the Witnesses, who proved to me through satisfactory evidence of "
    "identification, which was __________________________ to be the Parent and Witnesses, respectively, "
    "and whose names are signed to the above instrument and all of these persons being by me sworn, "
    "{{ client.full_name | name }}, the Parent, declared to me and to the Witnesses in my presence "
    "that the instrument is {{ client.pronoun_possessive }} free and voluntary act for the purposes "
    "therein expressed, and each of the Witnesses stated to me in presence of the Parent that said "
    "Witness signed the document as such Witness and that to the best of said Witness's knowledge and "
    "belief the Parent was eighteen years of age or older, of sound mind and under no constraint or influence."
)

SIGNATURE_LINE_MARRIED = "{{ client.full_name | name }}\t\t{{ spouse.full_name | name }}"
SIGNATURE_LINE_SINGLE = "{{ client.full_name | name }}"

# Order matters: longer / more specific strings first.
TEXT_REPLACEMENTS: list[tuple[str, str]] = [
    (
        'We, [CLIENT] and [SPOUSE], (“the Parents” “we” “us” “our”), both of [Address], state:',
        "{% if has_spouse %}"
        + PARENT_INTRO_MARRIED
        + "{% else %}"
        + PARENT_INTRO_SINGLE
        + "{% endif %}",
    ),
    ("[CHILD FULL NAME] born on [Child DOB]", CHILDREN_LOOP),
    ("Name:\t\t[GUARDIAN] and [CO GUARDIAN]\t", TEMP_AGENT_NAME),
    ("Address:\t\t\t\t", "Address:\t{{ guardians.temporary.address | default('') }}"),
    ("Phone:\t\t \t\t", "Phone:\t{{ guardians.temporary.phone | default('') }}"),
    ("this [Ordinal_DocDate]", "this {{ execution.display_ordinal_doc_date }}"),
    ("On this [Ordinal_DocDate]", "On this {{ execution.display_ordinal_doc_date }}"),
    ("both of [City]", "both of {{ client.city }}"),
    ("COUNTY OF [SIGNING COUNTY]", "COUNTY OF {{ execution.display_signing_county | name }}"),
    ("On this [DocDate]", "On this {{ execution.display_ordinal_doc_date }}"),
    ("[CLIENT], and [SPOUSE], the Parents", "{{ client.full_name | name }}, and {{ spouse.full_name | name }}, the Parents"),
    ("[CLIENT]", "{{ client.full_name | name }}"),
    ("[SPOUSE]", "{{ spouse.full_name | name }}"),
    ("[Notary Commission]", "{{ execution.display_notary_commission }}"),
]


def paragraph_text(paragraph: Paragraph) -> str:
    return paragraph.text or ""


def convert_text(text: str) -> str:
    converted = text
    for before, after in TEXT_REPLACEMENTS:
        converted = converted.replace(before, after)
    return converted


def replace_paragraph_text(paragraph: Paragraph, text: str) -> None:
    if not paragraph.runs:
        paragraph.add_run(text)
        return
    paragraph.runs[0].text = text
    for run in paragraph.runs[1:]:
        run.text = ""


def convert_paragraph(paragraph: Paragraph) -> None:
    original = paragraph_text(paragraph)
    converted = convert_text(original)
    if converted != original:
        replace_paragraph_text(paragraph, converted)


def convert_table(table) -> None:
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                convert_paragraph(paragraph)


def apply_paragraph_fixes(document: Document) -> None:
    paragraphs = document.paragraphs
    for index, paragraph in enumerate(paragraphs):
        text = paragraph_text(paragraph)

        if text.startswith("On this {{ execution.display_ordinal_doc_date }}, ") and "signed the foregoing instrument in our presence" in text:
            replace_paragraph_text(
                paragraph,
                "{% if has_spouse %}"
                + WITNESS_ATTESTATION_MARRIED
                + "{% else %}"
                + WITNESS_ATTESTATION_SINGLE
                + "{% endif %}",
            )
            continue

        if text.startswith("On this {{ execution.display_ordinal_doc_date }}, before me, the undersigned notary public"):
            replace_paragraph_text(
                paragraph,
                "{% if has_spouse %}"
                + NOTARY_ACKNOWLEDGMENT_MARRIED
                + "{% else %}"
                + NOTARY_ACKNOWLEDGMENT_SINGLE
                + "{% endif %}",
            )
            continue

        if (
            text == "In Witness Whereof, we hereto set our hands and seals, and in the presence of two witnesses, declare this document to be our Temporary Delegation of Powers of Parents, this {{ execution.display_ordinal_doc_date }}."
            and index + 1 < len(paragraphs)
            and not paragraph_text(paragraphs[index + 1]).strip()
        ):
            # Insert parent signature line after the witness-whereof paragraph.
            signature = paragraphs[index + 1]
            replace_paragraph_text(
                signature,
                "{% if has_spouse %}"
                + SIGNATURE_LINE_MARRIED
                + "{% else %}"
                + SIGNATURE_LINE_SINGLE
                + "{% endif %}",
            )


def strip_orphaned_section_references(document: Document) -> None:
    body = document.element.body
    for sect_pr in body.xpath("./w:sectPr"):
        for tag in ("headerReference", "footerReference"):
            for reference in list(sect_pr.findall(qn(f"w:{tag}"))):
                sect_pr.remove(reference)


def convert_document(document: Document) -> None:
    for paragraph in document.paragraphs:
        convert_paragraph(paragraph)
    for table in document.tables:
        convert_table(table)
    apply_paragraph_fixes(document)
    strip_orphaned_section_references(document)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source form: {SOURCE}")

    document = Document(SOURCE)
    convert_document(document)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    document.save(TARGET)
    print(f"Wrote {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
