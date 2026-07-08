#!/usr/bin/env python3
"""Patch estate-plan DOCX templates with family/disinheritance conditionals."""

from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"


def patch_xml(xml: str) -> str:
    replacements = [
        (
            "{% for child in children %}{{ child.full_name | name }}{% if not loop.last %}, {% endif %}{% endfor %}",
            "{% for child in children %}{{ child.full_name | name }}{% if include_child_gender_markers and child.gender_display %} ({{ child.gender_display }}){% endif %}{% if not loop.last %}, {% endif %}{% endfor %}",
        ),
        (
            ", any child of mine born or adopted after the date of this Last Will and Testament, and the descendants of any such after-born or after adopted child.",
            "{% if include_afterborn_children %}, any child of mine born or adopted after the date of this Last Will and Testament, and the descendants of any such after-born or after adopted child{% endif %}.",
        ),
        (
            "Except as provided in this Article, I have intentionally, and not as a result of any mistake or inadvertence, omitted in this Last Will and Testament to provide for any other children and/or descendants of mine, if any, however defined by law",
            "{% if omissions_intentional %}Except as provided in this Article, I have intentionally, and not as a result of any mistake or inadvertence, omitted in this Last Will and Testament to provide for any other children and/or descendants of mine, if any, however defined by law{% endif %}",
        ),
        (
            "any children later born to or adopted by the Grantor in a legal proceeding valid in the domestic or foreign jurisdiction in which it occurred.",
            "{% if include_afterborn_children %}any children later born to or adopted by the Grantor in a legal proceeding valid in the domestic or foreign jurisdiction in which it occurred.{% endif %}",
        ),
        (
            "{% if trust.disinherited %}The Grantor specifically disinherits {% for person in trust.disinherited %}{{ person.full_name | name }}{% if not loop.last %}, {% endif %}{% endfor %} and their descendants.",
            "{% if trust.disinherited %}The Grantor specifically disinherits {% for person in trust.disinherited %}{{ person.full_name | name }}{% if not loop.last %}, {% endif %}{% endfor %}{% if disinherit_issue %} and their descendants{% endif %}.",
        ),
        (
            "{% if trust.disinherited %}We intentionally have not provided for {% for person in trust.disinherited %}{{ person.full_name | name }}{% if not loop.last %}, {% endif %}{% endfor %} as a beneficiary in this trust; therefore, for all purposes of this trust, each such person will be treated as having predeceased both of us.{% endif %}",
            "{% if trust.disinherited %}We intentionally have not provided for {% for person in trust.disinherited %}{{ person.full_name | name }}{% if not loop.last %}, {% endif %}{% endfor %} as a beneficiary in this trust; therefore, for all purposes of this trust, each such person will be treated as having predeceased both of us{% if disinherit_issue %} without any surviving descendants{% endif %}.{% endif %}{% if family.additional_disinheritance_language %} {{ family.additional_disinheritance_language }}{% endif %}",
        ),
        (
            "Except as otherwise provided in this instrument, the Grantor intentionally disinherits, omits, and does not provide for any other person or persons who claim to be the Grantor's descendants or heirs under any circumstances and without regard to the nature of any evidence which may indicate status as descendants or heirs.  The Grantor acknowledges and understands that, except as otherwise provided in this instrument, the Grantor is generally disinheriting, omitting, and not providing for any person or persons that may qualify as a pretermitted or omitted heir, spouse, or child.",
            "{% if include_general_disinheritance %}Except as otherwise provided in this instrument, the Grantor intentionally disinherits, omits, and does not provide for any other person or persons who claim to be the Grantor's descendants or heirs under any circumstances and without regard to the nature of any evidence which may indicate status as descendants or heirs.  The Grantor acknowledges and understands that, except as otherwise provided in this instrument, the Grantor is generally disinheriting, omitting, and not providing for any person or persons that may qualify as a pretermitted or omitted heir, spouse, or child.{% endif %}",
        ),
        (
            "Except as otherwise provided in this trust, I, {{ client.full_name | name }}, am intentionally disinheriting, omitting, and not providing for any other person or persons who claim to be my descendants or heirs under any circumstances and without regard to the nature of any evidence which may indicate status as descendants or heirs.  I acknowledge and understand that, except as otherwise provided in this trust, I am generally disinheriting, omitting, and not providing for any person or persons that may qualify as a pretermitted or omitted heir, spouse, or child.",
            "{% if include_general_disinheritance %}Except as otherwise provided in this trust, I, {{ client.full_name | name }}, am intentionally disinheriting, omitting, and not providing for any other person or persons who claim to be my descendants or heirs under any circumstances and without regard to the nature of any evidence which may indicate status as descendants or heirs.  I acknowledge and understand that, except as otherwise provided in this trust, I am generally disinheriting, omitting, and not providing for any person or persons that may qualify as a pretermitted or omitted heir, spouse, or child.{% endif %}",
        ),
        (
            "Except as otherwise provided in this trust, I, {{ spouse.full_name | name }}, am intentionally disinheriting, omitting, and not providing for any other person or persons who claim to be my descendants or heirs under any circumstances and without regard to the nature of any evidence which may indicate status as descendants or heirs.  I acknowledge and understand that, except as otherwise provided in this trust, I am generally disinheriting, omitting, and not providing for any person or persons that may qualify as a pretermitted or omitted heir, spouse, or child.",
            "{% if include_general_disinheritance %}Except as otherwise provided in this trust, I, {{ spouse.full_name | name }}, am intentionally disinheriting, omitting, and not providing for any other person or persons who claim to be my descendants or heirs under any circumstances and without regard to the nature of any evidence which may indicate status as descendants or heirs.  I acknowledge and understand that, except as otherwise provided in this trust, I am generally disinheriting, omitting, and not providing for any person or persons that may qualify as a pretermitted or omitted heir, spouse, or child.{% endif %}",
        ),
    ]

    for old, new in replacements:
        xml = xml.replace(old, new)

    if "{% if include_expectant_children %}" not in xml:
        xml = xml.replace(
            "A person legally adopted prior to attaining eighteen (18) years of age shall not be differentiated from blood descendants for any purpose, but a person who is adopted after attaining eighteen (18) years of age shall not be deemed a child or descendant for all purposes hereunder.{% endif %}",
            "A person legally adopted prior to attaining eighteen (18) years of age shall not be differentiated from blood descendants for any purpose, but a person who is adopted after attaining eighteen (18) years of age shall not be deemed a child or descendant for all purposes hereunder.{% if include_expectant_children %} Any posthumous child of mine (in gestation at the time of my death) shall be treated as if explicitly named in this Last Will and Testament.{% endif %}{% endif %}",
        )

    return xml


def patch_docx(path: Path) -> bool:
    with zipfile.ZipFile(path, "r") as zin:
        original = zin.read("word/document.xml").decode("utf-8")
        patched = patch_xml(original)
        if patched == original:
            return False

        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    data = patched.encode("utf-8")
                zout.writestr(item, data)

    path.write_bytes(out.getvalue())
    return True


def main() -> int:
    targets = [
        "pourover-will.docx",
        "joint-trust.docx",
        "trust-individual-single.docx",
    ]
    changed = 0
    for name in targets:
        path = TEMPLATES / name
        if not path.exists():
            print(f"skip missing template: {path}")
            continue
        if patch_docx(path):
            print(f"patched {name}")
            changed += 1
        else:
            print(f"no changes for {name}")
    return 0 if changed >= 0 else 1


if __name__ == "__main__":
    sys.exit(main())
