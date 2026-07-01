import importlib.util
import re
import sys
import unittest
from zipfile import ZipFile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("al_generator", ROOT / "al-generator.py")
al_generator = importlib.util.module_from_spec(SPEC)
sys.modules["al_generator"] = al_generator
SPEC.loader.exec_module(al_generator)


def extract_docx_xml(path):
    with ZipFile(path) as archive:
        return "\n".join(
            archive.read(name).decode("utf-8", errors="ignore")
            for name in archive.namelist()
            if name.startswith("word/") and name.endswith(".xml")
        )


def render_pourover_pr_nomination(executor):
    """Render only the pour-over will's Personal Representative nomination run.

    Pulls the Jinja fragment straight out of the committed template so the test
    exercises the real template logic without needing every other document field.
    """
    with ZipFile(ROOT / "templates" / "pourover-will.docx") as archive:
        document_xml = archive.read("word/document.xml").decode("utf-8")
    match = re.search(
        r"I nominate \{\{ fiduciaries\.executor\.primary.*?Personal Representative\.(?:\{% endif %\})*",
        document_xml,
        re.DOTALL,
    )
    if not match:
        raise AssertionError("Could not locate the PR nomination fragment in pourover-will.docx")
    source = match.group(0)
    data = {"fiduciaries": {"executor": executor}}
    context = al_generator.context_for(data, "MA")
    report = al_generator.GenerationReport(data_file="test", state="MA")
    clauses = al_generator.ClauseStore("MA", report, allow_draft=True)
    return al_generator.render_string(source, context, clauses, fail_fast=True)


class GeneratorTests(unittest.TestCase):
    def test_conditions_detect_minor_children_and_state_rules(self):
        data = al_generator.load_json(ROOT / "examples" / "client.json")
        conditions = al_generator.compute_conditions(data, "MA")

        self.assertIs(conditions["has_spouse"], True)
        self.assertIs(conditions["has_children"], True)
        self.assertIs(conditions["has_minor_children"], True)
        self.assertIs(conditions["requires_guardian_clause"], True)
        self.assertIs(conditions["state_requires_self_proving_affidavit"], True)

    def test_no_minor_children_suppresses_guardian_clause(self):
        data = al_generator.load_json(ROOT / "examples" / "client-ma-pourover-no-minors.json")
        conditions = al_generator.compute_conditions(data, "MA")

        self.assertIs(conditions["has_children"], True)
        self.assertIs(conditions["has_minor_children"], False)
        self.assertIs(conditions["requires_guardian_clause"], False)

    def test_required_field_detection(self):
        data = {"client": {"full_name": "Jane Example"}}

        missing = al_generator.missing_required_fields(
            data,
            ["client.full_name", "client.state", "fiduciaries.executor.primary.full_name"],
        )

        self.assertEqual(missing, ["client.state", "fiduciaries.executor.primary.full_name"])

    def test_scheduled_signing_uses_execution_values(self):
        data = al_generator.load_json(ROOT / "examples" / "client-ma-incapacity.json")
        context = al_generator.context_for(data, "MA")

        self.assertIs(context["signing_scheduled"], True)
        self.assertEqual(context["execution"]["display_doc_date"], "May 21, 2026")
        self.assertEqual(context["execution"]["display_ordinal_doc_date"], "the 21st day of May, 2026")
        self.assertEqual(context["execution"]["display_signing_county"], "Suffolk")
        self.assertEqual(context["execution"]["display_notary_commission"], "January 1, 2030")

    def test_unscheduled_signing_uses_blank_lines(self):
        data = al_generator.load_json(ROOT / "examples" / "client-ma-incapacity-unscheduled.json")
        context = al_generator.context_for(data, "MA")

        self.assertIs(context["signing_scheduled"], False)
        self.assertEqual(context["execution"]["display_doc_date"], "________________, 20__")
        self.assertEqual(context["execution"]["display_ordinal_doc_date"], "_____ day of _________________, 20___")
        self.assertEqual(context["execution"]["display_signing_county"], "__________________________")
        # Empty commission renders nothing (label kept, blank fill line dropped).
        self.assertEqual(context["execution"]["display_notary_commission"], "")

    def test_unknown_trust_date_uses_blank_line(self):
        data = al_generator.load_json(ROOT / "examples" / "client-ma-trust-individual-single.json")
        data["trust"].pop("date")
        context = al_generator.context_for(data, "MA")

        self.assertEqual(context["trust"]["display_date"], "________________, 20___")

    def test_known_trust_date_uses_month_day_year_value(self):
        data = al_generator.load_json(ROOT / "examples" / "client-ma-trust-individual-single.json")
        context = al_generator.context_for(data, "MA")

        self.assertEqual(context["trust"]["display_date"], "May 21, 2026")

    def test_individual_single_trust_template_has_no_bracket_markers(self):
        text = al_generator.extract_docx_text(ROOT / "templates" / "trust-individual-single.docx")

        self.assertNotRegex(text, r"\[[A-Z][A-Z0-9 _/-]*\]")

    def test_joint_trust_template_has_no_bracket_markers(self):
        text = al_generator.extract_docx_text(ROOT / "templates" / "joint-trust.docx")

        self.assertNotRegex(text, r"\[[A-Z][A-Z0-9 _/-]*\]")

    def test_joint_trust_simplified_template_has_no_source_markers(self):
        text = al_generator.extract_docx_text(ROOT / "templates" / "joint-trust-simplified.docx")
        xml = extract_docx_xml(ROOT / "templates" / "joint-trust-simplified.docx")

        self.assertNotRegex(text, r"\[[A-Z][A-Z0-9 _/-]*\]")
        self.assertNotRegex(xml, r"\[[A-Z][A-Z0-9 _/-]*\]")
        self.assertNotIn("CHILD ONE", text)
        self.assertNotIn("CHILD TWO", text)
        self.assertNotIn("CHILD THREE", text)
        self.assertNotIn("SUCCESSOR TRUSTEE", text)
        self.assertNotIn("ALTERNATE SUCCESSOR TRUSTEE", text)
        self.assertNotIn("Option 4a", text)
        self.assertNotIn("Double-Click to Insert Table of Contents", text)
        self.assertNotIn("CHILD ONE", xml)
        self.assertNotIn("CHILD TWO", xml)
        self.assertNotIn("CHILD THREE", xml)
        self.assertNotIn("SUCCESSOR TRUSTEE", xml)
        self.assertNotIn("ALTERNATE SUCCESSOR TRUSTEE", xml)
        self.assertNotIn("Option 4a", xml)
        self.assertNotIn("Double-Click to Insert Table of Contents", xml)


    def test_pourover_single_successor_pr_uses_simple_nomination(self):
        rendered = render_pourover_pr_nomination(
            {
                "primary": {"full_name": "Pat Primary"},
                "successor": {"full_name": "Sam Successor"},
            }
        )

        self.assertIn("I nominate SAM SUCCESSOR, to serve as Personal Representative", rendered)
        self.assertNotIn("in the order named", rendered)
        self.assertNotIn("{", rendered)

    def test_pourover_multiple_successor_prs_are_named_in_order(self):
        rendered = render_pourover_pr_nomination(
            {
                "primary": {"full_name": "Pat Primary"},
                "successor": {"full_name": "Sam Successor"},
                "co_successor": {"full_name": "Cory Co"},
                "second_successor": {"full_name": "Tina Third"},
                "co_second_successor": {"full_name": "Dee Deux"},
            }
        )

        self.assertIn("in the order named", rendered)
        self.assertIn("first, SAM SUCCESSOR and CORY CO", rendered)
        self.assertIn("and second, TINA THIRD and DEE DEUX", rendered)
        self.assertNotIn("{", rendered)

    def test_pourover_pr_nomination_omits_vacancy_clause_without_successor(self):
        rendered = render_pourover_pr_nomination({"primary": {"full_name": "Pat Primary"}})

        self.assertNotIn("In the event of a vacancy", rendered)
        self.assertNotIn("{", rendered)


if __name__ == "__main__":
    unittest.main()
