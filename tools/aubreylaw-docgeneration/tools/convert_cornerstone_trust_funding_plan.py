#!/usr/bin/env python3
"""Convert the Cornerstone trust-funding-plan form into a hybrid generator template.

Deterministic sections (title, asset inventory table, static disclaimers) use Jinja
merge fields. Attorney-specific narrative and checklist rows are injected from
`funding_plan.narrative` and `funding_plan.checklist_items` (typically AI-assisted).
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-forms" / "transfers" / "cornerstone" / "trust-funding-plan_cv1.docx"
TARGET = ROOT / "templates" / "trust-funding-plan.docx"

TITLE_LINE = (
    "{% if spouse.full_name %}"
    "{{ client.full_name | name }} and {{ spouse.full_name | name }}"
    "{% else %}"
    "{{ client.full_name | name }}"
    "{% endif %}\n"
    "TRUST FUNDING RECOMMENDATIONS"
)

INVENTORY_ROW_CELLS = [
    "{{ asset.category_label }}",
    "{{ asset.description }}{% if asset.institution %} — {{ asset.institution }}{% endif %}",
    "{{ asset.owner | default('—') }}",
    "{{ asset.gross_value | default(asset.estimated_value) }}",
    "{{ asset.net_value | default(asset.estimated_value) }}",
]

TOTAL_ROW_CELLS = [
    "TOTAL",
    "All Assets",
    "",
    "{{ assets.total_gross_value }}",
    "{{ assets.total_net_value }}",
]

CHECKLIST_ROW_CELLS = [
    "{{ item.number }}",
    "{{ item.action }}",
    "{{ item.trust }}",
    "{{ item.priority }}",
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


def clone_row_style(table, source_row_index: int, target_row) -> None:
    source_row = table.rows[source_row_index]
    for index, cell in enumerate(target_row.cells):
        source_cell = source_row.cells[index]
        target_tc = cell._tc
        target_tc.getparent().replace(target_tc, deepcopy(source_cell._tc))


def apply_docxtpl_row_loop(table, template_cells: list[str], loop_var: str) -> None:
    """Replace sample data rows with a docxtpl {%tr for %} … {%tr endfor %} block."""
    while len(table.rows) > 2:
        table._tbl.remove(table.rows[1]._tr)

    content_row = table.rows[1]
    for index, value in enumerate(template_cells):
        set_cell_text(content_row.cells[index], value)

    open_tr = deepcopy(content_row._tr)
    content_row._tr.addprevious(open_tr)
    close_tr = deepcopy(content_row._tr)
    content_row._tr.addnext(close_tr)

    open_cells = table.rows[1].cells
    set_cell_text(open_cells[0], f"{{%tr for {loop_var} %}}")
    for index in range(1, len(open_cells)):
        set_cell_text(open_cells[index], "")

    close_cells = table.rows[3].cells
    set_cell_text(close_cells[0], "{%tr endfor %}")
    for index in range(1, len(close_cells)):
        set_cell_text(close_cells[index], "")


def convert_title(document: Document) -> None:
    replace_paragraph_text(document.paragraphs[0], TITLE_LINE)


def convert_inventory_table(document: Document) -> None:
    table = document.tables[0]
    # Drop sample rows, keep header + loop block + TOTAL row.
    while len(table.rows) > 2:
        table._tbl.remove(table.rows[1]._tr)

    apply_docxtpl_row_loop(table, INVENTORY_ROW_CELLS, "asset in assets['items']")

    total_row = table.add_row()
    for index, value in enumerate(TOTAL_ROW_CELLS):
        set_cell_text(total_row.cells[index], value)


def convert_checklist_table(document: Document) -> None:
    table = document.tables[1]
    while len(table.rows) > 2:
        table._tbl.remove(table.rows[1]._tr)

    apply_docxtpl_row_loop(table, CHECKLIST_ROW_CELLS, "item in funding_plan.checklist_items")


def replace_narrative_block(document: Document) -> None:
    start_marker = "Section A — Real Estate"
    end_marker = "Funding Action Checklist"

    start_index = None
    end_index = None
    for index, paragraph in enumerate(document.paragraphs):
        text = paragraph_text(paragraph)
        if start_index is None and text.startswith(start_marker):
            start_index = index
        if text == end_marker:
            end_index = index
            break

    if start_index is None or end_index is None or end_index <= start_index:
        raise RuntimeError("Could not locate narrative block boundaries in trust-funding-plan source")

    for index in range(end_index - 1, start_index - 1, -1):
        delete_paragraph(document.paragraphs[index])

    narrative_paragraph = document.paragraphs[start_index]
    replace_paragraph_text(narrative_paragraph, "{{ funding_plan.narrative | safe }}")


def convert() -> None:
    document = Document(SOURCE)
    convert_title(document)
    convert_inventory_table(document)
    replace_narrative_block(document)
    convert_checklist_table(document)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    document.save(TARGET)
    print(f"Wrote {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    convert()
