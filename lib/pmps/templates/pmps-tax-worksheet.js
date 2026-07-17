/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * pmps-tax-worksheet.js — MA Estate Tax Worksheet (Attorney-only)
 * Usage: require('./pmps-tax-worksheet')(data)
 */
'use strict';
const path = require('path');
const shared = require('./_shared');
const {
  docx, TEAL, NAVY, L_TEAL, L_NAVY, GRAY,
  PAGE_PROPS, NUMBERING, noBorders, hdrCell, dataCell, totalCell,
  spacer, sectionHdr, bodyP,
  makeHeader, makeFooter, titleBlock, clientNames, fmt
} = shared;

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, ShadingType } = docx;
const fs = require('fs');

module.exports = function generateTaxWorksheet(data) {
  const ps = shared.resolvePlanStructure(data);
  const isCouple = ps.isCouple;
  const names = clientNames(data);
  const s1tax = data.tax && data.tax.scenario1;
  const s2tax = data.tax && data.tax.scenario2;
  const hasCreditShelter = ps.hasCreditShelter && s2tax;

  function wRow(label, value, bg = "FFFFFF", bold = false) {
    return new TableRow({ children: [
      dataCell(label, 5760, bg, bold, bold ? NAVY : "444444"),
      dataCell(value, 3600, bg, bold, bold ? NAVY : "333333"),
    ]});
  }
  function wHdr(l1, l2) { return new TableRow({ children: [hdrCell(l1, 5760), hdrCell(l2, 3600)] }); }
  function wTotal(label, value, bg = TEAL) {
    return new TableRow({ children: [totalCell(label, 5760, bg), totalCell(value, 3600, bg)] });
  }

  function computationTable(tax, title) {
    if (!tax) return [];
    return [
      new Paragraph({ children: [new TextRun({ text: title, font: "Garamond", size: 24, bold: true, color: NAVY })], spacing: { before: 80, after: 80 } }),
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [5760, 3600],
        rows: [
          wHdr("Computation Step", "Amount"),
          wRow("Gross / Taxable Estate", fmt(tax.taxableEstate), L_NAVY),
          wRow("Less: Statutory Adjustment", "−$60,000"),
          wRow("= Adjusted Taxable Estate", fmt(tax.adjustedTaxableEstate), L_NAVY, true),
          wRow("Rate Bracket Floor", fmt(tax.bracketFloor)),
          wRow("Base Tax at Bracket Floor", fmt(tax.baseTax), L_NAVY),
          wRow("Excess Above Floor", fmt(tax.excess)),
          wRow("Rate on Excess", (tax.bracketRate * 100).toFixed(1) + "%", L_NAVY),
          wRow("Tax on Excess", fmt(tax.taxOnExcess)),
          wRow("= Gross Tax", fmt(tax.grossTax), L_NAVY, true),
          wRow("Less: Unified Credit", "−$99,600"),
          wTotal("= Net MA Estate Tax", fmt(tax.netTax)),
        ]
      }),
      spacer(120)
    ];
  }

  // Key facts table
  const keyFacts = new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [5760, 3600],
    rows: [
      wRow("Gross / Taxable Estate", data.assets.grossEstateDisplay || fmt(s1tax ? s1tax.taxableEstate : 0), L_NAVY, true),
      wRow("MA Exemption per Person", "$2,000,000"),
      wRow("Portability", isCouple ? "None — use it or lose it per spouse" : "N/A — individual client"),
      wRow("Unified Credit", "$99,600"),
      wRow("Statutory Adjustment", "−$60,000 from taxable estate"),
      wRow("Planning Recommendation", hasCreditShelter ? "Credit Shelter Trust — recommended" : (isCouple ? "Monitor estate growth" : "Revocable Trust — no credit shelter applicable"), L_TEAL, true),
    ]
  });

  const body = [
    sectionHdr("Key Facts"),
    keyFacts,
    spacer(200),
  ];

  if (s1tax) {
    if (isCouple) {
      body.push(sectionHdr("Scenario 1: Without Credit Shelter Planning"));
      body.push(bodyP("All assets pass to surviving spouse at first death (unlimited marital deduction → $0 tax at first death). First spouse's $2M exemption is wasted. At second death, the full estate is taxed."));
      body.push(spacer(80));
      body.push(...computationTable(s1tax, "Second Death — Full Estate Taxed"));
    } else {
      body.push(sectionHdr("Estate Tax at Death"));
      body.push(bodyP("The following computation shows your Massachusetts estate tax exposure based on the current value of your estate."));
      body.push(spacer(80));
      body.push(...computationTable(s1tax, "Tax at Death"));
    }
  }

  if (hasCreditShelter && s2tax) {
    const s2Heading = ps.disclaimer ? "Scenario 2: With Disclaimer Planning"
                    : ps.isSeparateTrusts ? "Scenario 2: With Credit Shelter + Clayton Election"
                    : "Scenario 2: With Credit Shelter Trust";
    body.push(sectionHdr(s2Heading));
    const s2Intro = ps.disclaimer
      ? "At the first death, the surviving spouse disclaims $2,000,000 into a Bypass Trust within nine months, capturing the first spouse's exemption. The unified credit fully offsets the tax on $2M ($0 tax at first death). Combined with the survivor's own $2,000,000 exemption, $4,000,000 total is sheltered; only the remaining estate is taxed at the second death. NOTE: contingent on a valid, timely disclaimer."
      : ps.isSeparateTrusts
        ? "At the first death, a Clayton election (fiduciary-controlled) funds the Credit Shelter (Bypass) Trust with $2,000,000, capturing the first spouse's exemption. The unified credit fully offsets the tax on $2M ($0 tax at first death). Combined with the survivor's own $2,000,000 exemption, $4,000,000 total is sheltered; only the remaining estate is taxed at the second death."
        : "At the first death, $2,000,000 passes to a Bypass Trust. The unified credit fully offsets the tax on $2M, resulting in $0 tax at first death. Combined with the surviving spouse's own $2,000,000 exemption, $4,000,000 total is sheltered; only the remaining estate is taxed at the second death.";
    body.push(bodyP(s2Intro));
    body.push(spacer(80));

    // Step A — First death
    body.push(new Paragraph({ children: [new TextRun({ text: "Step A — First Death (Bypass Trust Funding)", font: "Garamond", size: 22, bold: true, color: NAVY })], spacing: { before: 80, after: 60 } }));
    body.push(new Table({
      width: { size: 9360, type: WidthType.DXA }, columnWidths: [5760, 3600],
      rows: [
        wHdr("Computation Step", "Amount"),
        wRow("Amount to Bypass Trust", fmt(s2tax.firstDeath.bypassAmount), L_NAVY),
        wRow("Gross Tax on $2,000,000", fmt(s2tax.firstDeath.grossTax)),
        wRow("Less: Unified Credit", "−$99,600", L_NAVY),
        wTotal("= Net MA Estate Tax (First Death)", fmt(s2tax.firstDeath.netTax)),
      ]
    }));
    body.push(spacer(120));

    // Step B — Second death
    body.push(new Paragraph({ children: [new TextRun({ text: "Step B — Second Death (Surviving Spouse's Estate)", font: "Garamond", size: 22, bold: true, color: NAVY })], spacing: { before: 80, after: 60 } }));
    body.push(...computationTable(s2tax.secondDeath, ""));
  }

  // Comparison summary (couples only)
  if (s1tax && isCouple) {
    body.push(sectionHdr("Comparison Summary"));
    const savingsGreen = "1A6B30";
    body.push(new Table({
      width: { size: 9360, type: WidthType.DXA }, columnWidths: [5760, 3600],
      rows: [
        wHdr("", "MA Estate Tax"),
        wRow(hasCreditShelter ? "Scenario 1: Without Credit Shelter" : "Current Estate Tax Exposure", fmt(s1tax.netTax), L_NAVY),
        ...(hasCreditShelter && s2tax ? [
          wRow("Scenario 2: With Credit Shelter Trust", fmt(s2tax.totalNetTax)),
          new TableRow({ children: [
            totalCell("Tax Savings with Credit Shelter Planning", 5760, savingsGreen),
            totalCell(fmt(data.tax.savings), 3600, savingsGreen),
          ]})
        ] : [])
      ]
    }));
  }

  // ── MA-specific planning notes (attorney-facing) ────────────────────────────
  if (ps.maQtip || ps.isSeparateTrusts) {
    body.push(spacer(160));
    body.push(sectionHdr("Massachusetts QTIP & Election Coordination"));
    body.push(bodyP("Massachusetts allows a state-only QTIP election independent of the federal QTIP election (TIR 86-4; M.G.L. c. 65C). This permits preservation of the first decedent's Massachusetts exemption even where no federal election is made or required."));
    if (ps.isSeparateTrusts) {
      body.push(bodyP("Clayton election: the credit-shelter/marital division is fiduciary-controlled, decided at the first death based on then-current law and asset values. Coordinate the federal and Massachusetts-only QTIP elections deliberately. Per Shaffer v. Commissioner of Revenue, SJC-12812 (2020), a Massachusetts-only QTIP election made without a corresponding federal election (or vice versa) can produce results the SJC has scrutinized — document the intended election and its rationale in the file at the first death."));
    } else if (ps.disclaimer) {
      body.push(bodyP("Disclaimer route: the Massachusetts-only QTIP election interacts with the survivor's disclaimer. Confirm the disclaimer is qualified (9-month window, no acceptance of benefits/control) before relying on the state QTIP treatment. See Shaffer, SJC-12812 (2020)."));
    }
  }
  // §35 out-of-state property
  const has35 = !!(data.considerations && (data.considerations.outOfStateProperty || data.considerations.businessInterest)) ||
    (Array.isArray(data.flags) && data.flags.some(f => /out-of-state|situs|business interest/i.test(f)));
  if (has35) {
    body.push(spacer(120));
    body.push(sectionHdr("Out-of-State Property — §35 Situs Review"));
    body.push(bodyP("Under 2025 Mass. Acts Ch. 9, §35, the Massachusetts estate tax on an estate holding property situated outside Massachusetts is computed with a proportional adjustment for the out-of-state property. Flag illiquid business interests for situs review — entity type, where the business operates, and where its assets are located all affect the apportionment and can materially change the Massachusetts result."));
  }

  body.push(spacer(200));
  body.push(new Paragraph({
    children: [new TextRun({ text: "CONFIDENTIAL — ATTORNEY USE ONLY  |  Tax computations reflect current MA law. For planning purposes only; not legal or tax advice.", font: "Garamond", size: 16, color: "AAAAAA", italics: true })],
    alignment: AlignmentType.CENTER
  }));

  const doc = new Document({
    numbering: NUMBERING,
    sections: [{
      properties: PAGE_PROPS,
      headers: { default: makeHeader() },
      footers: { default: makeFooter("MA Estate Tax Worksheet — Confidential") },
      children: [
        ...titleBlock("MA ESTATE TAX WORKSHEET", `${names}  |  ${data.matter.date}`, "Confidential — Attorney Use Only"),
        ...body
      ]
    }]
  });

  return Packer.toBuffer(doc);
};
