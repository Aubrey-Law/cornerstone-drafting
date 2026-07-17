/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * pmps-proposal.js — Estate Plan Proposal (Client-facing)
 *
 * Generates the comprehensive client-facing Estate Plan Proposal in Aubrey
 * Law format. Structure mirrors the firm's reference proposal:
 *   1. Cover page (Title block + CONFIDENTIAL banner)
 *   2. Executive Summary
 *   3. Client Profile + Children
 *   4. Financial Overview
 *   5. Estate Tax Analysis (MA + optional Federal + Additional Strategies)
 *   6. Recommended Estate Plan (Core Trust / Will / Incapacity / Asset Transfer / Guardian)
 *   7. Fiduciary Appointments (with multiple successor levels)
 *   8. Key Trust Provisions (Distribution / Pet Trust)
 *   9. Additional Considerations
 *  10. Estate Plan Summary (numbered ✓-mark document table)
 *  11. Process & Timeline
 *
 * Usage: require('./pmps-proposal')(data)
 */

'use strict';
const path = require('path');
const fs = require('fs');
const shared = require('./_shared');
const {
  docx, TEAL, NAVY, L_TEAL, L_NAVY, GRAY, BLACK, PINK_BG,
  PAGE_PROPS, NUMBERING, noBorders, thinBorders,
  hdrCell, dataCell, totalCell,
  spacer, sectionHdr, subSectionHdr, bodyP, bulletP, numP, subBulletP,
  labeledP, labeledBullet,
  makeHeaderProposal, makeFooterProposal,
  titleBlockCover, clientNames, clientIdentifier, fmt
} = shared;

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, ShadingType, BorderStyle, VerticalAlign, PageBreak
} = docx;

// ── FIRM CONFIG (edit defaults here) ─────────────────────────────────────────
const FIRM_CONFIG = {
  // Federal estate tax section appears when gross estate exceeds this threshold
  // (current TCJA sunset would bring exemption down to ~$7M after Dec 31, 2025)
  FEDERAL_SECTION_THRESHOLD: 7000000,

  // Optional Services table — standard add-ons offered to all clients.
  // Override per-matter by setting data.optionalServices (same shape).
  OPTIONAL_SERVICES: [
    { name: "Credit Shelter Estate Planning",
      description: "Separate trusts for each spouse to preserve both Massachusetts exemptions",
      fee: "$2,500", status: "Recommended" },
    { name: "Real Property Transfer",
      description: "Quitclaim deed to transfer home into trust",
      fee: "$350", status: "Recommended" },
    { name: "Attorney-Supervised Signing",
      description: "In-person signing",
      fee: "$375", status: "Optional" }
  ],

  // Process & Timeline — standard 6-step firm process.
  // Override per-matter by setting data.processTimeline (same shape).
  PROCESS_TIMELINE: [
    { step: "1", phase: "Design",                  description: "Attorney prepares final design sheet",                      timeline: "1 week" },
    { step: "2", phase: "Drafting",                description: "All documents prepared",                                    timeline: "2–3 weeks" },
    { step: "3", phase: "Client Review/Revisions", description: "Review all drafts, provide feedback and incorporate changes", timeline: "1–2 weeks" }
  ],

  // MA estate tax structure — used in Massachusetts Estate Tax descriptive prose
  MA_EXEMPTION_DISPLAY: "$2 million",
  MA_EXEMPTION_NUM: 2000000,
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

/** Right-aligned numeric data cell (used in Financial Overview). */
function dataCellRight(text, width, bg = "FFFFFF", bold = false, color = BLACK) {
  return dataCell(text, width, bg, bold, color, { alignment: AlignmentType.RIGHT });
}

/** Center-aligned data cell (used for ✓ marks in Estate Plan Summary). */
function dataCellCenter(text, width, bg = "FFFFFF", bold = false, color = BLACK) {
  return dataCell(text, width, bg, bold, color, { alignment: AlignmentType.CENTER });
}

/** Italic small note cell (for sub-text inside a tax-table cell, e.g. "(exemption wasted)"). */
function noteCell(text, width, bg = "FFFFFF", color = BLACK, alignment = AlignmentType.CENTER) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    borders: thinBorders(),
    margins: { top: 80, bottom: 80, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      keepNext: true, keepLines: true,
      alignment,
      children: [new TextRun({
        text, font: "Garamond", size: 18, italics: true, color
      })]
    })]
  });
}

/** Cell with two lines: main value (bold) + small italic note below. */
function dataCellWithNote(mainText, noteText, width, bg = "FFFFFF", bold = true, mainColor = BLACK, alignment = AlignmentType.RIGHT) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    borders: thinBorders(),
    margins: { top: 80, bottom: 80, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        keepNext: true, keepLines: true,
        alignment,
        children: [new TextRun({ text: mainText, font: "Garamond", size: 20, bold, color: mainColor })]
      }),
      new Paragraph({
        keepNext: true, keepLines: true,
        alignment,
        children: [new TextRun({ text: noteText, font: "Garamond", size: 16, italics: true, color: BLACK })]
      })
    ]
  });
}

/** Build a TableRow with cantSplit always true (Scott's rule: tables can't split pages). */
function tRow(cells) {
  return new TableRow({ cantSplit: true, children: cells });
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

module.exports = function generateProposal(data) {
  // ── DERIVED FLAGS ──────────────────────────────────────────────────────────
  const ps = shared.resolvePlanStructure(data);
  const isCouple = ps.isCouple;
  const s1 = data.clients.spouse1;
  const s2 = isCouple ? data.clients.spouse2 : null;
  const names = clientNames(data);
  const hasCreditShelter = ps.hasCreditShelter;
  const s1tax = data.tax && data.tax.scenario1;
  const s2tax = data.tax && data.tax.scenario2;
  const fid1 = shared.normalizeFiduciary(data.fiduciaries && data.fiduciaries.spouse1);
  const fid2 = shared.normalizeFiduciary(data.fiduciaries && data.fiduciaries.spouse2);
  const cons = data.considerations || {};
  const grossEstate = (data.assets && data.assets.grossEstate) || 0;
  const showFederal = grossEstate >= FIRM_CONFIG.FEDERAL_SECTION_THRESHOLD;
  const optionalServices = data.optionalServices || FIRM_CONFIG.OPTIONAL_SERVICES;
  const processTimeline = data.processTimeline || FIRM_CONFIG.PROCESS_TIMELINE;
  const clientId = clientIdentifier(data);

  // Helpful list of adult-but-young children (18+) for Young Adult Plans section
  const allChildren = data.children || [];
  const adultChildren = allChildren.filter(c => !c.isMinor);

  // ── CHILDREN COLLECTOR ─────────────────────────────────────────────────────
  const children = [];
  const push = (...items) => items.forEach(i => children.push(i));

  // =========================================================================
  // SECTION 1 — EXECUTIVE SUMMARY
  // =========================================================================
  push(sectionHdr("Executive Summary"));

  // Bottom-line numbers paragraph. Adapts to whether credit shelter applies.
  const execSummary1 = (() => {
    if (isCouple && hasCreditShelter && s1tax && s2tax) {
      const mechanism = ps.isSeparateTrusts
        ? "With separate trusts and a Clayton election that preserve both exemptions ($4 million total)"
        : ps.disclaimer
          ? "With disclaimer planning that can preserve both exemptions ($4 million total) if the surviving spouse disclaims correctly and within nine months"
          : "With credit shelter planning that preserves both exemptions ($4 million total)";
      return `Your combined estate has an estimated gross value of approximately ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay}. This puts you well above Massachusetts' ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} estate tax threshold per person${showFederal ? ", and potentially within reach of the federal estate tax threshold as well, depending on how Congress acts" : ""}. Without planning, when the first spouse passes away, their ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} Massachusetts exemption is lost entirely — and your family could owe an estimated ${fmt(s1tax.netTax)} in state estate taxes. ${mechanism}, that tax bill drops to approximately ${fmt(s2tax.totalNetTax)} — a savings of roughly ${fmt(data.tax.savings)}.`;
    }
    if (isCouple && s1tax) {
      // joint_outright (no credit shelter) or couple under threshold
      if (ps.planStructure === "joint_outright" && grossEstate > FIRM_CONFIG.MA_EXEMPTION_NUM) {
        return `Your combined estate has an estimated gross value of approximately ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay}. This puts you above Massachusetts' ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} estate tax threshold per person. Under a plan that leaves everything outright to the surviving spouse, the first spouse's ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} exemption is not preserved, and your family could owe an estimated ${fmt(s1tax.netTax)} in Massachusetts estate taxes at the second death. Credit shelter planning — through separate trusts or a disclaimer — could reduce that substantially; we discuss those options below.`;
      }
      return `Your combined estate has an estimated gross value of approximately ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay}. ${grossEstate > FIRM_CONFIG.MA_EXEMPTION_NUM ? `This is above Massachusetts' ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} estate tax threshold per person. Without planning, your family could owe an estimated ${fmt(s1tax.netTax)} in Massachusetts estate taxes at the second death.` : `This is currently below the ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} Massachusetts estate tax threshold. No state estate tax is currently anticipated, though we recommend monitoring as your estate grows.`}`;
    }
    // Individual
    if (s1tax && grossEstate > FIRM_CONFIG.MA_EXEMPTION_NUM) {
      return `Your estate has an estimated gross value of approximately ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay}. This exceeds Massachusetts' ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} estate tax threshold, and an estimated ${fmt(s1tax.netTax)} in state estate taxes would be owed at your death without further planning.`;
    }
    return `Your estate has an estimated gross value of approximately ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay}. This is currently below the ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} Massachusetts estate tax threshold. No state estate tax is currently anticipated, though we recommend monitoring as your estate grows.`;
  })();
  push(bodyP(execSummary1, { alignment: AlignmentType.BOTH }));

  // Second paragraph — proposal recommendation summary
  const execSummary2 = (() => {
    const planTypeLabel = (data.plan && data.plan.type) || "a comprehensive estate plan";
    const hasMinors = data.hasMinorChildren;
    const benefits = [];
    if (hasCreditShelter) benefits.push(`preserve both of your Massachusetts estate tax exemptions, saving an estimated ${fmt(data.tax.savings)} in taxes`);
    if (data.hasTrust) benefits.push(`protect your ${hasMinors ? "children's" : "beneficiaries'"} inheritance${hasMinors ? "s" : ""} from creditors, divorce, and financial mismanagement`);
    benefits.push(`ensure that if ${isCouple ? "either of you becomes" : "you become"} incapacitated, your finances and health care decisions are handled by people you trust — without court involvement`);

    const benefitText = benefits.length === 1
      ? benefits[0]
      : benefits.map((b, i) => `(${i + 1}) ${b}`).join("; ");

    if (data.hasTrust && isCouple && hasCreditShelter && ps.isSeparateTrusts) {
      return `This proposal recommends a separate Revocable Living Trust for each of you, each drafted with credit shelter provisions and a Clayton election. The Clayton election is an advanced, Massachusetts-friendly tool that lets the survivor's fiduciary decide at the first death — with the benefit of actual asset values and the tax law in effect at that time — how much to shelter from estate tax versus leave to the survivor. Each trust is designed to ${benefitText}.`;
    }
    if (data.hasTrust && isCouple && hasCreditShelter && ps.disclaimer) {
      return `This proposal recommends a joint Revocable Living Trust with disclaimer planning. At the first death, the surviving spouse may disclaim up to $2 million into a credit shelter trust within nine months — a flexible, lower-cost way to preserve the first spouse's Massachusetts exemption. Because it depends on the survivor disclaiming correctly and on time, we will walk you through exactly how and when that decision is made. Your plan is designed to ${benefitText}.`;
    }
    if (data.hasTrust && isCouple && ps.planStructure === "joint_outright") {
      return `This proposal recommends a joint Revocable Living Trust that distributes outright to the surviving spouse. This is the simplest structure and accomplishes your core goals — avoiding probate, managing incapacity, and protecting your children's inheritances — but it does not preserve the first spouse's Massachusetts exemption. Your plan is designed to ${benefitText}. We outline credit-shelter alternatives below that could reduce the estate tax shown above.`;
    }
    if (data.hasTrust && isCouple && hasCreditShelter) {
      return `This proposal recommends a separate Revocable Living Trust for each of you. Each trust is designed to ${benefitText}.`;
    }
    if (data.hasTrust && isCouple) {
      return `This proposal recommends a Revocable Living Trust-based estate plan. Your plan is designed to ${benefitText}.`;
    }
    if (data.hasTrust) {
      return `This proposal recommends a Revocable Living Trust-based estate plan. Your plan is designed to ${benefitText}.`;
    }
    return `This proposal recommends ${planTypeLabel} designed to ${benefitText}.`;
  })();
  push(bodyP(execSummary2, { alignment: AlignmentType.BOTH }));

  // ── What This Plan Accomplishes — structure-aware bullets ──
  const accomplishments = (() => {
    const items = [];
    const hasBiz = !!(cons && cons.businessInterest) ||
      (Array.isArray(data.flags) && data.flags.some(f => /business interest/i.test(f)));
    const childWord = data.hasMinorChildren ? "each child's" : "each beneficiary's";
    const incapacityBullet = `Keeps incapacity${data.hasMinorChildren ? " and guardianship" : ""} decisions out of court — if ${isCouple ? "either of you becomes" : "you become"} unable to act, people you trust step in without a court proceeding.`;
    const protectBullet = `Protects ${childWord} inheritance from creditors, divorce, and financial immaturity through protected lifetime trust shares.`;
    const probateBullet = "Avoids the Massachusetts probate process (typically 9–18 months) by holding your assets in trust.";

    if (ps.isSeparateTrusts) {
      items.push("Preserves both of your $2 million Massachusetts estate tax exemptions — $4 million sheltered in total.");
      items.push("Uses a Clayton election and Massachusetts QTIP to defer estate tax at the first death, with the division decided then, based on real values and the law in effect at that time.");
      if (hasBiz || cons.ilit) items.push("Provides estate-tax-free liquidity through one or two ILITs, so estate taxes can be paid without a forced sale of your business interests.");
      items.push(protectBullet);
      items.push(incapacityBullet);
    } else if (ps.disclaimer) {
      items.push("Preserves both of your $2 million Massachusetts estate tax exemptions — $4 million sheltered in total — provided the surviving spouse disclaims correctly and within nine months of the first death.");
      items.push("Gives the surviving spouse flexibility to decide how much to shelter, with the benefit of hindsight, at a lower cost than separate trusts.");
      if (hasBiz || cons.ilit) items.push("Provides estate-tax-free liquidity through an ILIT, so estate taxes can be paid without a forced sale of illiquid assets.");
      items.push(protectBullet);
      items.push(incapacityBullet);
    } else if (ps.planStructure === "joint_outright") {
      items.push(probateBullet);
      items.push(protectBullet);
      items.push(incapacityBullet);
      items.push("Trade-off to note: this structure uses only one $2 million exemption — the first spouse's exemption is not preserved. The alternatives outlined below could shelter an additional $2 million.");
    } else { // individual_single
      items.push(probateBullet);
      items.push(`Protects your beneficiaries' inheritance from creditors, divorce, and financial immaturity through protected lifetime trust shares.`);
      items.push("Keeps incapacity decisions out of court — if you become unable to act, a person you trust manages your finances and health care without a court proceeding.");
      if (cons.ilit || cons.gifting) items.push("Identifies lifetime strategies — such as gifting, charitable planning, and a life insurance trust — to manage estate tax exposure as your estate grows.");
    }
    return items;
  })();
  if (accomplishments.length > 0) {
    push(subSectionHdr("What This Plan Accomplishes"));
    accomplishments.forEach(it => push(bulletP(it)));
  }

  // =========================================================================
  // SECTION 2 — CLIENT PROFILE
  // =========================================================================
  push(sectionHdr("Client Profile"));

  // Build profile table — column widths depend on couple vs. individual
  const profileColWidths = isCouple ? [2200, 3580, 3580] : [2600, 6760];
  const profileHdrRow = isCouple
    ? tRow([hdrCell("", 2200), hdrCell(s1.fullName, 3580), hdrCell(s2.fullName, 3580)])
    : tRow([hdrCell("", 2600), hdrCell(s1.fullName, 6760)]);

  function profileRow(label, v1, v2, opts = {}) {
    if (isCouple) {
      // For span cells (e.g. Date of Marriage, Residence) — second cell can span both spouse columns
      if (opts.span) {
        return tRow([
          dataCell(label, 2200, L_NAVY, true),
          new TableCell({
            width: { size: 3580 + 3580, type: WidthType.DXA },
            columnSpan: 2,
            shading: { fill: "FFFFFF", type: ShadingType.CLEAR },
            borders: thinBorders(),
            margins: { top: 80, bottom: 80, left: 160, right: 160 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              keepNext: true, keepLines: true,
              children: [new TextRun({ text: v1 || "", font: "Garamond", size: 20, color: BLACK })]
            })]
          })
        ]);
      }
      return tRow([
        dataCell(label, 2200, L_NAVY, true),
        dataCell(v1 || "", 3580),
        dataCell(v2 || "", 3580)
      ]);
    }
    return tRow([dataCell(label, 2600, L_NAVY, true), dataCell(v1 || "", 6760)]);
  }

  const profileRows = [profileHdrRow];
  // Date of Birth
  const dob1 = s1.dob ? `${s1.dob}${s1.age != null ? ` (age ${s1.age})` : ""}` : "";
  const dob2 = isCouple && s2 ? (s2.dob ? `${s2.dob}${s2.age != null ? ` (age ${s2.age})` : ""}` : "") : "";
  profileRows.push(profileRow("Date of Birth", dob1, dob2));
  // Citizenship
  const cit1 = s1.citizenship === "US" || s1.citizenship === "Yes" || s1.citizenship === true ? "Yes" : (s1.citizenship || "Yes");
  const cit2 = isCouple && s2 ? (s2.citizenship === "US" || s2.citizenship === "Yes" || s2.citizenship === true ? "Yes" : (s2.citizenship || "Yes")) : "";
  profileRows.push(profileRow("U.S. Citizen", cit1, cit2));
  // Date of Marriage — couple only
  if (isCouple && (data.clients.marriedSince || data.clients.dateOfMarriage)) {
    profileRows.push(profileRow("Date of Marriage", data.clients.dateOfMarriage || data.clients.marriedSince, null, { span: true }));
  }
  // Residence
  if (data.clients.address) {
    profileRows.push(profileRow("Residence", data.clients.address, null, { span: isCouple }));
  }

  push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: profileColWidths,
    rows: profileRows
  }));

  // Children sub-section (only if there are children)
  if (allChildren.length > 0) {
    push(subSectionHdr("Children"));
    const childRows = [
      tRow([
        hdrCell("Name", 3360),
        hdrCell("Date of Birth", 2000),
        hdrCell("Relationship", 2000),
        hdrCell("Age / Status", 2000)
      ])
    ];
    allChildren.forEach(c => {
      const ageStatus = `${c.age != null ? c.age : "—"} / ${c.isMinor ? "Minor" : "Adult"}`;
      childRows.push(tRow([
        dataCell(c.name || "", 3360),
        dataCell(c.dob || "", 2000),
        dataCell(c.relationship || (c.gender === "F" ? "Daughter" : c.gender === "M" ? "Son" : "Child"), 2000),
        dataCell(ageStatus, 2000)
      ]));
    });
    push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3360, 2000, 2000, 2000],
      rows: childRows
    }));
  }

  // =========================================================================
  // SECTION 3 — FINANCIAL OVERVIEW
  // =========================================================================
  push(sectionHdr("Financial Overview", NAVY, { pageBreakBefore: true }));
  push(bodyP(
    "The following summarizes the assets reported in your questionnaire and financial worksheet. These figures are used to estimate estate tax exposure and inform the recommended planning strategy.",
    { alignment: AlignmentType.BOTH }
  ));
  push(spacer(80));

  // Asset breakdown table
  const assetRows = [
    tRow([hdrCell("Asset Category", 6360), hdrCell("Estimated Value", 3000)])
  ];
  const breakdown = (data.assets && data.assets.breakdown) || [];
  breakdown.forEach((item, idx) => {
    const bg = idx % 2 === 0 ? "FFFFFF" : GRAY;
    assetRows.push(tRow([
      dataCell(item.category || "", 6360, bg),
      dataCellRight(item.display || fmt(item.value || 0), 3000, bg)
    ]));
  });
  // Total row — light teal with navy bold text
  assetRows.push(tRow([
    new TableCell({
      width: { size: 6360, type: WidthType.DXA },
      shading: { fill: L_TEAL, type: ShadingType.CLEAR },
      borders: thinBorders(),
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        keepNext: true, keepLines: true,
        children: [new TextRun({ text: "ESTIMATED GROSS ESTATE", font: "Garamond", size: 22, bold: true, color: NAVY })]
      })]
    }),
    new TableCell({
      width: { size: 3000, type: WidthType.DXA },
      shading: { fill: L_TEAL, type: ShadingType.CLEAR },
      borders: thinBorders(),
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        keepNext: true, keepLines: true,
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: data.assets.grossEstateDisplay || fmt(grossEstate), font: "Garamond", size: 22, bold: true, color: NAVY })]
      })]
    })
  ]));

  push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [6360, 3000],
    rows: assetRows
  }));

  // =========================================================================
  // SECTION 4 — ESTATE TAX ANALYSIS
  // =========================================================================
  push(sectionHdr("Estate Tax Analysis", NAVY, { pageBreakBefore: true }));

  // ── 4a. Massachusetts Estate Tax ──
  push(subSectionHdr("Massachusetts Estate Tax"));
  push(bodyP(
    isCouple
      ? `Massachusetts imposes an estate tax on estates exceeding ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} per person. Under the 2023 reform, an estate over the ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} threshold receives a credit (up to $99,600) that effectively exempts the first ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} of the taxable estate, so only the amount above the threshold is taxed. The effective rate ranges from approximately 0.8% to 16%. Because Massachusetts does not allow a surviving spouse to "inherit" the deceased spouse's unused exemption (a feature the federal system offers, called portability), the only way to preserve the first-to-die's ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} exemption is to shelter assets up to the exemption amount at the first death.${hasCreditShelter ? (ps.isSeparateTrusts ? " With separate trusts for each spouse and a Clayton election, both $2 million exemptions are preserved — $4 million total sheltered from estate tax." : ps.disclaimer ? " With disclaimer planning, the surviving spouse may preserve the first spouse's exemption, so both $2 million exemptions can be preserved — $4 million total — provided the disclaimer is valid and timely." : " With credit shelter planning, both $2 million exemptions are preserved — $4 million total sheltered from estate tax.") : ""}`
      : `Massachusetts imposes an estate tax on estates exceeding ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY}. Under the 2023 reform, an estate over the ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} threshold receives a credit (up to $99,600) that effectively exempts the first ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} of the taxable estate, so only the amount above the threshold is taxed. The effective rate ranges from approximately 0.8% to 16%. As a single individual, you have one ${FIRM_CONFIG.MA_EXEMPTION_DISPLAY} exemption; we focus on lifetime strategies — such as gifting, charitable planning, and life insurance trusts — to manage exposure as your estate grows.`,
    { alignment: AlignmentType.BOTH }
  ));

  // Side-by-side comparison table (couples with credit shelter scenario only)
  if (isCouple && hasCreditShelter && s1tax && s2tax) {
    push(spacer(80));
    push(bodyP("Estimated Massachusetts Estate Tax — Side-by-Side Comparison", { bold: true }));
    push(spacer(40));

    const W1 = 3360, W2 = 3000, W3 = 3000;
    const planColHdr = ps.disclaimer ? "With Disclaimer" : "With Credit Shelter";
    const planStrategy = ps.isSeparateTrusts
      ? "Separate trusts — each spouse uses their $2M exemption ($4M total); Bypass Trust at first death via Clayton election; marital trust for balance"
      : ps.disclaimer
        ? "Joint trust — survivor disclaims up to $2M into a Bypass Trust at first death; both $2M exemptions preserved ($4M total) if disclaimer is timely"
        : "Credit shelter — each spouse's $2M exemption preserved ($4M total); Bypass Trust at first death; marital trust for balance";
    const taxRows = [
      tRow([
        hdrCell("", W1),
        hdrCell("Without Planning", W2),
        hdrCell(planColHdr, W3)
      ]),
      tRow([
        dataCell("Strategy", W1, L_NAVY, true),
        dataCell("First spouse's $2M exemption wasted; only 1 of 2 exemptions used; full estate taxed at second death", W2, PINK_BG, false, BLACK, { italics: true }),
        dataCell(planStrategy, W3, L_TEAL, false, BLACK, { italics: true })
      ]),
      tRow([
        dataCell("Estate Subject to Tax at First Death", W1, L_NAVY, true),
        dataCellWithNote("$0", "(exemption wasted)", W2, PINK_BG, true, BLACK),
        dataCellRight(fmt(FIRM_CONFIG.MA_EXEMPTION_NUM), W3, L_TEAL, true)
      ]),
      tRow([
        dataCell("MA Tax at First Death", W1, L_NAVY, true),
        dataCellRight("$0", W2, PINK_BG, true),
        dataCellWithNote("$0", "(Spouse 1's $2M exemption used)", W3, L_TEAL, true, BLACK)
      ]),
      tRow([
        dataCell("Surviving Spouse's Taxable Estate", W1, L_NAVY, true),
        dataCellRight(fmt(s1tax.taxableEstate), W2, PINK_BG, false),
        dataCellRight(fmt(s2tax.secondDeath ? s2tax.secondDeath.taxableEstate : 0), W3, L_TEAL, false)
      ]),
      tRow([
        dataCell("MA Tax at Second Death", W1, L_NAVY, true),
        dataCellRight(fmt(s1tax.netTax), W2, PINK_BG, true, RED_TEXT()),
        dataCellRight(fmt(s2tax.secondDeath ? s2tax.secondDeath.netTax : s2tax.totalNetTax), W3, L_TEAL, true, TEAL)
      ]),
      tRow([
        new TableCell({
          width: { size: W1, type: WidthType.DXA },
          shading: { fill: NAVY, type: ShadingType.CLEAR },
          borders: thinBorders(),
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({
            keepNext: true, keepLines: true,
            children: [new TextRun({ text: "TOTAL MA ESTATE TAX", font: "Garamond", size: 20, bold: true, color: "FFFFFF" })]
          })]
        }),
        dataCellRight(fmt(s1tax.netTax), W2, PINK_BG, true, RED_TEXT()),
        dataCellRight(fmt(s2tax.totalNetTax), W3, L_TEAL, true, TEAL)
      ])
    ];

    // Savings band — full-width single-cell row
    if (data.tax.savings > 0) {
      taxRows.push(tRow([
        new TableCell({
          width: { size: W1 + W2 + W3, type: WidthType.DXA },
          columnSpan: 3,
          shading: { fill: L_TEAL, type: ShadingType.CLEAR },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
            left: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
            right: { style: BorderStyle.SINGLE, size: 4, color: TEAL }
          },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({
            keepNext: true, keepLines: true,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "ESTIMATED MA ESTATE TAX SAVINGS  ", font: "Garamond", size: 22, bold: true, color: NAVY }),
              new TextRun({ text: fmt(data.tax.savings), font: "Garamond", size: 26, bold: true, color: TEAL })
            ]
          })]
        })
      ]));
    }

    push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [W1, W2, W3],
      rows: taxRows
    }));
    push(spacer(80));
    push(bodyP(
      "Note: These estimates assume current asset values, the current Massachusetts estate tax structure, and that all reported assets are included in the gross estate at the time of death. Actual tax liability will depend on asset values at the time of death, applicable deductions, and legislative changes.",
      { italics: true, size: 18 }
    ));
  } else if (s1tax && !isCouple && grossEstate > FIRM_CONFIG.MA_EXEMPTION_NUM) {
    // Individual with taxable estate
    push(spacer(80));
    const rows = [
      tRow([hdrCell("", 4680), hdrCell("Your Estate", 4680)]),
      tRow([dataCell("Taxable Estate", 4680, L_NAVY, true), dataCellRight(fmt(s1tax.taxableEstate), 4680, L_NAVY)]),
      tRow([dataCell("MA Exemption", 4680, "FFFFFF", true), dataCellRight(fmt(FIRM_CONFIG.MA_EXEMPTION_NUM), 4680)]),
      tRow([
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: NAVY, type: ShadingType.CLEAR },
          borders: thinBorders(),
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ keepNext: true, keepLines: true,
            children: [new TextRun({ text: "MA Estate Tax Due", font: "Garamond", size: 20, bold: true, color: "FFFFFF" })] })]
        }),
        dataCellRight(fmt(s1tax.netTax), 4680, L_TEAL, true, TEAL)
      ])
    ];
    push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680], rows }));
    push(spacer(80));
    push(bodyP(
      "Note: This estimate assumes current asset values and the current Massachusetts estate tax structure. Actual tax liability will depend on asset values at the time of death, applicable deductions, and legislative changes.",
      { italics: true, size: 18 }
    ));
  } else if (isCouple && s1tax && grossEstate > FIRM_CONFIG.MA_EXEMPTION_NUM) {
    // Couple with taxable estate but NO credit shelter planning — show simple
    // single-scenario table so the tax exposure is visible.
    push(spacer(80));
    push(bodyP("Estimated Massachusetts Estate Tax at Second Death — Without Planning", { bold: true }));
    push(spacer(40));
    const rows = [
      tRow([hdrCell("", 4680), hdrCell("Without Credit Shelter Planning", 4680)]),
      tRow([dataCell("Combined Taxable Estate", 4680, L_NAVY, true), dataCellRight(fmt(s1tax.taxableEstate), 4680, L_NAVY)]),
      tRow([dataCell("MA Exemption (one spouse only)", 4680, "FFFFFF", true), dataCellRight(fmt(FIRM_CONFIG.MA_EXEMPTION_NUM), 4680)]),
      tRow([
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: NAVY, type: ShadingType.CLEAR },
          borders: thinBorders(),
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ keepNext: true, keepLines: true,
            children: [new TextRun({ text: "Estimated MA Estate Tax at Second Death", font: "Garamond", size: 20, bold: true, color: "FFFFFF" })] })]
        }),
        dataCellRight(fmt(s1tax.netTax), 4680, "FDECEA", true, RED_TEXT())
      ])
    ];
    push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680], rows }));
    push(spacer(80));
    push(bodyP(
      "Note: Because you have elected not to include credit shelter provisions, only one $2 million Massachusetts exemption is preserved (the surviving spouse's). The first-to-die's exemption is lost. This is the trade-off documented in your plan election. Actual tax liability will depend on asset values at the time of death, applicable deductions, and legislative changes.",
      { italics: true, size: 18 }
    ));
  }

  // ── 4a-bis. Clayton / QTIP / Disclaimer — structure-specific explanation ──
  if (isCouple && hasCreditShelter && (ps.isSeparateTrusts || ps.disclaimer)) {
    push(subSectionHdr("How the Credit Shelter Planning Works"));
    if (ps.isSeparateTrusts) {
      push(bodyP("Your plan does more than simply preserve two exemptions. Each trust is drafted with a Clayton election — a flexible mechanism that lets your fiduciary decide, at the first death and based on the values and tax law then in effect, how much passes to the Credit Shelter (Bypass) Trust versus the Marital Trust. Because the election is fiduciary-controlled, it does not depend on the surviving spouse taking any action, which makes it the most reliable way to preserve both $2 million exemptions.", { alignment: AlignmentType.BOTH }));
      push(bodyP("Massachusetts is unusual in allowing a state-only QTIP election that is independent of the federal election (TIR 86-4; M.G.L. c. 65C). The practical effect for a couple in your position is that we can preserve the first spouse's Massachusetts exemption even where no federal election is made or required.", { alignment: AlignmentType.BOTH }));
      push(bodyP("A note on coordinating the elections. The federal and Massachusetts QTIP elections must be made deliberately. In Shaffer v. Commissioner of Revenue, SJC-12812 (2020), the Supreme Judicial Court addressed how a Massachusetts-only QTIP election interacts with the federal election; we will document the intended election at the first death so the result is the one your plan contemplates.", { alignment: AlignmentType.BOTH }));
    } else if (ps.disclaimer) {
      push(bodyP("Your joint trust is drafted with disclaimer provisions. At the first death, the surviving spouse may disclaim — formally decline — up to $2 million of assets, which then pass into a Credit Shelter (Bypass) Trust that captures the first spouse's exemption. Combined with the survivor's own $2 million exemption, this preserves $4 million in total. The advantage is flexibility: the survivor decides, with the benefit of hindsight, how much to shelter.", { alignment: AlignmentType.BOTH }));
      push(bodyP("Important dependency: this planning works only if the surviving spouse executes a qualified disclaimer within nine (9) months of the first death and does not accept the benefits of, or exercise control over, the disclaimed assets. If the disclaimer is not made correctly and on time, the planning is lost and the estate is taxed using a single exemption. Massachusetts also permits a state-only QTIP election independent of the federal election (TIR 86-4; M.G.L. c. 65C); we will coordinate the elections deliberately (see Shaffer v. Commissioner of Revenue, SJC-12812 (2020)).", { alignment: AlignmentType.BOTH }));
    }
    // §35 out-of-state property note when business / out-of-state assets are flagged
    const has35 = !!(cons && (cons.outOfStateProperty || cons.businessInterest)) ||
      (Array.isArray(data.flags) && data.flags.some(f => /out-of-state|situs|business interest/i.test(f)));
    if (has35) {
      push(bodyP("Out-of-state property. Where the estate holds real property or business interests situated outside Massachusetts, the Massachusetts estate tax is computed with a proportional adjustment for that property (2025 Mass. Acts Ch. 9, §35). Illiquid business interests in particular should be reviewed for situs, as their location can materially change the Massachusetts result.", { alignment: AlignmentType.BOTH, italics: true, size: 18 }));
    }
  } else if (isCouple && ps.planStructure === "joint_outright" && grossEstate > FIRM_CONFIG.MA_EXEMPTION_NUM) {
    push(subSectionHdr("Preserving the First Exemption — Options to Consider"));
    push(bodyP("The plan as currently structured leaves assets outright to the surviving spouse and does not preserve the first spouse's Massachusetts exemption. Two approaches could change that: (1) separate trusts with a Clayton election, in which your fiduciary controls the credit-shelter/marital division at the first death — the most reliable option; or (2) a joint trust with disclaimer provisions, in which the surviving spouse may disclaim into a bypass trust within nine months. Either approach could preserve both $2 million exemptions ($4 million total). We are happy to model the savings for you.", { alignment: AlignmentType.BOTH }));
  }

  // ── 4b. Federal Estate Tax — only if gross estate >= threshold ──
  if (showFederal) {
    push(subSectionHdr("Federal Estate Tax"));
    push(bodyP(
      "The current federal estate tax exemption is approximately $13.99 million per individual (2025, indexed for inflation). However, the elevated exemption created by the 2017 Tax Cuts and Jobs Act is scheduled to sunset after December 31, 2025, which could reduce the exemption to approximately $7 million per individual (indexed). If the exemption drops, your combined estate could be subject to federal estate tax at a rate of 40%.",
      { alignment: AlignmentType.BOTH }
    ));
    push(bodyP(
      "We recommend building flexibility into the plan so that the trust provisions can adapt to legislative changes. A Trust Protector provision designates a trusted individual — typically an attorney or advisor — who has the authority to update certain trust terms if tax laws change significantly, without requiring a court proceeding.",
      { alignment: AlignmentType.BOTH }
    ));
  }

  // ── 4c. Additional Tax Strategies to Discuss ──
  const additionalStrategies = [];
  if (cons.ilit || cons.lifeInsurance) {
    additionalStrategies.push({
      label: "ILIT Consideration: ",
      body: cons.lifeInsurance
        ? `${cons.lifeInsurance} Transferring ownership to an Irrevocable Life Insurance Trust (ILIT) would remove the death benefit from the taxable estate, potentially saving an additional $100,000+ in estate taxes. Note: IRS rules require a three-year waiting period after the transfer before the policy proceeds are fully removed from your taxable estate.`
        : "Consider an Irrevocable Life Insurance Trust (ILIT) to remove life insurance death benefits from the taxable estate. IRS rules require a three-year waiting period after the transfer."
    });
  }
  if (cons.beneficiaryDesignations) {
    additionalStrategies.push({
      label: "Beneficiary Designation Review: ",
      body: typeof cons.beneficiaryDesignations === "string"
        ? cons.beneficiaryDesignations
        : "Coordinating retirement account beneficiary designations with the trust structure can optimize both income tax and estate tax outcomes."
    });
  }
  if (additionalStrategies.length > 0) {
    push(subSectionHdr("Additional Tax Strategies to Discuss"));
    additionalStrategies.forEach(s => push(labeledP(s.label, s.body, { alignment: AlignmentType.BOTH })));
  }

  // =========================================================================
  // SECTION 5 — RECOMMENDED ESTATE PLAN
  // =========================================================================
  push(sectionHdr("Recommended Estate Plan", NAVY, { pageBreakBefore: true }));
  const planType = (data.plan && data.plan.type) || "comprehensive estate plan";
  push(bodyP(
    `Based on your family situation, financial profile, and stated objectives, we recommend a ${planType.toLowerCase().includes("trust") ? "comprehensive trust-based estate plan" : planType}. The following documents would be prepared ${isCouple ? "for each spouse (unless noted as a joint document)" : "for you"}:`,
    { alignment: AlignmentType.BOTH }
  ));

  // Group documents by category. data.plan.documents may have a `category` field.
  // If not, infer from document name.
  const documents = (data.plan && data.plan.documents) || [];

  function inferCategory(doc) {
    if (doc.category) return doc.category;
    const n = (doc.name || "").toLowerCase();
    if (/revocable.*trust|living trust|trust amendment|trust restatement/.test(n) && !/pour/.test(n)) return "core";
    if (/will|testament|personal property memorandum/.test(n)) return "will";
    if (/power of attorney|dpoa|poa|health care proxy|hcp|hipaa|advance health|living will|advance directive/.test(n)) return "incapacity";
    if (/assignment|quitclaim|deed|nominee|realty trust/.test(n)) return "asset";
    if (/guardian|parental|delegation/.test(n)) return "guardian";
    return "incapacity"; // safe default
  }

  const grouped = { core: [], will: [], incapacity: [], asset: [], guardian: [] };
  documents.forEach(d => grouped[inferCategory(d)].push(d));

  // ── 5a. Core Trust Documents ──
  if (grouped.core.length > 0) {
    push(subSectionHdr("Core Trust Documents"));
    grouped.core.forEach(doc => {
      const label = doc.displayName || doc.name;
      const body = doc.description
        ? ` ${doc.description}`
        : (isCouple
            ? ` The centerpiece of ${doc.spouseLabel || "this spouse"}'s plan. Holds assets during lifetime, provides seamless incapacity management, avoids probate at death, and controls distribution through credit shelter, marital, and descendants' trust shares.`
            : " The centerpiece of your plan. Holds assets during lifetime, provides seamless incapacity management, avoids probate at death, and controls distribution to your beneficiaries.");
      push(labeledBullet(`${label}: `, body));
    });

    // Trust Distribution Framework — standard for trust plans
    if (data.hasTrust) {
      push(spacer(60));
      push(labeledP("Trust Distribution Framework:", ""));
      push(subBulletP(`During lifetime: ${isCouple ? "Settlor is" : "You are"} sole trustee and beneficiary with full control.`));
      push(subBulletP("Upon incapacity: Successor trustee manages assets without court intervention."));
      if (hasCreditShelter) {
        if (ps.disclaimer) {
          push(subBulletP(`At first death: The surviving spouse may disclaim up to $2M into a Credit Shelter (Bypass) Trust within nine months, using the first spouse's Massachusetts exemption; the balance passes to the survivor. Combined with the survivor's own $2M exemption, $4M total is sheltered${data.tax && data.tax.savings ? ` — saving an estimated ${fmt(data.tax.savings)} in MA estate taxes` : ""} if the disclaimer is made correctly and on time.`));
        } else {
          push(subBulletP(`At first death: Trust divides${ps.isSeparateTrusts ? " — under a fiduciary-controlled Clayton election —" : ""} into a Credit Shelter (Bypass) Trust, which holds up to $2M to use the first spouse's Massachusetts exemption, and a Marital Trust for the surviving spouse's benefit (the remainder of the estate). Combined with the surviving spouse's own $2M exemption, $4M total is sheltered${data.tax && data.tax.savings ? ` — saving an estimated ${fmt(data.tax.savings)} in MA estate taxes` : ""}.`));
        }
        push(subBulletP("At second death: Combined trust assets distribute to beneficiaries in protected lifetime trust shares, providing creditor protection, divorce protection, and protection from financial immaturity."));
      } else {
        push(subBulletP("At death: Trust assets distribute to your beneficiaries according to the plan you specify, avoiding probate."));
      }
    }
  }

  // ── 5b. Will and Testamentary Documents ──
  if (grouped.will.length > 0) {
    push(subSectionHdr("Will and Testamentary Documents"));
    grouped.will.forEach(doc => {
      const label = doc.displayName || `${doc.name}${doc.perSpouse && isCouple ? " (for each spouse)" : doc.joint ? " (Joint)" : ""}`;
      const body = doc.description
        ? ` ${doc.description}`
        : defaultDocDescription(doc.name, isCouple, data);
      push(labeledBullet(`${label}: `, body));
    });
  }

  // ── 5c. Incapacity Planning Documents ──
  if (grouped.incapacity.length > 0) {
    push(subSectionHdr("Incapacity Planning Documents"));
    grouped.incapacity.forEach(doc => {
      const label = doc.displayName || `${doc.name}${doc.perSpouse && isCouple ? " (for each spouse)" : doc.joint ? " (Joint)" : ""}`;
      const body = doc.description
        ? ` ${doc.description}`
        : defaultDocDescription(doc.name, isCouple, data);
      push(labeledBullet(`${label}: `, body));
    });
  }

  // ── 5d. Asset Transfer Documents ──
  if (grouped.asset.length > 0) {
    push(subSectionHdr("Asset Transfer Documents"));
    grouped.asset.forEach(doc => {
      const label = doc.displayName || `${doc.name}${doc.perSpouse && isCouple ? " (for each spouse)" : doc.joint ? "" : ""}`;
      const body = doc.description
        ? ` ${doc.description}`
        : defaultDocDescription(doc.name, isCouple, data);
      push(labeledBullet(`${label}: `, body));
    });
  }

  // ── 5e. Guardian and Parental Documents ──
  if (grouped.guardian.length > 0) {
    push(subSectionHdr("Guardian and Parental Documents"));
    grouped.guardian.forEach(doc => {
      const label = doc.displayName || `${doc.name}${doc.joint ? " (Joint)" : ""}`;
      const body = doc.description
        ? ` ${doc.description}`
        : defaultDocDescription(doc.name, isCouple, data);
      push(labeledBullet(`${label}: `, body));
    });
  }

  // =========================================================================
  // SECTION 6 — FIDUCIARY APPOINTMENTS
  // =========================================================================
  push(sectionHdr("Fiduciary Appointments", NAVY, { pageBreakBefore: true }));
  push(bodyP(
    "A fiduciary is someone you trust to manage financial, legal, or health care decisions on your behalf. The table below shows who would step in for each role — in order of priority — if " + (isCouple ? "one of you is" : "you are") + " unable to serve:",
    { alignment: AlignmentType.BOTH }
  ));
  push(spacer(80));

  const fidColWidths = isCouple ? [2600, 3380, 3380] : [3360, 6000];
  const fidHdrCells = isCouple
    ? [hdrCell("Role", 2600), hdrCell(`${s1.firstName}'s Plan`, 3380), hdrCell(`${s2.firstName}'s Plan`, 3380)]
    : [hdrCell("Role", 3360), hdrCell("Your Appointments", 6000)];

  const fidRows = [tRow(fidHdrCells)];

  function fidDataRow(label, v1, v2) {
    if (isCouple) {
      return tRow([
        dataCell(label, 2600, L_NAVY, true),
        dataCell(v1 || "[To be determined]", 3380),
        dataCell(v2 || "[To be determined]", 3380)
      ]);
    }
    return tRow([
      dataCell(label, 3360, L_NAVY, true),
      dataCell(v1 || "[To be determined]", 6000)
    ]);
  }

  // Initial Trustee — only if hasTrust
  if (data.hasTrust) {
    fidRows.push(fidDataRow("Initial Trustee", fid1.initialTrustee || `${s1.firstName} (self)`, isCouple && s2 ? (fid2.initialTrustee || `${s2.firstName} (self)`) : null));

    // Successor Trustees — support up to 5 levels
    const succ1 = fid1.successorTrustees || (fid1.successorTrustee ? [fid1.successorTrustee] : []);
    const succ2 = fid2.successorTrustees || (fid2.successorTrustee ? [fid2.successorTrustee] : []);
    const maxSucc = Math.max(succ1.length, isCouple ? succ2.length : 0);
    for (let i = 0; i < maxSucc; i++) {
      fidRows.push(fidDataRow(`Successor Trustee #${i + 1}`, succ1[i], isCouple ? succ2[i] : null));
    }
  }

  // Personal Representative
  fidRows.push(fidDataRow("Personal Representative", fid1.personalRep, isCouple && s2 ? fid2.personalRep : null));

  // Financial POA — Primary + Successor
  fidRows.push(fidDataRow("Financial POA – Primary", fid1.poaAgent, isCouple && s2 ? fid2.poaAgent : null));
  if (fid1.poaSuccessor || (isCouple && fid2.poaSuccessor)) {
    fidRows.push(fidDataRow("Financial POA – Successor", fid1.poaSuccessor, isCouple && s2 ? fid2.poaSuccessor : null));
  }

  // Health Care Agent — Primary + Successor
  fidRows.push(fidDataRow("Health Care Agent – Primary", fid1.hcpAgent, isCouple && s2 ? fid2.hcpAgent : null));
  if (fid1.hcpSuccessor || (isCouple && fid2.hcpSuccessor)) {
    fidRows.push(fidDataRow("Health Care Agent – Successor", fid1.hcpSuccessor, isCouple && s2 ? fid2.hcpSuccessor : null));
  }

  // Guardian for minor children
  if (data.hasMinorChildren) {
    fidRows.push(fidDataRow("Guardian (minor children)", fid1.guardian, isCouple && s2 ? fid2.guardian : null));
  }

  push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: fidColWidths, rows: fidRows }));

  // Important Notes on Fiduciary Appointments — generated from fiduciaries.notes array
  const fidNotes = (data.fiduciaries && data.fiduciaries.notes) || [];
  if (Array.isArray(fidNotes) && fidNotes.length > 0) {
    push(spacer(120));
    push(labeledP("Important Notes on Fiduciary Appointments:", ""));
    fidNotes.forEach(n => {
      if (typeof n === "string") {
        push(bulletP(n));
      } else {
        push(labeledBullet(`${n.label}: `, ` ${n.body}`));
      }
    });
  } else if (typeof fidNotes === "string" && fidNotes.trim()) {
    push(spacer(120));
    push(labeledP("Important Notes on Fiduciary Appointments:", ""));
    push(bulletP(fidNotes));
  }

  // =========================================================================
  // SECTION 7 — KEY TRUST PROVISIONS (only if hasTrust)
  // =========================================================================
  if (data.hasTrust) {
    push(sectionHdr("Key Trust Provisions"));

    // 7a. Distribution to Children (or beneficiaries)
    push(subSectionHdr("Distribution to Children"));
    push(bodyP(`Each ${allChildren.length > 0 ? "child's" : "beneficiary's"} share will be held in a separate lifetime trust providing:`, { alignment: AlignmentType.BOTH }));
    push(labeledBullet("Creditor Protection: ", " Assets shielded from lawsuits, divorces, and business failures."));
    push(labeledBullet("Financial Maturity Protection: ", " Distributions for health, education, maintenance, and support with trustee discretion."));
    push(labeledBullet("Lifestyle Disability Provision: ", " Enhanced trustee discretion if a beneficiary becomes unable to manage their affairs."));

    // 7c. Pet Trust Provisions
    if (data.hasPets && cons.pets) {
      push(subSectionHdr("Pet Trust Provisions"));
      const petName = cons.petName || extractPetName(cons.pets) || "your pet";
      push(bodyP(
        `We recommend including a Pet Trust provision for ${petName} within your Revocable Living Trust${isCouple ? "s" : ""}. This designates a caregiver and sets aside funds for ${petName}'s food, veterinary care, and other needs — so ${petPronoun(cons.pets) || "they"} ${petPronoun(cons.pets) ? "is" : "are"} cared for if ${isCouple ? "both of you become" : "you become"} incapacitated or pass away.`,
        { alignment: AlignmentType.BOTH }
      ));
    }
  }

  // =========================================================================
  // SECTION 8 — ADDITIONAL CONSIDERATIONS
  // =========================================================================
  const hasAdditional =
    cons.anticipatedInheritance ||
    cons.beneficiaryDesignations ||
    data.hasRealEstate ||
    adultChildren.length > 0 ||
    cons.lifeInsurance ||
    data.hasLegalPlan ||
    data.flatFee ||
    optionalServices.length > 0;

  if (hasAdditional) {
    push(sectionHdr("Additional Considerations", NAVY, { pageBreakBefore: true }));

    // 8a. Anticipated Inheritance
    if (cons.anticipatedInheritance) {
      push(subSectionHdr("Anticipated Inheritance"));
      push(bodyP(cons.anticipatedInheritance, { alignment: AlignmentType.BOTH }));
    }

    // 8b. Beneficiary Designation Coordination
    if (cons.beneficiaryDesignations) {
      push(subSectionHdr("Beneficiary Designation Coordination"));
      const text = typeof cons.beneficiaryDesignations === "string"
        ? cons.beneficiaryDesignations
        : `Retirement accounts and most brokerage accounts transfer directly to named beneficiaries when you pass away — they do not pass through your will or trust automatically. This means if the beneficiary designations on file are outdated or don't match your plan, assets could be distributed in ways you didn't intend. We recommend ${isCouple ? "naming the surviving spouse as primary beneficiary on each account, and naming the trust as contingent beneficiary (the fallback if the spouse has also passed)" : "naming the trust as primary beneficiary on each account"}.`;
      push(bodyP(text, { alignment: AlignmentType.BOTH }));
    }

    // 8c. Real Estate Transfer
    if (data.hasRealEstate) {
      push(subSectionHdr("Real Estate Transfer"));
      const text = cons.realEstateTransfer || `We will transfer your home into the trust using a quitclaim deed, recorded at the ${data.clients.county || "Norfolk County"} Registry of Deeds. If you currently have a Declaration of Homestead on file (which protects your primary residence from certain creditors), it will need to be re-recorded after the deed transfer to ensure the protection remains in effect.`;
      push(bodyP(text, { alignment: AlignmentType.BOTH }));
    }

    // 8d. Young Adult Estate Plans
    if (adultChildren.length > 0 && adultChildren.some(c => c.age != null && c.age < 30)) {
      push(subSectionHdr("Young Adult Estate Plans"));
      const youngAdults = adultChildren.filter(c => c.age != null && c.age < 30);
      const namesList = youngAdults.map(c => `${c.name}${c.age != null ? ` (${c.age})` : ""}`).join(" and ");
      push(bodyP(
        `${namesList} should have ${youngAdults.length === 1 ? "their" : "their"} own Health Care Proxy and Durable Power of Attorney. These are available as an add-on.`,
        { alignment: AlignmentType.BOTH }
      ));
    }

    // 8e. Life Insurance Review
    if (cons.lifeInsurance) {
      push(subSectionHdr("Life Insurance Review"));
      push(bodyP(
        typeof cons.lifeInsurance === "string"
          ? cons.lifeInsurance
          : "Your existing life insurance coverage should be reviewed for adequacy and for opportunities to remove the death benefit from your taxable estate via an Irrevocable Life Insurance Trust (ILIT). The three-year lookback period applies to ILIT transfers.",
        { alignment: AlignmentType.BOTH }
      ));
    }

    // 8f. Legal Plan Coverage
    if (data.hasLegalPlan && data.legalPlan) {
      push(subSectionHdr("Legal Plan Coverage"));
      const planName = (data.legalPlan && data.legalPlan.name) || "your legal plan";
      push(bodyP(
        `Your estate plan qualifies for coverage under the ${planName}${planName.toLowerCase().includes("plan") ? "" : " Legal Plan"}, which means the cost of the covered documents below is reimbursed through your employer benefit. The following documents are covered:`,
        { alignment: AlignmentType.BOTH }
      ));
      const covered = (data.legalPlan && data.legalPlan.covered) || [
        "Last Will and Testament",
        "Revocable Living Trust with No Tax Planning",
        "Durable Power of Attorney",
        "Health Care Proxy",
        "Living Will / Advance Directive",
        "HIPAA Authorization"
      ];
      covered.forEach(item => push(bulletP(item)));
      push(spacer(60));
      push(bodyP("The plan does not cover:"));
      const notCovered = (data.legalPlan && data.legalPlan.notCovered) || [
        "Tax planning provisions",
        "Deed recording fees",
        "Notary and witness fees",
        "Attorney-supervised signing ceremonies"
      ];
      notCovered.forEach(item => push(bulletP(item)));
    }

    // 8g. Fee section — branches on flat-fee vs. legal-plan client.
    //   • Flat-fee clients: render "Engagement Fee" with included / not-included lists.
    //     There are NO optional services for flat-fee matters — the fee is comprehensive.
    //   • Legal-plan clients: render "Optional Services" table (firm add-ons).
    if (data.flatFee) {
      push(subSectionHdr("Engagement Fee"));

      // Lead paragraph stating the flat fee
      push(new Paragraph({
        keepNext: true, keepLines: true,
        spacing: { before: 80, after: 80 },
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({ text: "Your flat fee for this engagement is ", font: "Garamond", size: 22, color: BLACK }),
          new TextRun({ text: data.flatFee, font: "Garamond", size: 22, bold: true, color: NAVY }),
          new TextRun({ text: ". This fee is comprehensive and covers the full scope of work described in this proposal, from drafting through the signing ceremony.", font: "Garamond", size: 22, color: BLACK })
        ]
      }));
      push(spacer(60));

      // Included list
      push(labeledP("This fee includes:", ""));
      const includedDefaults = [
        "Preparation of all documents listed in this proposal",
        "All attorney consultations and revisions during the engagement",
        "Attorney-supervised signing ceremony with notary and witnesses included"
      ];
      if (data.hasTrust) {
        includedDefaults.push("Post-signing trust funding instructions and closing package");
      }
      const included = data.flatFeeIncludes || includedDefaults;
      included.forEach(item => push(bulletP(item)));

      push(spacer(80));

      // Not-included list
      push(labeledP("This fee does not include:", ""));
      const excludedDefaults = [];
      if (data.hasRealEstate) {
        const countyClean = (data.clients.county || "Norfolk County").replace(/\s*County$/i, "");
        excludedDefaults.push(`Deed recording fees, paid directly to the ${countyClean} County Registry of Deeds`);
      }
      excludedDefaults.push("Future amendments, restatements, or revisions made after the plan is signed (billed separately when needed)");
      const excluded = data.flatFeeExcludes || excludedDefaults;
      excluded.forEach(item => push(bulletP(item)));
    } else if (optionalServices.length > 0) {
      // Legal-plan client — Optional Services table.
      push(subSectionHdr("Optional Services"));
      push(bodyP("The following services are available as optional add-ons:", { alignment: AlignmentType.BOTH }));
      push(spacer(40));

      const optColWidths = [2300, 3360, 1500, 2200];
      const optRows = [
        tRow([
          hdrCell("Service", 2300),
          hdrCell("Description", 3360),
          hdrCell("Fee", 1500),
          hdrCell("Status", 2200)
        ])
      ];
      optionalServices.forEach((svc, idx) => {
        const bg = idx % 2 === 0 ? "FFFFFF" : GRAY;
        optRows.push(tRow([
          dataCell(svc.name || "", 2300, bg, true),
          dataCell(svc.description || "", 3360, bg),
          dataCellRight(svc.fee || "", 1500, bg),
          dataCellCenter(svc.status || "", 2200, bg)
        ]));
      });
      push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: optColWidths, rows: optRows }));
    }
  }

  // =========================================================================
  // SECTION 9 — ESTATE PLAN SUMMARY (numbered ✓-mark document list)
  // =========================================================================
  if (documents.length > 0) {
    push(sectionHdr("Estate Plan Summary", NAVY, { pageBreakBefore: true }));

    // Dedupe by canonical document name. If two documents share the same
    // canonical name (e.g. one trust per spouse), they collapse into a single
    // row with ✓ marks for both spouses.
    const summaryItems = [];
    const seen = new Map();
    documents.forEach(doc => {
      const canonicalName = (doc.summaryName || doc.name || "").trim();
      const existing = seen.get(canonicalName);
      if (existing) {
        // Merge: mark both spouses as having it
        if (doc.forSpouse === 1) existing.s1 = true;
        if (doc.forSpouse === 2) existing.s2 = true;
        if (doc.perSpouse) { existing.s1 = true; existing.s2 = true; }
        if (doc.joint) existing.joint = true;
      } else {
        const item = {
          name: canonicalName,
          joint: !!doc.joint,
          s1: doc.joint ? false : (doc.perSpouse || doc.forSpouse === 1 || !isCouple),
          s2: doc.joint ? false : (doc.perSpouse || doc.forSpouse === 2)
        };
        seen.set(canonicalName, item);
        summaryItems.push(item);
      }
    });

    const W_NUM = 720, W_DOC = 5040;
    const remaining = 9360 - W_NUM - W_DOC; // 3600
    const W_S1 = isCouple ? Math.floor(remaining / 2) : remaining;
    const W_S2 = isCouple ? remaining - W_S1 : 0;

    const summaryHdrCells = isCouple
      ? [hdrCell("#", W_NUM), hdrCell("Document", W_DOC), hdrCell(s1.firstName, W_S1), hdrCell(s2.firstName, W_S2)]
      : [hdrCell("#", W_NUM), hdrCell("Document", W_DOC), hdrCell("Included", W_S1)];

    const summaryRows = [tRow(summaryHdrCells)];
    summaryItems.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? "FFFFFF" : GRAY;
      const num = String(idx + 1);
      if (isCouple) {
        const mark1 = item.joint ? "Joint" : (item.s1 ? "✓" : "");
        const mark2 = item.joint ? "Joint" : (item.s2 ? "✓" : "");
        summaryRows.push(tRow([
          dataCellCenter(num, W_NUM, bg),
          dataCell(item.name, W_DOC, bg),
          dataCellCenter(mark1, W_S1, bg),
          dataCellCenter(mark2, W_S2, bg)
        ]));
      } else {
        summaryRows.push(tRow([
          dataCellCenter(num, W_NUM, bg),
          dataCell(item.name, W_DOC, bg),
          dataCellCenter("✓", W_S1, bg)
        ]));
      }
    });

    push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: isCouple ? [W_NUM, W_DOC, W_S1, W_S2] : [W_NUM, W_DOC, W_S1],
      rows: summaryRows
    }));
  }

  // =========================================================================
  // SECTION 10 — PROCESS & TIMELINE
  // =========================================================================
  push(sectionHdr("Process & Timeline"));
  push(bodyP("Our estate planning process follows a structured approach:", { alignment: AlignmentType.BOTH }));
  push(spacer(40));

  const procColWidths = [880, 2120, 4860, 1500];
  const procRows = [
    tRow([
      hdrCell("Step", 880),
      hdrCell("Phase", 2120),
      hdrCell("Description", 4860),
      hdrCell("Timeline", 1500)
    ])
  ];
  processTimeline.forEach((row, idx) => {
    const bg = idx % 2 === 0 ? "FFFFFF" : GRAY;
    procRows.push(tRow([
      dataCellCenter(row.step || String(idx + 1), 880, bg),
      dataCell(row.phase || "", 2120, bg, true),
      dataCell(row.description || "", 4860, bg),
      dataCell(row.timeline || "", 1500, bg)
    ]));
  });
  push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: procColWidths, rows: procRows }));

  // =========================================================================
  // ASSEMBLE THE DOCUMENT
  // =========================================================================
  const doc = new Document({
    numbering: NUMBERING,
    sections: [{
      properties: PAGE_PROPS,
      headers: { default: makeHeaderProposal("Estate Plan Proposal", clientId) },
      footers: { default: makeFooterProposal("Estate Plan Proposal") },
      children: [
        ...titleBlockCover(names),
        ...children
      ]
    }]
  });

  return Packer.toBuffer(doc);
};

// ── INTERNAL UTILITIES ───────────────────────────────────────────────────────
function RED_TEXT() { return "CC0000"; }

function petPronoun(petsText) {
  if (!petsText) return null;
  const t = String(petsText).toLowerCase();
  if (/\bhim\b|\bhe\b|\bhis\b/.test(t)) return "he";
  if (/\bher\b|\bshe\b/.test(t)) return "she";
  return null;
}

function extractPetName(petsText) {
  if (!petsText) return null;
  // Try to grab a capitalized word that looks like a name (e.g. "golden retriever Rusty")
  const m = String(petsText).match(/\b([A-Z][a-z]+)\b/);
  return m ? m[1] : null;
}

/** Standard fallback descriptions for common documents. */
function defaultDocDescription(name, isCouple, data) {
  const n = (name || "").toLowerCase();
  const spouseSuffix = isCouple ? "for each spouse" : "";

  if (/pour.?over.*will|will.*pour/.test(n)) {
    return ` A safety net that captures any assets not already held in the trust at death and "pours" them into the trust so everything is distributed under the same plan.${data.hasMinorChildren ? " Also names guardians for any minor children, and leaves tangible personal property first to the surviving spouse, then to your children." : ""}`;
  }
  if (/last will|will.*testament|^will$/.test(n)) {
    return ` Directs distribution of probate assets and names a personal representative to administer your estate.${data.hasMinorChildren ? " Also names guardians for any minor children." : ""}`;
  }
  if (/personal property memorandum/.test(n)) {
    return " Allows designation of specific items to specific individuals without amending the trust or will.";
  }
  if (/durable.*power of attorney|durable.*general.*poa|dpoa/.test(n)) {
    return " Comprehensive financial powers for designated agents. Executed with two witnesses and notarization per M.G.L. c. 190B, § 5-501.";
  }
  if (/health care proxy/.test(n)) {
    return " Designates a trusted agent for medical decisions per M.G.L. c. 201D.";
  }
  if (/hipaa/.test(n)) {
    return " Authorizes sharing of protected health information with agents and family members.";
  }
  if (/advance health.*directive|living will/.test(n)) {
    return " Documents wishes regarding life-sustaining treatment.";
  }
  if (/assignment.*personal property/.test(n)) {
    return " Transfers tangible personal property into the trust.";
  }
  if (/quitclaim.*deed|quitclaim$/.test(n)) {
    return ` Transfers real property into the trust${data.clients.county ? `. Recorded at the ${data.clients.county} Registry of Deeds` : ""}.`;
  }
  if (/certificate of trust/.test(n)) {
    return " A short certification of the trust's existence and trustee authority, used to provide proof of the trust to third parties (banks, brokerages, title companies) without disclosing the full trust terms.";
  }
  if (/parental.*appointment.*guardian|appointment.*guardian/.test(n)) {
    return " Names long-term guardians for minor children. Per M.G.L. c. 190B, § 5-202.";
  }
  if (/temporary.*delegation.*parental/.test(n)) {
    return " Designates short-term caregivers for minor children (up to 60 days) when parents are unavailable.";
  }
  if (/revocable.*trust|living trust/.test(n)) {
    return ` Holds your assets during your lifetime and distributes them at death without going through probate. Provides seamless incapacity management and controls distribution to your beneficiaries${spouseSuffix ? " " + spouseSuffix : ""}.`;
  }
  return ""; // fall through silently
}
