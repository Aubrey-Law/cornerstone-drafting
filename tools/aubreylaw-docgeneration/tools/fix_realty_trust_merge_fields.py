#!/usr/bin/env python3
"""Normalise the realty-trust template's merge fields onto the computed-field
convention already used by the cornerstone deed templates.

The realty trust was converted from `source-forms/trust/cornerstone/Realty Trust.docx`
before the deed templates settled on computed fields (`{document_date_blank}`,
`{signing_county}`, `{trustee_title}`, `{notary_commission_blank}`). This script
brings it in line and repairs placeholders Word split across runs.

Run from `tools/aubreylaw-docgeneration`:

    python3 tools/fix_realty_trust_merge_fields.py [templates/real-estate-trust.docx]

The script is idempotent: re-running it on an already-corrected template is a
no-op (every rule reports zero replacements and the file is left untouched).
"""

from __future__ import annotations

import re
import shutil
import sys
import zipfile
from html import escape, unescape
from pathlib import Path

# Parts docxtemplater renders. Headers/footers carry the trust-name running head.
BODY_PART = re.compile(r"word/(document|header\d*|footer\d*)\.xml$")
PARA = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>", re.S)
TEXT_NODE = re.compile(r"(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)", re.S)

# Every field these rules introduce is produced by `fieldsToTemplateData`
# in lib/realEstateTransfer/fields.ts.
#
# `{execution_date}` and `{certificate_execution_county}` are deed-section keys
# that the Real Estate Transfer workflow never collects: `execution_date` sits in
# LEGACY_DEED_FIELDS (hidden from the form) and neither is set by
# `buildTemplateFields`, so both render empty on every generated realty trust.
SUBSTRING_RULES: list[tuple[str, str, int]] = [
    # (find, replace, expected occurrences)
    ("dated this {execution_date},", "dated this {document_date_blank},", 1),
    ("On this {execution_date} , before me", "On {document_date_blank}, before me", 4),
    ("dated the {execution_date} (", "dated {document_date_blank} (", 1),
    (
        "sealed instrument this {execution_date}",
        "sealed instrument this {document_date_blank}",
        1,
    ),
    ("{certificate_execution_county}", "{signing_county}", 4),
    # Double space before the comma is in the source form.
    ("{trustees}  , Trustee of ", "{trustees}, {trustee_title} of ", 2),
]

# Matched against a whole text node so they cannot clobber the substring rules
# above (e.g. "{trustees}, Trustee(s) and/or Beneficiary(ies) ...").
WHOLE_NODE_RULES: list[tuple[str, str, int]] = [
    ("{trustees}, Trustee", "{trustees}, {trustee_title}", 4),
    ("Expires:", "Expires: {notary_commission_blank}", 4),
]


def merge_split_placeholders(paragraph: str) -> tuple[str, int]:
    """Collapse a `{field}` that Word spread across sibling runs into one node.

    docxtemplater tolerates split placeholders, but they break every text-level
    search (including this script's rules) and silently rot when the template is
    next edited in Word.
    """
    nodes = list(TEXT_NODE.finditer(paragraph))
    if not nodes:
        return paragraph, 0

    placeholder = re.compile(r"\{[^{}]*\}")
    joined = "".join(unescape(node.group(2)) for node in nodes)

    whole_in_paragraph = len(placeholder.findall(joined))
    whole_in_nodes = sum(
        len(placeholder.findall(unescape(node.group(2)))) for node in nodes
    )
    if whole_in_paragraph == whole_in_nodes:
        return paragraph, 0  # every placeholder already sits in a single node

    # Put the paragraph's full text in the first node and blank the rest. Safe
    # here because split placeholders only occur in uniformly formatted runs
    # (the footer running head); mixed-format paragraphs keep their fields whole.
    out = []
    last = 0
    for index, node in enumerate(nodes):
        out.append(paragraph[last : node.start()])
        open_tag = node.group(1)
        if 'xml:space="preserve"' not in open_tag:
            open_tag = open_tag[:-1] + ' xml:space="preserve">'
        body = escape(joined, quote=False) if index == 0 else ""
        out.append(open_tag + body + node.group(3))
        last = node.end()
    out.append(paragraph[last:])
    return "".join(out), 1


def apply_rules(xml: str, counts: dict[str, int]) -> str:
    def fix_paragraph(match: re.Match[str]) -> str:
        paragraph, merged = merge_split_placeholders(match.group(0))
        counts["<merged split placeholder>"] = counts.get("<merged split placeholder>", 0) + merged

        def fix_node(node: re.Match[str]) -> str:
            text = unescape(node.group(2))
            for find, replace, _ in SUBSTRING_RULES:
                if find in text:
                    counts[find] = counts.get(find, 0) + text.count(find)
                    text = text.replace(find, replace)
            for find, replace, _ in WHOLE_NODE_RULES:
                if text == find:
                    counts[find] = counts.get(find, 0) + 1
                    text = replace
            open_tag = node.group(1)
            if text != unescape(node.group(2)) and 'xml:space="preserve"' not in open_tag:
                open_tag = open_tag[:-1] + ' xml:space="preserve">'
            return open_tag + escape(text, quote=False) + node.group(3)

        return TEXT_NODE.sub(fix_node, paragraph)

    return PARA.sub(fix_paragraph, xml)


def main() -> int:
    default = Path(__file__).resolve().parents[1] / "templates" / "real-estate-trust.docx"
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    if not target.exists():
        print(f"Template not found: {target}", file=sys.stderr)
        return 1

    counts: dict[str, int] = {}
    source = zipfile.ZipFile(target)
    entries = [(item, source.read(item.filename)) for item in source.infolist()]
    source.close()

    rewritten = []
    for item, data in entries:
        if BODY_PART.match(item.filename):
            data = apply_rules(data.decode("utf8"), counts).encode("utf8")
        rewritten.append((item, data))

    total = sum(counts.values())
    for find, _, expected in SUBSTRING_RULES + WHOLE_NODE_RULES:
        found = counts.get(find, 0)
        flag = "ok" if found in (expected, 0) else "UNEXPECTED"
        print(f"  {found:>2} / {expected:>2} {flag:<10} {find}")
    print(f"  {counts.get('<merged split placeholder>', 0):>2}      split placeholders merged")

    if total == 0:
        print("Template already normalised; nothing written.")
        return 0

    shutil.copy2(target, target.with_suffix(".docx.bak"))
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out:
        for item, data in rewritten:
            out.writestr(item, data)
    Path(target.with_suffix(".docx.bak")).unlink()
    print(f"Wrote {target} ({total} replacements).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
