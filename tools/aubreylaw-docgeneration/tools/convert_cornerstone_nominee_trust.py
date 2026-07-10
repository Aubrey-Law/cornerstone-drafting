#!/usr/bin/env python3
"""Convert the Cornerstone Nominee Trust (No Real Trust) form.

Replaces bracket placeholders with docxtemplater `{field}` keys aligned with
the real-estate-transfer field set and writes templates/nominee-trust.docx.
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-forms" / "trust" / "cornerstone" / "Nominee Trust (No Real Trust).docx"
TARGET = ROOT / "templates" / "nominee-trust.docx"

TRUSTEE_LINE = (
    "{{ fiduciaries.trustee.primary.full_name | name }}"
    "{% if fiduciaries.trustee.co_primary.full_name %}"
    " and {{ fiduciaries.trustee.co_primary.full_name | name }}"
    "{% endif %}"
)

TEXT_REPLACEMENTS: list[tuple[str, str]] = [
    ("[NAME OF BENEFICIARY 1'S REVOCABLE TRUST]", "{beneficiary_1_trust}"),
    ("[NAME OF BENEFICIARY 2'S REVOCABLE TRUST]", "{beneficiary_2_trust}"),
    ("[NAME OF PRIMARY SUCCESSOR TRUSTEE]", "{successor_trustee}"),
    ("[NAME OF SECONDARY SUCCESSOR TRUSTEE]", "{second_successor_trustee}"),
    ("[NAME OF SECOND TRUSTEE]", "{co_trustee}"),
    ("[NOMINEE TRUST NAME]", "{trust_name}"),
    ("[NAME OF BENEFICIARY 1]", "{beneficiary_1}"),
    ("[NAME OF BENEFICIARY 2]", "{beneficiary_2}"),
    ("[NAME OF TRUSTEE]", "{trustees}"),
    ("[OrdinalDocDate]", "{execution_date}"),
    ("[SIGNING COUNTY]", "{certificate_execution_county}"),
    ("[____]%", "{beneficiary_percent}"),
    ("[DocDate]", "{execution_date}"),
    ("[CITY]", "{trustee_city}"),
    ("[STATE]", "{trustee_state}"),
    ("[he/she/they]", "they"),
    ("[him/her/them]", "them"),
    ("[his/her/their]", "their"),
    ("[he/she]", "they"),
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
