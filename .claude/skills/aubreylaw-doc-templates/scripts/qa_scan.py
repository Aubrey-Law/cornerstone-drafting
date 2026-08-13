#!/usr/bin/env python3
"""
QA scanner for Aubrey Law generated estate-planning documents.

The template guide's QA checklist requires that a *generated* DOCX (the output
of the generator, not the template itself) contain no leftover merge syntax,
no source-form bracket markers, and no hidden Word field instructions. Several
of those checks are easy to get wrong by eyeballing the rendered text -- Word
field-instruction codes (the w:instrText runs behind a { MERGEFIELD ... } or
similar) are invisible in the normal document view, so this script unzips the
DOCX and inspects the raw XML as well as the extracted text.

Usage:
    python qa_scan.py path/to/generated.docx [more.docx ...]

Exit code is non-zero if any document has findings, so it can gate a workflow.

This scans GENERATED OUTPUT. Templates legitimately contain {{ }} and {% %};
do not run this against an un-rendered template and treat the hits as failures.
"""

import re
import sys
import zipfile
from pathlib import Path

# Patterns that should never appear in a finished, fully-rendered document.
TEXT_PATTERNS = {
    "unrendered_variable": re.compile(r"\{\{.*?\}\}"),
    "unrendered_logic": re.compile(r"\{%.*?%\}"),
    "missing_field_marker": re.compile(r"\[\[\s*MISSING:.*?\]\]"),
    "optional_marker": re.compile(r"\[OPTIONAL\]", re.IGNORECASE),
    # Source-form style ALL-CAPS bracket placeholders, e.g. [CLIENT], [DATE],
    # [TRUSTEE NAME]. Deliberately narrow so ordinary bracketed prose like
    # "[sic]" or a citation does not trip it.
    "source_form_bracket": re.compile(r"\[[A-Z][A-Z0-9 _/]{1,40}\]"),
}

# Bracket tokens that are legitimate document text, not leftover source-form
# markers. Kept in parity with LITERAL_BRACKET_TOKENS in
# lib/drafting/docxMarkerPatterns.ts (the in-app scanner).
LITERAL_BRACKET_TOKENS = {"[DNR]", "[CPR]"}

# Hidden Word field instruction text lives in <w:instrText> runs. A finished
# generated document from this pipeline should not carry MERGEFIELD / REF /
# IF field codes -- those indicate the source form's native Word fields were
# never converted to canonical merge fields.
INSTR_TEXT = re.compile(r"<w:instrText[^>]*>(.*?)</w:instrText>", re.DOTALL)
FIELD_CODE = re.compile(r"\b(MERGEFIELD|REF|IF|DOCVARIABLE|FILLIN|ASK)\b")


def extract_text(docx_path: Path) -> str:
    """Return concatenated paragraph text from the main document part."""
    with zipfile.ZipFile(docx_path) as z:
        try:
            xml = z.read("word/document.xml").decode("utf-8", errors="replace")
        except KeyError:
            return ""
    # Strip tags to approximate visible text. Good enough for marker scanning;
    # we are looking for literal substrings, not doing layout analysis.
    text = re.sub(r"<[^>]+>", "", xml)
    # Word splits runs, so collapse whitespace to catch markers spanning runs
    # only loosely -- markers split across runs are rare but we also scan raw
    # XML below, which catches the field-code case that matters most.
    return text


def raw_xml_parts(docx_path: Path):
    """Yield (part_name, xml) for document, headers, and footers."""
    with zipfile.ZipFile(docx_path) as z:
        for name in z.namelist():
            if re.match(r"word/(document|header\d*|footer\d*)\.xml$", name):
                yield name, z.read(name).decode("utf-8", errors="replace")


def scan_one(docx_path: Path):
    findings = []

    text = extract_text(docx_path)
    for label, pattern in TEXT_PATTERNS.items():
        for m in pattern.findall(text):
            snippet = m if isinstance(m, str) else m[0]
            if label == "source_form_bracket" and snippet.strip() in LITERAL_BRACKET_TOKENS:
                continue
            findings.append((label, snippet.strip()[:120]))

    # Hidden field instructions across document, headers, footers.
    for part, xml in raw_xml_parts(docx_path):
        for instr in INSTR_TEXT.findall(xml):
            if FIELD_CODE.search(instr):
                findings.append(
                    ("hidden_word_field_instruction", f"{part}: {instr.strip()[:120]}")
                )

    return findings


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2

    any_findings = False
    for arg in argv[1:]:
        path = Path(arg)
        if not path.exists():
            print(f"  SKIP  {path} (not found)")
            continue
        findings = scan_one(path)
        if not findings:
            print(f"  CLEAN {path}")
            continue
        any_findings = True
        print(f"  FOUND {len(findings)} issue(s) in {path}")
        # De-duplicate while preserving order.
        seen = set()
        for label, snippet in findings:
            key = (label, snippet)
            if key in seen:
                continue
            seen.add(key)
            print(f"        [{label}] {snippet}")

    return 1 if any_findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
