#!/usr/bin/env python3
"""Convert the Cornerstone estate-plan-summary_cv1 form into a generator template.

Supersedes the programmatic `scripts/generate-estate-plan-summary-template.ts`
fallback for production — use this script after updating the Cornerstone source.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-forms" / "estate" / "cornerstone" / "estate-plan-summary_cv1.docx"
TARGET = ROOT / "templates" / "estate-plan-summary.docx"

TITLE_NAMES = (
    "{% if has_spouse %}"
    "{{ client.full_name | name }} & {{ spouse.full_name | name }}"
    "{% else %}"
    "{{ client.full_name | name }}"
    "{% endif %}"
)

TRUSTEE_INITIAL = (
    "{% if fiduciaries.trustee.co_primary.full_name %}"
    "Initial Co-Trustees: {{ fiduciaries.trustee.primary.full_name | name }} and "
    "{{ fiduciaries.trustee.co_primary.full_name | name }} — "
    "{% if has_spouse %}You both manage all trust assets together, just as you do now. "
    "No changes to your daily financial life are required.{% else %}"
    "You manage all trust assets as Trustee.{% endif %}"
    "{% else %}"
    "Initial Trustee: {{ fiduciaries.trustee.primary.full_name | name }} — "
    "You manage all trust assets as Trustee.{% endif %}"
)

SUCCESSOR_TRUSTEE = (
    "Successor Trustee: "
    "{% if fiduciaries.trustee.successor.full_name %}"
    "{{ fiduciaries.trustee.successor.full_name | name }}"
    "{% if fiduciaries.trustee.second_successor.full_name %}, then "
    "{{ fiduciaries.trustee.second_successor.full_name | name }}{% endif %}"
    "{% else %}[NOT PROVIDED]{% endif %} — "
    "Steps in automatically if {% if has_spouse %}both of you become incapacitated or pass away{% else %}"
    "you become incapacitated or pass away{% endif %}, without any court involvement."
)

CHILDREN_LIST = (
    "{% if has_children %}"
    "Children: {% for child in children %}{{ child.full_name | name }}"
    "{% if loop.index != loop.length %} and {% endif %}{% endfor %}. "
    "After {% if has_spouse %}both spouses have{% else %}you have{% endif %} passed, "
    "the remaining trust property is divided equally among your children, per stirpes."
    "{% endif %}"
)

STAGED_WITHDRAWAL = (
    "{% if trust.descendants_distribution.method == 'staged' %}"
    "Withdrawal Ages: Each child may withdraw 50% of their share at age "
    "{{ trust.descendants_distribution.stage_1_age }}, and the remaining balance at age "
    "{{ trust.descendants_distribution.stage_2_age }}"
    "{% if trust.descendants_distribution.stage_3_age and trust.descendants_distribution.stage_3_age != '' %}, with the final balance at age "
    "{{ trust.descendants_distribution.stage_3_age }}{% endif %}."
    "{% elif trust.descendants_distribution.method == 'outright' %}"
    "Distribution: Each child receives their share outright at age "
    "{{ trust.descendants_distribution.distribution_age | default('21') }}."
    "{% endif %}"
)

COMMON_TRUST = (
    "{% if trust.include_common_trust_for_children and has_minor_children %}"
    "Common Trust: If your youngest child is under age {{ trust.special_distributions_age | default('23') }} "
    "when the surviving spouse passes, trust property is held in a single Common Trust until the youngest "
    "reaches {{ trust.special_distributions_age | default('23') }}, then divided into separate shares."
    "{% endif %}"
)

CLIENT_WILL_PR = (
    "Personal Representative: {{ fiduciaries.executor.primary.full_name | name }}"
    "{% if fiduciaries.executor.co_primary.full_name %} and "
    "{{ fiduciaries.executor.co_primary.full_name | name }}{% endif %}"
)

CLIENT_WILL_SUCCESSOR = (
    "Successor Personal Representative: "
    "{% if fiduciaries.executor.successor.full_name %}"
    "{{ fiduciaries.executor.successor.full_name | name }}"
    "{% if fiduciaries.executor.second_successor.full_name %}, then "
    "{{ fiduciaries.executor.second_successor.full_name | name }}{% endif %}"
    "{% else %}[NOT PROVIDED]{% endif %}"
)

SPOUSE_WILL_PR = (
    "Personal Representative: {{ fiduciaries.spouse_executor.primary.full_name | name }}"
    "{% if fiduciaries.spouse_executor.co_primary.full_name %} and "
    "{{ fiduciaries.spouse_executor.co_primary.full_name | name }}{% endif %}"
)

SPOUSE_WILL_SUCCESSOR = (
    "Successor Personal Representative: "
    "{% if fiduciaries.spouse_executor.successor.full_name %}"
    "{{ fiduciaries.spouse_executor.successor.full_name | name }}"
    "{% if fiduciaries.spouse_executor.second_successor.full_name %}, then "
    "{{ fiduciaries.spouse_executor.second_successor.full_name | name }}{% endif %}"
    "{% else %}[NOT PROVIDED]{% endif %}"
)

CLIENT_POA_HEADING = "{{ client.full_name | name }} — Power of Attorney"
CLIENT_POA_AGENT = (
    "Agent: {{ fiduciaries.agent.primary.full_name | name }}"
    "{% if fiduciaries.agent.co_primary.full_name %} and "
    "{{ fiduciaries.agent.co_primary.full_name | name }}{% endif %}"
)
CLIENT_POA_SUCCESSOR = (
    "Successor Agent: "
    "{% if fiduciaries.agent.successor.full_name %}"
    "{{ fiduciaries.agent.successor.full_name | name }}"
    "{% else %}[NOT PROVIDED]{% endif %}"
)

SPOUSE_POA_HEADING = "{{ spouse.full_name | name }} — Power of Attorney"
SPOUSE_POA_AGENT = (
    "Agent: {{ fiduciaries.spouse_agent.primary.full_name | name }}"
    "{% if fiduciaries.spouse_agent.co_primary.full_name %} and "
    "{{ fiduciaries.spouse_agent.co_primary.full_name | name }}{% endif %}"
)
SPOUSE_POA_SUCCESSOR = (
    "Successor Agent: "
    "{% if fiduciaries.spouse_agent.successor.full_name %}"
    "{{ fiduciaries.spouse_agent.successor.full_name | name }}"
    "{% else %}[NOT PROVIDED]{% endif %}"
)

CLIENT_HCP_HEADING = "{{ client.full_name | name }} — Health Care Agent"
CLIENT_HCP_AGENT = (
    "Health Care Agent: {{ healthcare.agent.primary.full_name | name }}"
    "{% if healthcare.agent.primary.relationship %} ({{ healthcare.agent.primary.relationship }}){% endif %}"
)
CLIENT_HCP_ALTERNATE = (
    "Alternate Agent: "
    "{% if healthcare.agent.alternate.full_name %}"
    "{{ healthcare.agent.alternate.full_name | name }}"
    "{% else %}[NOT PROVIDED]{% endif %}"
)

SPOUSE_HCP_HEADING = "{{ spouse.full_name | name }} — Health Care Agent"
SPOUSE_HCP_AGENT = (
    "Health Care Agent: {{ healthcare.spouse_agent.primary.full_name | name }}"
    "{% if healthcare.spouse_agent.primary.relationship %} "
    "({{ healthcare.spouse_agent.primary.relationship }}){% endif %}"
)
SPOUSE_HCP_ALTERNATE = (
    "Alternate Agent: "
    "{% if healthcare.spouse_agent.alternate.full_name %}"
    "{{ healthcare.spouse_agent.alternate.full_name | name }}"
    "{% else %}[NOT PROVIDED]{% endif %}"
)

GUARDIAN_HEADING = "{% if requires_guardian_clause %}Guardian for Minor Children{% endif %}"
GUARDIAN_BODY = (
    "{% if requires_guardian_clause %}"
    "If both parents are unable to care for minor children, the following guardians are nominated: "
    "Long-Term Guardian: {{ guardians.primary.full_name | name }}"
    "{% if guardians.successor.full_name %}; Successor: {{ guardians.successor.full_name | name }}{% endif %}"
    "{% if guardians.second_successor.full_name %}; Second Successor: "
    "{{ guardians.second_successor.full_name | name }}{% endif %}."
    "{% endif %}"
)
GUARDIAN_SHORT_TERM = (
    "{% if requires_guardian_clause and guardians.temporary.full_name %}"
    "Short-Term Guardian: {{ guardians.temporary.full_name | name }}"
    "{% if guardians.temporary_successor.full_name %}; Successor: "
    "{{ guardians.temporary_successor.full_name | name }}{% endif %}."
    "{% endif %}"
)

# Paragraph replacements keyed by exact sample text prefix (first unique line).
PARAGRAPH_REPLACEMENTS: list[tuple[str, str]] = [
    ("Dianyuan Wang & Dan Tang", TITLE_NAMES),
    ("June 20, 2026", "{{ execution.display_doc_date }}"),
    ("Your Revocable Living Trust", "{% if planning.include_trust %}Your Revocable Living Trust{% endif %}"),
    (
        "The Wang Family Trust, dated _________________, 20___.",
        "{% if planning.include_trust %}"
        "The {{ trust.name | name }}, dated {{ trust.display_date }}."
        "{% endif %}",
    ),
    (
        "Initial Co-Trustees: Dianyuan Wang and Dan Tang",
        "{% if planning.include_trust %}" + TRUSTEE_INITIAL + "{% endif %}",
    ),
    (
        "Successor Trustee: [NOT PROVIDED]",
        "{% if planning.include_trust %}" + SUCCESSOR_TRUSTEE + "{% endif %}",
    ),
    (
        "Children: Sara Wang and Jared Wang.",
        "{% if planning.include_trust %}" + CHILDREN_LIST + "{% endif %}",
    ),
    (
        "Withdrawal Ages: Each child may withdraw 50%",
        "{% if planning.include_trust %}" + STAGED_WITHDRAWAL + "{% endif %}",
    ),
    (
        "Common Trust: If your youngest child is under age 23",
        "{% if planning.include_trust %}" + COMMON_TRUST + "{% endif %}",
    ),
    (
        "Your Wills",
        "{% if planning.include_pour_over_will or planning.include_simple_will or planning.include_testamentary_trust_will %}Your {% if planning.include_pour_over_will %}Wills{% elif planning.include_simple_will %}Will{% else %}Testamentary Trust Will{% endif %}{% endif %}",
    ),
    (
        "Each of your Wills serves as a safety net",
        "{% if planning.include_pour_over_will %}"
        "{% if has_spouse %}Each of your Wills serves as a safety net for any assets not already in the trust. "
        "They direct that any remaining assets pour over into {{ trust.name | name }} to be distributed "
        "according to the trust terms.{% else %}Your Will serves as a safety net for any assets not already "
        "in the trust, directing them to pour over into {{ trust.name | name }}.{% endif %}"
        "{% elif planning.include_simple_will %}"
        "Your Will directs disposition of your tangible personal property and residuary estate."
        "{% elif planning.include_testamentary_trust_will %}"
        "Your Testamentary Trust Will creates trust provisions inside the will for beneficiaries "
        "who are intended to receive property in trust after death."
        "{% endif %}",
    ),
    ("Dianyuan Wang's Will", "{% if planning.include_pour_over_will or planning.include_simple_will or planning.include_testamentary_trust_will %}{{ client.full_name | name }}'s Will{% endif %}"),
    ("Personal Representative: Dan Tang", "{% if planning.include_pour_over_will or planning.include_simple_will or planning.include_testamentary_trust_will %}" + CLIENT_WILL_PR + "{% endif %}"),
    ("Successor Personal Representative: [NOT PROVIDED]", "{% if planning.include_pour_over_will or planning.include_simple_will or planning.include_testamentary_trust_will %}" + CLIENT_WILL_SUCCESSOR + "{% endif %}"),
    ("Dan Tang's Will", "{% if has_spouse and planning.spouse_docs and (planning.include_pour_over_will or planning.include_testamentary_trust_will) %}{{ spouse.full_name | name }}'s Will{% endif %}"),
    ("Personal Representative: Dianyuan Wang", "{% if has_spouse and planning.spouse_docs and (planning.include_pour_over_will or planning.include_testamentary_trust_will) %}" + SPOUSE_WILL_PR + "{% endif %}"),
    ("Durable Power of Attorney", "{% if planning.include_dpoa %}Durable Power of Attorney{% endif %}"),
    ("Dianyuan Wang — Power of Attorney", "{% if planning.include_dpoa %}" + CLIENT_POA_HEADING + "{% endif %}"),
    ("Agent: Dan Tang", "{% if planning.include_dpoa %}" + CLIENT_POA_AGENT + "{% endif %}"),
    (
        "Gifts from Dianyuan's assets are expressly prohibited.",
        "{% if planning.include_dpoa %}Gifts from {{ client.full_name | name }}'s assets are "
        "{% if dpoa.allow_gifts %}permitted as provided in the document{% else %}expressly prohibited{% endif %}."
        "{% endif %}",
    ),
    ("Dan Tang — Power of Attorney", "{% if has_spouse and planning.spouse_docs and planning.include_dpoa %}" + SPOUSE_POA_HEADING + "{% endif %}"),
    ("Agent: Dianyuan Wang", "{% if has_spouse and planning.spouse_docs and planning.include_dpoa %}" + SPOUSE_POA_AGENT + "{% endif %}"),
    (
        "Gifts from Dan's assets are expressly prohibited.",
        "{% if has_spouse and planning.spouse_docs and planning.include_dpoa %}Gifts from "
        "{{ spouse.full_name | name }}'s assets are "
        "{% if dpoa.allow_gifts %}permitted as provided in the document{% else %}expressly prohibited{% endif %}."
        "{% endif %}",
    ),
    ("Health Care Proxy", "{% if planning.include_hcp %}Health Care Proxy{% endif %}"),
    ("Dianyuan Wang — Health Care Agent", "{% if planning.include_hcp %}" + CLIENT_HCP_HEADING + "{% endif %}"),
    ("Health Care Agent: Dan Tang (Spouse)", "{% if planning.include_hcp %}" + CLIENT_HCP_AGENT + "{% endif %}"),
    ("Dan Tang — Health Care Agent", "{% if has_spouse and planning.spouse_docs and planning.include_hcp %}" + SPOUSE_HCP_HEADING + "{% endif %}"),
    ("Health Care Agent: Dianyuan Wang (Spouse)", "{% if has_spouse and planning.spouse_docs and planning.include_hcp %}" + SPOUSE_HCP_AGENT + "{% endif %}"),
    (
        "Advance Health Directive (Living Will)",
        "{% if planning.include_ahd %}Advance Health Directive (Living Will){% endif %}",
    ),
    ("HIPAA Authorization", "{% if planning.include_hipaa %}HIPAA Authorization{% endif %}"),
    ("Personal Property Memorandum", "{% if planning.include_ppm %}Personal Property Memorandum{% endif %}"),
    (
        "⚠ Successor Trustee: No successor trustee has been named",
        "{% if planning.include_trust and fiduciaries.trustee.successor.full_name == '' %}"
        "⚠ Successor Trustee: No successor trustee has been named in the trust. This person would step in "
        "to manage trust assets if {% if has_spouse %}both of you are{% else %}you are{% endif %} unable to serve."
        "{% endif %}",
    ),
    (
        "⚠ Successor Personal Representative: No successor personal representative",
        "{% if (planning.include_pour_over_will or planning.include_simple_will or planning.include_testamentary_trust_will) and fiduciaries.executor.successor.full_name == '' %}"
        "⚠ Successor Personal Representative: No successor personal representative has been named in "
        "{{ client.full_name | name }}'s will."
        "{% endif %}",
    ),
    (
        "⚠ Successor Power of Attorney Agents: No successor agents",
        "{% if planning.include_dpoa and fiduciaries.agent.successor.full_name == '' %}"
        "⚠ Successor Power of Attorney Agent: No successor agent has been named in "
        "{{ client.full_name | name }}'s Durable Power of Attorney."
        "{% endif %}",
    ),
    (
        "⚠ Alternate Health Care Agents: No alternate health care agents",
        "{% if planning.include_hcp and healthcare.agent.alternate.full_name == '' %}"
        "⚠ Alternate Health Care Agent: No alternate health care agent has been named in "
        "{{ client.full_name | name }}'s Health Care Proxy."
        "{% endif %}",
    ),
]

TABLE_HEADER_MARRIED = ["Role", "{{ client.first_name or client.full_name }} — Primary", "{{ spouse.first_name or spouse.full_name }} — Primary", "Successor(s)"]
TABLE_HEADER_SINGLE = ["Role", "{{ client.full_name | name }}", "Successor(s)"]

TABLE_ROWS_MARRIED = [
    [
        "Trustee",
        "{{ fiduciaries.trustee.primary.full_name | name }}",
        "{% if fiduciaries.trustee.co_primary.full_name %}{{ fiduciaries.trustee.co_primary.full_name | name }}{% else %}—{% endif %}",
        "{% if fiduciaries.trustee.successor.full_name %}{{ fiduciaries.trustee.successor.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
    [
        "Personal Representative",
        "{{ fiduciaries.executor.primary.full_name | name }}",
        "{% if fiduciaries.spouse_executor.primary.full_name %}{{ fiduciaries.spouse_executor.primary.full_name | name }}{% else %}—{% endif %}",
        "{% if fiduciaries.executor.successor.full_name %}{{ fiduciaries.executor.successor.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
    [
        "Power of Attorney Agent",
        "{{ fiduciaries.agent.primary.full_name | name }}",
        "{% if fiduciaries.spouse_agent.primary.full_name %}{{ fiduciaries.spouse_agent.primary.full_name | name }}{% else %}—{% endif %}",
        "{% if fiduciaries.agent.successor.full_name %}{{ fiduciaries.agent.successor.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
    [
        "Health Care Agent",
        "{{ healthcare.agent.primary.full_name | name }}",
        "{% if healthcare.spouse_agent.primary.full_name %}{{ healthcare.spouse_agent.primary.full_name | name }}{% else %}—{% endif %}",
        "{% if healthcare.agent.alternate.full_name %}{{ healthcare.agent.alternate.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
]

TABLE_ROWS_SINGLE = [
    [
        "Trustee",
        "{{ fiduciaries.trustee.primary.full_name | name }}",
        "{% if fiduciaries.trustee.successor.full_name %}{{ fiduciaries.trustee.successor.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
    [
        "Personal Representative",
        "{{ fiduciaries.executor.primary.full_name | name }}",
        "{% if fiduciaries.executor.successor.full_name %}{{ fiduciaries.executor.successor.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
    [
        "Power of Attorney Agent",
        "{{ fiduciaries.agent.primary.full_name | name }}",
        "{% if fiduciaries.agent.successor.full_name %}{{ fiduciaries.agent.successor.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
    [
        "Health Care Agent",
        "{{ healthcare.agent.primary.full_name | name }}",
        "{% if healthcare.agent.alternate.full_name %}{{ healthcare.agent.alternate.full_name | name }}{% else %}[NOT PROVIDED]{% endif %}",
    ],
]


def paragraph_text(paragraph: Paragraph) -> str:
    return paragraph.text or ""


def replace_paragraph_text(paragraph: Paragraph, text: str) -> None:
    if not paragraph.runs:
        paragraph.add_run(text)
        return
    paragraph.runs[0].text = text
    for run in paragraph.runs[1:]:
        run.text = ""


def delete_paragraph(paragraph: Paragraph) -> None:
    element = paragraph._element
    parent = element.getparent()
    if parent is not None:
        parent.remove(element)


def set_cell_text(cell, text: str) -> None:
    if not cell.paragraphs:
        cell.text = text
        return
    replace_paragraph_text(cell.paragraphs[0], text)
    for paragraph in cell.paragraphs[1:]:
        delete_paragraph(paragraph)


def convert_paragraphs(document: Document) -> None:
    # Index-specific replacements for paragraphs that share the same prefix text.
    index_replacements: dict[int, str] = {}
    for index, paragraph in enumerate(document.paragraphs):
        text = paragraph_text(paragraph)
        if text == "Successor Agent: [NOT PROVIDED]":
            # First occurrence is client POA; second is spouse POA.
            prior = paragraph_text(document.paragraphs[index - 1]) if index > 0 else ""
            if "Gifts from" in prior or "Agent: Dianyuan" in prior:
                index_replacements[index] = (
                    "{% if has_spouse and planning.spouse_docs and planning.include_dpoa %}"
                    + SPOUSE_POA_SUCCESSOR + "{% endif %}"
                )
            else:
                index_replacements[index] = (
                    "{% if planning.include_dpoa %}" + CLIENT_POA_SUCCESSOR + "{% endif %}"
                )
        elif text == "Alternate Agent: [NOT PROVIDED]":
            prior = paragraph_text(document.paragraphs[index - 1]) if index > 0 else ""
            if "Dan Tang" in prior or "spouse" in prior.lower():
                index_replacements[index] = (
                    "{% if has_spouse and planning.spouse_docs and planning.include_hcp %}"
                    + SPOUSE_HCP_ALTERNATE + "{% endif %}"
                )
            else:
                index_replacements[index] = (
                    "{% if planning.include_hcp %}" + CLIENT_HCP_ALTERNATE + "{% endif %}"
                )

    for index, paragraph in enumerate(document.paragraphs):
        if index in index_replacements:
            replace_paragraph_text(paragraph, index_replacements[index])
            continue

        text = paragraph_text(paragraph)
        for prefix, replacement in PARAGRAPH_REPLACEMENTS:
            if text.startswith(prefix) or text == prefix:
                replace_paragraph_text(paragraph, replacement)
                break

    # Generic name replacements for remaining sample-specific text
    for paragraph in document.paragraphs:
        text = paragraph_text(paragraph)
        if not text or "{{" in text or "{%" in text:
            continue
        converted = (
            text.replace("Dianyuan Wang", "{{ client.full_name | name }}")
            .replace("Dan Tang", "{{ spouse.full_name | name }}")
            .replace("The Wang Family Trust", "{{ trust.name | name }}")
            .replace("Sara Wang", "{% for child in children %}{{ child.full_name | name }}{% if loop.index != loop.length %} and {% endif %}{% endfor %}")
            .replace("Jared Wang", "")
        )
        if converted != text:
            replace_paragraph_text(paragraph, converted)


def convert_table(document: Document) -> None:
    if not document.tables:
        return

    table = document.tables[0]
    # Rebuild table with conditional married vs single layout
    while len(table.rows) > 1:
        table._tbl.remove(table.rows[1]._tr)

    # Header
    header_cells = table.rows[0].cells
    for index, value in enumerate(TABLE_HEADER_MARRIED):
        if index < len(header_cells):
            set_cell_text(header_cells[index], value)

    for row_cells in TABLE_ROWS_MARRIED:
        row = table.add_row()
        for index, value in enumerate(row_cells):
            set_cell_text(row.cells[index], value)


def wrap_inline(document: Document, prefix: str, condition: str) -> None:
    for paragraph in document.paragraphs:
        text = paragraph_text(paragraph)
        if text.startswith(prefix) and not text.startswith("{% if"):
            replace_paragraph_text(paragraph, f"{{% if {condition} %}}{text}{{% endif %}}")


def wrap_static_sections(document: Document) -> None:
    """Wrap explanatory paragraphs that should only show when their parent section is included."""
    trust_prefixes = [
        "Trust Name & Identity",
        "During Your Lifetime",
        "Distribution of Your Estate After You Pass",
        "Primary Beneficiary:",
        "Contingent:",
        "Spendthrift Protection:",
        "Incapacity Standard:",
        "Remarriage Clause:",
        "No-Contest Provision:",
        "Survivorship Requirement:",
        "Your Trustees have broad authority",
        "Important — Fund Your Trust",
    ]
    for prefix in trust_prefixes:
        wrap_inline(document, prefix, "planning.include_trust")

    wrap_inline(document, "A Durable Power of Attorney appoints", "planning.include_dpoa")
    wrap_inline(document, "Gifts from Dianyuan", "planning.include_dpoa")
    wrap_inline(document, "A Health Care Proxy appoints", "planning.include_hcp")
    wrap_inline(
        document,
        "No limitations — full and unlimited discretion given to agent. Dianyuan has elected",
        "planning.include_hcp",
    )
    wrap_inline(document, "Each of you has executed a separate Advance Health Directive", "planning.include_ahd")
    wrap_inline(document, "Comfort care and pain relief are always permitted", "planning.include_ahd")
    wrap_inline(document, "Federal HIPAA regulations restrict", "planning.include_hipaa")
    wrap_inline(document, "Each authorization covers all health information", "planning.include_hipaa")
    wrap_inline(document, "A Personal Property Memorandum allows", "planning.include_ppm")
    wrap_inline(
        document,
        "Each of you may prepare a separate memorandum",
        "planning.include_ppm",
    )


def insert_guardian_section(document: Document) -> None:
    """Repurpose blank spacer paragraphs before Key People for guardian content."""
    for paragraph in document.paragraphs:
        text = paragraph_text(paragraph)
        if text.startswith("A Personal Property Memorandum allows"):
            # Next non-empty after PPM block — use for guardian heading
            continue
    # Replace the paragraph immediately before "Your Key People at a Glance"
    for index, paragraph in enumerate(document.paragraphs):
        if paragraph_text(paragraph).startswith("Your Key People at a Glance") and index > 0:
            replace_paragraph_text(document.paragraphs[index - 1], GUARDIAN_SHORT_TERM)
            if index > 1:
                replace_paragraph_text(document.paragraphs[index - 2], GUARDIAN_BODY)
            if index > 2:
                replace_paragraph_text(document.paragraphs[index - 3], GUARDIAN_HEADING)
            break


def convert_headers(document: Document) -> None:
    header_line = (
        "Estate Plan Summary — "
        + "{% if has_spouse %}"
        + "{{ client.full_name | name }} & {{ spouse.full_name | name }}"
        + "{% else %}"
        + "{{ client.full_name | name }}"
        + "{% endif %}"
    )
    for section in document.sections:
        header = section.header
        if header.paragraphs:
            replace_paragraph_text(header.paragraphs[0], header_line)


def convert() -> None:
    document = Document(SOURCE)
    convert_paragraphs(document)
    wrap_static_sections(document)
    convert_table(document)
    insert_guardian_section(document)
    convert_headers(document)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    document.save(TARGET)
    print(f"Wrote {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    convert()
