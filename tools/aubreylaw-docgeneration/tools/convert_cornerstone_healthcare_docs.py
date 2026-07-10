#!/usr/bin/env python3
"""Convert the Cornerstone Health Care Proxy_cv1 combined form into generator templates.

The source file contains three documents in one Word file:
  1. Massachusetts Health Care Proxy
  2. HIPAA Authorization
  3. Living Will / Advance Directive

This script replaces the sample client data with Jinja placeholders and writes
three templates used by the incapacity-documents package.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-forms" / "incapacity" / "cornerstone" / "Health Care Proxy_cv1.docx"

OUTPUTS = {
    "health-care-proxy": ROOT / "templates" / "health-care-proxy.docx",
    "hipaa-authorization": ROOT / "templates" / "hipaa-authorization.docx",
    "living-will": ROOT / "templates" / "living-will.docx",
}

SECTION_MARKERS = {
    "health-care-proxy": "MASSACHUSETTS HEALTH CARE PROXY",
    "hipaa-authorization": "AUTHORIZATION FOR RELEASE OF",
    "living-will": "LIVING WILL FOR",
}

# Order matters: longer / more specific strings first.
TEXT_REPLACEMENTS: list[tuple[str, str]] = [
    ("AUTHORIZATION FOR RELEASE OF JULIE H. VENABLES’S PROTECTED HEALTH INFORMATION",
     "AUTHORIZATION FOR RELEASE OF {{ client.full_name | name }}’S PROTECTED HEALTH INFORMATION"),
    ("MASSACHUSETTS HEALTH CARE PROXY OF JULIE H. VENABLES",
     "MASSACHUSETTS HEALTH CARE PROXY OF {{ client.full_name | name }}"),
    ("LIVING WILL FOR JULIE H. VENABLES",
     "LIVING WILL FOR {{ client.full_name | name }}"),
    ("If MATTHEW VENABLES is unwilling or unable to serve, I designate the individuals in the order listed below as alternate Health Care Proxys to exercise the powers and discretions set forth in this instrument.",
     "If {{ healthcare.agent.primary.full_name | name }} is unwilling or unable to serve, I designate the individuals in the order listed below as alternate Health Care Proxys to exercise the powers and discretions set forth in this instrument."),
    ("MATTHEW VENABLES SUSAN HERMAN MICHAEL HERMAN and the Trustee or Successor Trustee of any trust of which I am a beneficiary or a trustee, for the sole specific purpose of determining my capacity as defined in the trust document.",
     "{{ healthcare.agent.primary.full_name | name }}{% if healthcare.agent.alternate.full_name %}, {{ healthcare.agent.alternate.full_name | name }}{% endif %}{% for agent in hipaa.client_additional_agents %}, {{ agent.full_name | name }}{% endfor %}{% if hipaa.include_trustees %}, and the Trustee or Successor Trustee of any trust of which I am a beneficiary or a trustee, for the sole specific purpose of determining my capacity as defined in the trust document{% endif %}."),
    ("JULIE H. VENABLES, Principal", "{{ client.full_name | name }}, Principal"),
    ("JULIE H. VENABLES, the principal", "{{ client.full_name | name }}, the principal"),
    ("JULIE H. VENABLES, as Principal", "{{ client.full_name | name }}, as Principal"),
    ("JULIE H. VENABLES, as the declarant", "{{ client.full_name | name }}, as the declarant"),
    ("personally appeared JULIE H. VENABLES, as Principal", "personally appeared {{ client.full_name | name }}, as Principal"),
    ("personally appeared JULIE H. VENABLES, as the declarant", "personally appeared {{ client.full_name | name }}, as the declarant"),
    ("I, JULIE H. VENABLES, of Needham, Massachusetts, willfully and voluntarily declare",
     "I, {{ client.full_name | name }}, of {{ client.city }}, {{ client.state }}, willfully and voluntarily declare"),
    ("I, JULIE H. VENABLES, an individual, appoint the following persons or entities",
     "I, {{ client.full_name | name }}, an individual, appoint the following persons or entities"),
    ("declare that JULIE H. VENABLES signed this instrument in our presence",
     "declare that {{ client.full_name | name }} signed this instrument in our presence"),
    ("We, the undersigned witnesses, declare that JULIE H. VENABLES signed this instrument in our presence",
     "We, the undersigned witnesses, declare that {{ client.full_name | name }} signed this instrument in our presence"),
    ("are not related to JULIE H. VENABLES by blood, marriage, or adoption",
     "are not related to {{ client.full_name | name }} by blood, marriage, or adoption"),
    ("JULIE H. VENABLES is known to us", "{{ client.full_name | name }} is known to us"),
    ("JULIE H. VENABLES", "{{ client.full_name | name }}"),
    ("MATTHEW VENABLES", "{{ healthcare.agent.primary.full_name | name }}"),
    ("SUSAN HERMAN", "{{ healthcare.agent.alternate.full_name | name }}"),
    ("MICHAEL HERMAN", "{{ healthcare.agent.second_alternate.full_name | name }}"),
    ("19 Mayo Ave, Needham, Massachusetts 02492", "{{ healthcare.agent.primary.address }}"),
    ("Spouse", "{{ healthcare.agent.primary.relationship }}"),
    ("Mother", "{{ healthcare.agent.alternate.relationship }}"),
    ("Father", "{{ healthcare.agent.second_alternate.relationship }}"),
    ("July 30, 2026", "{{ execution.display_doc_date }}"),
    ("COUNTY OF NORFOLK", "COUNTY OF {{ execution.display_signing_county | name }}"),
    ("February 21, 1986", "{{ client.date_of_birth }}"),
    ("[Notary Commission]", "{{ execution.display_notary_commission }}"),
    ("[DocDate]", "{{ execution.display_doc_date }}"),
    ("[SIGNING COUNTY]", "{{ execution.display_signing_county | name }}"),
    ("[he/she]", "{{ client.pronoun_subject }}"),
    ("that she signed it voluntarily", "that {{ client.pronoun_subject }} signed it voluntarily"),
    ("acknowledged to me that she signed it voluntarily", "acknowledged to me that {{ client.pronoun_subject }} signed it voluntarily"),
]


def iter_block_items(document: Document):
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield child


def paragraph_text(paragraph: Paragraph) -> str:
    return paragraph.text or ""


def find_section_ranges(document: Document) -> dict[str, tuple[int, int]]:
    block_items = list(iter_block_items(document))
    starts: dict[str, int] = {}
    for index, item in enumerate(block_items):
        if not isinstance(item, Paragraph):
            continue
        text = paragraph_text(item)
        for section_id, marker in SECTION_MARKERS.items():
            if marker in text and section_id not in starts:
                starts[section_id] = index

    ordered = sorted(starts.items(), key=lambda pair: pair[1])
    ranges: dict[str, tuple[int, int]] = {}
    for i, (section_id, start) in enumerate(ordered):
        end = ordered[i + 1][1] if i + 1 < len(ordered) else len(block_items)
        ranges[section_id] = (start, end)
    return ranges


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


def convert_document(document: Document) -> None:
    for paragraph in document.paragraphs:
        convert_paragraph(paragraph)
    for table in document.tables:
        convert_table(table)


def insert_paragraph_before(document: Document, paragraph: Paragraph, text: str) -> Paragraph:
    new_paragraph = document.add_paragraph(text)
    paragraph._element.addprevious(new_paragraph._element)
    body = document.element.body
    body.remove(new_paragraph._element)
    return Paragraph(new_paragraph._element, document)


def apply_healthcare_proxy_fixes(document: Document) -> None:
    paragraphs = document.paragraphs
    for index, paragraph in enumerate(paragraphs):
        text = paragraph_text(paragraph)
        if text == "Phone:\t \t":
            previous = paragraph_text(paragraphs[index - 1]) if index > 0 else ""
            if "healthcare.agent.primary.address" in previous:
                replace_paragraph_text(paragraph, "Phone:\t{{ healthcare.agent.primary.phone }}")
            elif "healthcare.agent.alternate.address" in previous:
                replace_paragraph_text(paragraph, "Phone:\t{{ healthcare.agent.alternate.phone }}")
            elif "healthcare.agent.second_alternate.address" in previous:
                replace_paragraph_text(paragraph, "Phone:\t{{ healthcare.agent.second_alternate.phone }}")
        elif text.startswith("Phone:\t(781) 444-2158"):
            previous = paragraph_text(paragraphs[index - 1]) if index > 0 else ""
            if "healthcare.agent.alternate.address" in previous:
                replace_paragraph_text(paragraph, "Phone:\t{{ healthcare.agent.alternate.phone }}")
            elif "healthcare.agent.second_alternate.address" in previous:
                replace_paragraph_text(
                    paragraph,
                    "Phone:\t{{ healthcare.agent.second_alternate.phone }}{% endif %}",
                )
        elif text == "Address:\t \t":
            previous = paragraph_text(paragraphs[index - 1]) if index > 0 else ""
            if "healthcare.agent.alternate.relationship" in previous:
                replace_paragraph_text(paragraph, "Address:\t{{ healthcare.agent.alternate.address }}")
            elif "healthcare.agent.second_alternate.relationship" in previous:
                replace_paragraph_text(paragraph, "Address:\t{{ healthcare.agent.second_alternate.address }}")
        elif text.startswith("Name:\t{{ healthcare.agent.second_alternate.full_name"):
            replace_paragraph_text(
                paragraph,
                "{% if healthcare.agent.second_alternate.full_name %}"
                "Name:\t{{ healthcare.agent.second_alternate.full_name | name }}",
            )


def apply_hipaa_fixes(document: Document) -> None:
    for paragraph in document.paragraphs:
        text = paragraph_text(paragraph)
        if text.startswith("{{ healthcare.agent.second_alternate.full_name | name }} and"):
            replace_paragraph_text(
                paragraph,
                "{% if healthcare.agent.second_alternate.full_name %}"
                "{{ healthcare.agent.second_alternate.full_name | name }}"
                "{% if hipaa.include_trustees %} and{% endif %}"
                "{% endif %}",
            )
        elif text.startswith(
            "the Trustee or Successor Trustee of any trust of which I am a beneficiary or a trustee"
        ):
            replace_paragraph_text(
                paragraph,
                "{% if hipaa.include_trustees %}"
                "{% if healthcare.agent.second_alternate.full_name %}the Trustee{% else %}and the Trustee{% endif %} "
                "or Successor Trustee of any trust of which I am a beneficiary or a trustee, "
                "for the sole specific purpose of determining my capacity as defined in the trust document."
                "{% endif %}",
            )


def apply_section_fixes(document: Document, section_id: str) -> None:
    if section_id == "health-care-proxy":
        apply_healthcare_proxy_fixes(document)
    elif section_id == "hipaa-authorization":
        apply_hipaa_fixes(document)


def clone_block_item(item, target: Document) -> None:
    if isinstance(item, Paragraph):
        target.element.body.append(deepcopy(item._element))
        return
    target.element.body.append(deepcopy(item))


def build_section_document(source: Document, start: int, end: int) -> Document:
    items = list(iter_block_items(source))
    target = Document()
    # Remove the default empty paragraph inserted by python-docx.
    if target.paragraphs:
        target.paragraphs[0]._element.getparent().remove(target.paragraphs[0]._element)
    for item in items[start:end]:
        clone_block_item(item, target)
    convert_document(target)
    return target


def strip_orphaned_section_references(document: Document) -> None:
    """Remove header/footer references left over from splitting the combined source form."""
    body = document.element.body
    for sect_pr in body.xpath("./w:sectPr"):
        for tag in ("headerReference", "footerReference"):
            for reference in list(sect_pr.findall(qn(f"w:{tag}"))):
                sect_pr.remove(reference)


def finalize_section_document(document: Document, section_id: str) -> None:
    apply_section_fixes(document, section_id)
    strip_orphaned_section_references(document)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source form: {SOURCE}")

    source = Document(SOURCE)
    ranges = find_section_ranges(source)

    missing = [section_id for section_id in OUTPUTS if section_id not in ranges]
    if missing:
        raise SystemExit(f"Could not locate section markers for: {', '.join(missing)}")

    for section_id, target in OUTPUTS.items():
        start, end = ranges[section_id]
        section_doc = build_section_document(source, start, end)
        finalize_section_document(section_doc, section_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        section_doc.save(target)
        print(f"Wrote {target.relative_to(ROOT)} ({end - start} blocks)")


if __name__ == "__main__":
    main()
