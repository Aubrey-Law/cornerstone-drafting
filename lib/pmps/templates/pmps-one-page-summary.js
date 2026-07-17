/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * pmps-one-page-summary.js — One-Page Plan Summary (Client-facing)
 * Usage: require('./pmps-one-page-summary')(data)
 */
'use strict';
const path = require('path');
const shared = require('./_shared');
const {
  docx, TEAL, NAVY, L_TEAL, L_NAVY, GRAY,
  PAGE_PROPS, NUMBERING, noBorders, hdrCell, dataCell, totalCell,
  spacer, sectionHdr, bodyP, bulletP,
  makeHeader, makeFooter, titleBlock, clientNames, fmt
} = shared;

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, ShadingType } = docx;
const fs = require('fs');

module.exports = function generateOnePager(data) {
  const ps = shared.resolvePlanStructure(data);
  const isCouple = ps.isCouple;
  const s1 = data.clients.spouse1;
  const s2 = isCouple ? data.clients.spouse2 : null;
  const names = clientNames(data);
  const hasCreditShelter = ps.hasCreditShelter;
  const s1tax = data.tax && data.tax.scenario1;
  const s2tax = data.tax && data.tax.scenario2;

  // ── TAX SUMMARY TABLE ────────────────────────────────────────────────────────
  let taxTable = null;
  if (s1tax && isCouple) {
    const colHdr2 = hasCreditShelter ? (ps.disclaimer ? "With Disclaimer" : ps.isSeparateTrusts ? "Credit Shelter + Clayton" : "Credit Shelter Trust") : "Current Plan";
    const rows = [
      new TableRow({ cantSplit: true, children: [hdrCell("", 4680), hdrCell("No Planning", 2340), hdrCell(colHdr2, 2340)] }),
      new TableRow({ cantSplit: true, children: [dataCell("Combined Estate", 4680, L_NAVY), dataCell(fmt(s1tax.taxableEstate), 2340, L_NAVY), dataCell(fmt(s1tax.taxableEstate), 2340, L_NAVY)] }),
      new TableRow({ cantSplit: true, children: [dataCell("MA Estate Tax", 4680), dataCell(fmt(s1tax.netTax), 2340), dataCell(hasCreditShelter && s2tax ? fmt(s2tax.totalNetTax) : fmt(s1tax.netTax), 2340)] }),
    ];
    if (hasCreditShelter && s2tax) {
      rows.push(new TableRow({ cantSplit: true, children: [
        dataCell("Exemptions Preserved", 4680, L_NAVY),
        dataCell("One ($2M)", 2340, L_NAVY),
        dataCell("Both ($4M)", 2340, L_NAVY),
      ]}));
    }
    if (hasCreditShelter && s2tax && data.tax.savings > 0) {
      rows.push(new TableRow({ cantSplit: true, children: [
        totalCell("Tax Savings with Planning", 4680),
        new TableCell({ columnSpan: 2, width: { size: 4680, type: WidthType.DXA },
          shading: { fill: TEAL, type: ShadingType.CLEAR }, borders: noBorders(),
          margins: { top: 80, bottom: 80, left: 140, right: 140 },
          children: [new Paragraph({ children: [new TextRun({ text: fmt(data.tax.savings), font: "Garamond", size: 20, bold: true, color: "FFFFFF" })] })]
        })
      ]}));
    }
    taxTable = new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 2340, 2340], rows });
  } else if (s1tax && !isCouple) {
    const rows = [
      new TableRow({ cantSplit: true, children: [hdrCell("", 5760), hdrCell("Amount", 3600)] }),
      new TableRow({ cantSplit: true, children: [dataCell("Taxable Estate", 5760, L_NAVY), dataCell(fmt(s1tax.taxableEstate), 3600, L_NAVY)] }),
      new TableRow({ cantSplit: true, children: [dataCell("MA Exemption", 5760), dataCell("$2,000,000", 3600)] }),
      new TableRow({ cantSplit: true, children: [totalCell("MA Estate Tax", 5760), totalCell(fmt(s1tax.netTax), 3600)] }),
    ];
    taxTable = new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [5760, 3600], rows });
  }

  // ── DOCUMENT LIST TABLE ──────────────────────────────────────────────────────
  function metlifeCode(name) {
    if (/trust/i.test(name)) return "260";
    if (/will/i.test(name) && !/trust/i.test(name)) return "200";
    if (/advance health|living will/i.test(name)) return "220";
    return "220";
  }

  const colWidths = data.hasLegalPlan ? [5760, 2000, 1600] : [7360, 2000];
  const docHdr = data.hasLegalPlan
    ? [hdrCell("Document", 5760), hdrCell("For", 2000), hdrCell("MetLife", 1600)]
    : [hdrCell("Document", 7360), hdrCell("For", 2000)];

  const docRows = [new TableRow({ cantSplit: true, children: docHdr })];
  let rowIdx = 0;
  (data.plan.documents || []).forEach(d => {
    const bg = rowIdx % 2 === 0 ? L_TEAL : GRAY;
    const forLabel = d.joint ? "Joint"
      : (d.forSpouse === 1 ? s1.firstName
      : (d.forSpouse === 2 && s2 ? s2.firstName
      : (isCouple && d.perSpouse ? "Each Spouse" : s1.firstName)));
    if (data.hasLegalPlan) {
      docRows.push(new TableRow({ cantSplit: true, children: [
        dataCell(d.name, 5760, bg, d.joint),
        dataCell(forLabel, 2000, bg),
        dataCell(metlifeCode(d.name), 1600, bg),
      ]}));
    } else {
      docRows.push(new TableRow({ cantSplit: true, children: [
        dataCell(d.name, 7360, bg, d.joint),
        dataCell(forLabel, 2000, bg),
      ]}));
    }
    rowIdx++;
  });

  // Total row
  if (data.hasLegalPlan) {
    const hasTrust = (data.plan.documents || []).some(d => /trust/i.test(d.name));
    const willDoc = (data.plan.documents || []).find(d => /will/i.test(d.name) && !/trust/i.test(d.name));
    const livingWill = (data.plan.documents || []).find(d => /advance health|living will/i.test(d.name));
    let est = 0;
    if (hasTrust) est += isCouple ? 400 : 325;
    if (willDoc) est += isCouple ? 185 : 150;
    est += isCouple ? 255 : 135;
    if (livingWill) est += isCouple ? 65 : 45;
    docRows.push(new TableRow({ cantSplit: true, children: [
      totalCell("Estimated MetLife Total", 5760, NAVY),
      new TableCell({ width: { size: 2000, type: WidthType.DXA }, shading: { fill: NAVY, type: ShadingType.CLEAR }, borders: noBorders(), margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: "", size: 20, font: "Garamond" })] })] }),
      totalCell(`~$${est}*`, 1600, TEAL),
    ]}));
  } else {
    docRows.push(new TableRow({ cantSplit: true, children: [
      totalCell("Plan Total (Flat Fee)", 7360, NAVY),
      totalCell(data.flatFee || "[confirm]", 2000, TEAL),
    ]}));
  }
  const docTable = new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: colWidths, rows: docRows });

  // ── NEXT STEPS ───────────────────────────────────────────────────────────────
  const nextSteps = [
    "Sign your Engagement Agreement (we will email it to you).",
    "Complete the design phase — we will gather your fiduciary appointments.",
    "Receive draft documents for review within 2–3 weeks.",
    "Attend your signing ceremony (in-person, with notary and witnesses).",
    "Receive your Funding Roadmap and complete trust funding.",
  ];

  // ── ASSEMBLE ─────────────────────────────────────────────────────────────────
  const children = [];

  if (taxTable) {
    children.push(sectionHdr("MA Estate Tax" + (isCouple && hasCreditShelter ? " Comparison" : " Summary")));
    children.push(taxTable);
    if (data.hasLegalPlan) children.push(spacer(40));
    if (data.hasLegalPlan) children.push(bodyP("* Billing estimate. MetLife coverage for tax-planning trusts may require case manager approval.", { italics: true, size: 16, color: "000000" }));
  }

  children.push(spacer(160));
  children.push(sectionHdr("Your Estate Plan Documents"));
  children.push(docTable);
  if (data.hasLegalPlan) {
    children.push(spacer(40));
    children.push(bodyP("* MetLife billing estimate. HCP billed as Medical POA; HIPAA as Medical Information POA. Coverage subject to plan terms.", { italics: true, size: 16, color: "000000" }));
  }

  children.push(spacer(160));
  children.push(sectionHdr("Next Steps"));
  nextSteps.forEach(s => children.push(bulletP(s)));

  const doc = new Document({
    numbering: NUMBERING,
    sections: [{
      properties: PAGE_PROPS,
      headers: { default: makeHeader() },
      // Keep the legal-review notice in the footer so this remains a true one-page summary.
      footers: { default: makeFooter("Estate Plan Summary — Discussion draft; attorney review required") },
      children: [
        ...titleBlock("ESTATE PLAN SUMMARY", `${names}  |  ${data.plan.type || "Estate Plan"}`, `${data.matter.date}`),
        ...children
      ]
    }]
  });

  return Packer.toBuffer(doc);
};
