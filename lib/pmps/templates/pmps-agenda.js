/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * pmps-agenda.js — Consultation Agenda (Attorney-only)
 * Usage: require('./pmps-agenda')(data)
 */
'use strict';
const path = require('path');
const shared = require('./_shared');
const {
  docx, TEAL, NAVY, L_TEAL, L_NAVY, GRAY, AMBER, AMBER_B,
  PAGE_PROPS, NUMBERING, noBorders, hdrCell, dataCell, flagCell,
  spacer, sectionHdr, bodyP, bulletP, subBulletP,
  makeHeader, makeFooter, titleBlock, clientNames, fmt
} = shared;

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, ShadingType, BorderStyle
} = docx;
const fs = require('fs');

module.exports = function generateAgenda(data) {
  const ps = shared.resolvePlanStructure(data);
  const isCouple = ps.isCouple;
  const s1 = data.clients.spouse1;
  const s2 = isCouple ? data.clients.spouse2 : null;
  const names = clientNames(data);
  const hasCreditShelter = ps.hasCreditShelter;

  // ── MATTER TABLE ────────────────────────────────────────────────────────────
  function mRow(label, value) {
    return new TableRow({ children: [
      new TableCell({ width: { size: 2880, type: WidthType.DXA },
        shading: { fill: L_NAVY, type: ShadingType.CLEAR }, borders: noBorders(),
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, font: "Garamond", size: 20, bold: true, color: NAVY })] })]
      }),
      new TableCell({ width: { size: 6480, type: WidthType.DXA },
        borders: noBorders(), margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: value || "—", font: "Garamond", size: 20, color: "333333" })] })]
      })
    ]});
  }

  const childCount = (data.children || []).length;
  const childSummary = childCount > 0
    ? `${childCount} child${childCount > 1 ? 'ren' : ''} (${data.hasMinorChildren ? 'at least one minor' : 'all adults'})`
    : "No children";

  const matterTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2880, 6480],
    rows: [
      mRow("Date", data.matter.date),
      mRow("Client(s)", names),
      mRow("Plan Type", data.plan.type || "Trust-Based Estate Plan"),
      mRow("Legal Plan", data.hasLegalPlan ? (data.legalPlan ? data.legalPlan.name : "Yes") : `No — Flat Fee: ${data.flatFee || "[to confirm]"}`),
      mRow("Estate", data.assets.grossEstateDisplay ? `${data.assets.grossEstateDisplay} taxable estate` : "[verify]"),
      mRow("Children", childSummary),
    ]
  });

  // ── TALKING POINT HELPER ─────────────────────────────────────────────────────
  function talkPt(num, topic, notes) {
    return [
      new Paragraph({
        children: [
          new TextRun({ text: `${num}.  `, font: "Garamond", size: 22, bold: true, color: TEAL }),
          new TextRun({ text: topic, font: "Garamond", size: 22, bold: true, color: NAVY })
        ],
        spacing: { before: 200, after: 60 }
      }),
      ...notes.map(n => new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: n, font: "Garamond", size: 20, color: "444444" })],
        spacing: { before: 40, after: 40 }
      }))
    ];
  }

  // ── TP1: WELCOME ─────────────────────────────────────────────────────────────
  const welcomeNotes = [
    isCouple ? `Welcome ${s1.firstName} and ${s2.firstName}.` : `Welcome ${s1.firstName}.`,
    "Explain today's agenda: review family situation, analyze estate, present recommendations, and discuss fiduciary appointments.",
    data.assets.grossEstateDisplay
      ? `We have prepared this proposal based on a ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay} taxable estate.`
      : "[VERIFY: Confirm estate value before meeting]"
  ];

  // ── TP2: FAMILY REVIEW ───────────────────────────────────────────────────────
  const familyNotes = [];
  if (isCouple) {
    familyNotes.push(`Married ${data.clients.marriedSince || "[year]"}.`);
  }
  if (childCount > 0) {
    const minors = (data.children || []).filter(c => c.isMinor).map(c => c.name || "unnamed minor");
    const adults = (data.children || []).filter(c => !c.isMinor).map(c => c.name || "unnamed adult");
    if (minors.length > 0) familyNotes.push(`Minor child${minors.length > 1 ? 'ren' : ''}: ${minors.join(", ")} — guardian nomination required.`);
    if (adults.length > 0) familyNotes.push(`Adult child${adults.length > 1 ? 'ren' : ''}: ${adults.join(", ")}.`);
  } else {
    familyNotes.push("No children on file.");
  }
  familyNotes.push(`Primary goals: avoid probate, ${hasCreditShelter ? "minimize MA estate tax, " : ""}ensure both${isCouple ? " spouses are" : " you are"} protected if incapacitated, provide for loved ones.`);

  // ── TP3: ESTATE TAX ──────────────────────────────────────────────────────────
  const taxNotes = [];
  const s1tax = data.tax && data.tax.scenario1;
  if (s1tax) {
    if (hasCreditShelter) {
      const s2tax = data.tax.scenario2;
      taxNotes.push("Massachusetts does not have portability — each spouse's $2M exemption is use-it-or-lose-it.");
      taxNotes.push(`Without planning: at first death, assets pass to survivor (first spouse's $2M exemption is wasted). At second death, the full ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay} is taxed.`);
      taxNotes.push(`Scenario 1 (no planning):  Adjusted taxable estate = ${fmt(s1tax.adjustedTaxableEstate)}  |  MA tax = ${fmt(s1tax.netTax)}`);
      if (s2tax) {
        const route = ps.disclaimer ? "disclaimer into bypass trust" : ps.isSeparateTrusts ? "Clayton election (fiduciary-controlled)" : "credit shelter";
        taxNotes.push(`Scenario 2 (${route}):  $2M sheltered at first death ($0 tax); both exemptions preserved ($4M total). Second-death taxable = ${fmt(s2tax.secondDeath ? s2tax.secondDeath.taxableEstate : 0)} → net tax = ${fmt(s2tax.totalNetTax)}`);
        taxNotes.push(`Tax savings from planning: ${fmt(data.tax.savings)}`);
      }
      if (ps.disclaimer) taxNotes.push("FLAG dependency: planning works only if survivor makes a valid disclaimer within 9 months, no acceptance of benefits/control. Otherwise reverts to one-exemption result.");
      if (ps.isSeparateTrusts) taxNotes.push("Clayton + MA-only QTIP (TIR 86-4): election is fiduciary-controlled. Coordinate federal vs. MA elections deliberately (Shaffer, SJC-12812).");
      taxNotes.push("Walk through the MA Estate Tax Worksheet together — show the rate table and bracket computation.");
    } else if (isCouple && ps.planStructure === "joint_outright") {
      taxNotes.push(`Joint trust, outright to spouse — NO credit shelter funded. First spouse's $2M exemption is NOT preserved; full ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay} taxed at second death.`);
      taxNotes.push(`Scenario 1 (baseline):  Adjusted taxable estate = ${fmt(s1tax.adjustedTaxableEstate)}  |  MA tax = ${fmt(s1tax.netTax)}`);
      taxNotes.push("Quantify the lost exemption: present credit-shelter / disclaimer / Clayton alternatives and the potential savings.");
    } else if (isCouple) {
      taxNotes.push(`Combined estate of ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay} is below the $2M threshold for each spouse — currently no MA estate tax due.`);
      taxNotes.push("Note: MA has no portability. If the estate grows above $2M, a credit shelter trust becomes valuable. Monitor going forward.");
    } else {
      // Individual
      if (s1tax.taxableEstate > 2000000) {
        taxNotes.push(`Your estate of ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay} exceeds the $2M Massachusetts exemption threshold.`);
        taxNotes.push(`Adjusted taxable estate: ${fmt(s1tax.adjustedTaxableEstate)}  |  MA estate tax: ${fmt(s1tax.netTax)}`);
        taxNotes.push("Credit shelter trust is not available for individual clients — discuss gifting, charitable planning, or ILIT to reduce exposure.");
      } else {
        taxNotes.push(`Estate of ${data.assets.grossEstateApprox || data.assets.grossEstateDisplay} is currently below the $2M MA exemption — no estate tax due.`);
        taxNotes.push("Monitor as estate grows. If assets exceed $2M, revisit planning strategies.");
      }
      taxNotes.push("Walk through the MA Estate Tax Worksheet to illustrate the cliff-effect calculation.");
    }
  } else {
    taxNotes.push("[VERIFY: No tax data provided — compute MA estate tax before meeting]");
  }

  // ── TP4: RECOMMENDED PLAN ───────────────────────────────────────────────────
  const planNotes = [
    data.hasTrust
      ? (ps.isSeparateTrusts
          ? "Two separate Revocable Living Trusts (one per spouse) with Credit Shelter provisions and a Clayton election."
          : ps.disclaimer
            ? "Joint Revocable Living Trust with disclaimer provisions (survivor may fund a bypass trust at first death)."
            : `${isCouple ? "Joint " : ""}Revocable Living Trust${hasCreditShelter ? " with integrated Credit Shelter (Bypass) provisions" : ""}.`)
      : "Will-based plan (Last Will and Testament).",
    isCouple
      ? "Pour-Over Wills as a safety net — assets inadvertently left outside the trust pour into it at death."
      : "Pour-Over Will as a safety net.",
    "Durable Powers of Attorney for financial matters.",
    "Health Care Proxies — designate who makes medical decisions.",
    "Advance Health Directives (Living Wills) — document end-of-life wishes.",
    "HIPAA Authorizations — enables access to medical records.",
  ];
  if (hasCreditShelter) {
    planNotes.push("At first death, $2M funds the bypass trust (captures first spouse's exemption); remainder passes to surviving spouse.");
  }
  if (data.hasMinorChildren) {
    planNotes.push("Trust includes provisions for minor beneficiaries — inheritance held until specified ages (e.g., 25 and 30).");
  }

  // ── TP5: FIDUCIARIES ────────────────────────────────────────────────────────
  const fidNotes = [
    "Trustee: Who manages trust assets? (Usually each other first, then successor)",
    "Successor Trustee: Who steps in if both are unavailable?",
    "Personal Representative (Executor): Who administers the estate?",
    "DPOA Agent: Who handles finances if incapacitated?",
    "Health Care Proxy Agent: Who makes medical decisions?",
  ];
  if (data.hasMinorChildren) {
    fidNotes.push("Guardian for minor child(ren): Who would raise them if both parents died? (Critical)");
  }
  fidNotes.push("Recommend naming at least one alternate for each role.");

  // ── TP6: CONSIDERATIONS ─────────────────────────────────────────────────────
  const consNotes = [];
  const cons = data.considerations || {};
  if (cons.realEstateTransfer) consNotes.push(cons.realEstateTransfer);
  if (cons.beneficiaryDesignations) consNotes.push(cons.beneficiaryDesignations);
  if (cons.lifeInsurance) consNotes.push(cons.lifeInsurance);
  if (cons.ilit) consNotes.push("Consider ILIT (Irrevocable Life Insurance Trust) to remove life insurance proceeds from taxable estate.");
  if (cons.anticipatedInheritance) consNotes.push(cons.anticipatedInheritance);
  if (cons.pets) consNotes.push(cons.pets);
  if (cons.gifting) consNotes.push("Annual gifting strategy: $18,000/year per recipient is gift-tax free — discuss with client.");
  if (cons.youngAdultPlans) {
    const y = cons.youngAdultPlans;
    const yName = y.name || "adult child";
    const yAge = y.age ? ` (age ${y.age})` : "";
    const ySchool = y.school ? ` at ${y.school}` : "";
    consNotes.push(`Young Adult Estate Plan for ${yName}${yAge}${ySchool}: parents lost automatic legal authority when ${yName} turned 18. Recommend HCP, DPOA, Education POA, Living Will, HIPAA Authorization.`);
  }
  if (consNotes.length === 0) consNotes.push("Review any other planning concerns the clients raise.");

  // ── TP7: PRICING ────────────────────────────────────────────────────────────
  const pricingNotes = [];
  if (data.hasLegalPlan && data.legalPlan) {
    pricingNotes.push(`${data.legalPlan.name} legal plan — billing summary shown in proposal. Review covered documents with client.`);
    pricingNotes.push("Credit shelter / tax-planning trusts may require case manager approval — confirm with MetLife/ARAG before billing.");
  } else {
    pricingNotes.push(`Flat fee: ${data.flatFee || "[confirm]"} for ${data.plan.type || "the plan"}. Review proposal pricing table.`);
  }
  pricingNotes.push("Collect signed Engagement Agreement before beginning drafts.");
  pricingNotes.push("Target signing date: within 4–6 weeks of engagement.");

  // ── FIDUCIARY TABLE ──────────────────────────────────────────────────────────
  function fidRow(role, s1val, s2val) {
    const bg = ["Trustee", "Personal Representative", "Health Care Proxy Agent"].includes(role) ? L_TEAL : GRAY;
    const bold = ["Trustee", "Personal Representative", "Health Care Proxy Agent"].includes(role);
    if (isCouple) {
      return new TableRow({ children: [
        dataCell(role, 2600, bg, bold),
        dataCell(s1val || "[To be determined]", 3380),
        dataCell(s2val || "[To be determined]", 3380),
      ]});
    } else {
      return new TableRow({ children: [
        dataCell(role, 3360, bg, bold),
        dataCell(s1val || "[To be determined]", 6000),
      ]});
    }
  }

  const fid1 = shared.normalizeFiduciary(data.fiduciaries && data.fiduciaries.spouse1);
  const fid2 = shared.normalizeFiduciary(data.fiduciaries && data.fiduciaries.spouse2);
  const fidColWidths = isCouple ? [2600, 3380, 3380] : [3360, 6000];
  const fidHdrs = isCouple
    ? [hdrCell("Role", 2600), hdrCell(s1.firstName, 3380), hdrCell(s2.firstName, 3380)]
    : [hdrCell("Role", 3360), hdrCell("Your Appointments", 6000)];

  const fidRows = [
    new TableRow({ children: fidHdrs }),
    fidRow("Trustee", fid1.initialTrustee, fid2.initialTrustee),
    fidRow("Successor Trustee", fid1.successorTrustee, fid2.successorTrustee),
    fidRow("Personal Representative", fid1.personalRep, fid2.personalRep),
    fidRow("DPOA Agent", fid1.poaAgent, fid2.poaAgent),
    fidRow("Health Care Proxy Agent", fid1.hcpAgent, fid2.hcpAgent),
    ...(data.hasMinorChildren ? [fidRow("Guardian (minor children)", fid1.guardian, fid2.guardian)] : [])
  ];
  const fidNotesArr = shared.normalizeNotes(data.fiduciaries && data.fiduciaries.notes);
  if (fidNotesArr.length > 0) {
    const noteText = fidNotesArr.map(n => typeof n === "string" ? n : `${n.label ? n.label + ": " : ""}${n.body || ""}`).join("  •  ");
    fidRows.push(new TableRow({ children: [
      new TableCell({
        columnSpan: isCouple ? 3 : 2,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: AMBER, type: ShadingType.CLEAR },
        borders: noBorders(),
        margins: { top: 80, bottom: 80, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: "⚑  " + noteText, font: "Garamond", size: 18, color: "856404" })] })]
      })
    ]}));
  }
  const fidTable = new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: fidColWidths, rows: fidRows });

  // ── FLAGS ────────────────────────────────────────────────────────────────────
  const autoFlags = [];
  const children = data.children || [];
  const intake = !data.clients.address && !s1.dob;
  if (intake) autoFlags.push("Client intake not completed — confirm all family details at the meeting.");
  if (children.some(c => c.isMinor && !c.name)) autoFlags.push("Minor child name(s) not confirmed — verify ages and names for guardian nomination.");
  if (!data.assets.breakdown || data.assets.breakdown.length === 0) autoFlags.push(`No asset breakdown provided — estate stated as ${data.assets.grossEstateDisplay || "[unknown]"}. Verify composition before meeting.`);
  if (data.hasLegalPlan) autoFlags.push("Confirm MetLife/ARAG coverage for credit shelter / tax-planning trust with case manager before billing.");
  if (!fid1.initialTrustee) autoFlags.push("Fiduciary appointments: all unknown — walk through each role at the meeting.");
  if (data.flags && data.flags.length > 0) data.flags.forEach(f => autoFlags.push(f));

  // ── BODY CONTENT ─────────────────────────────────────────────────────────────
  const body = [
    matterTable,
    spacer(200),
    sectionHdr("Meeting Roadmap"),
    spacer(80),
    ...talkPt("1", "Welcome & Overview (5 min)", welcomeNotes),
    spacer(80),
    ...talkPt("2", "Family & Goals Review (5 min)", familyNotes),
    spacer(80),
    ...talkPt("3", "MA Estate Tax Analysis (10 min)", taxNotes),
    spacer(80),
    ...talkPt("4", "Recommended Plan (10 min)", planNotes),
    spacer(80),
    ...talkPt("5", "Fiduciary Appointments (10 min)", fidNotes),
    spacer(80),
    new Paragraph({ spacing: { before: 200, after: 60 } }),
    fidTable,
    spacer(80),
    ...talkPt("6", "Additional Considerations (5 min)", consNotes),
    spacer(80),
    ...talkPt("7", "Pricing & Next Steps (5 min)", pricingNotes),
  ];

  if (autoFlags.length > 0) {
    body.push(spacer(160));
    body.push(new Paragraph({
      children: [new TextRun({ text: "⚑  FLAGS FOR REVIEW BEFORE MEETING", font: "Garamond", size: 22, bold: true, color: "856404" })],
      spacing: { before: 120, after: 80 }
    }));
    body.push(new Table({
      width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      rows: autoFlags.map(f => new TableRow({ children: [flagCell(f)] }))
    }));
  }

  body.push(spacer(120));
  body.push(new Paragraph({
    children: [new TextRun({ text: "CONFIDENTIAL — ATTORNEY USE ONLY", font: "Garamond", size: 18, color: "AAAAAA", italics: true })],
    alignment: AlignmentType.CENTER
  }));

  const doc = new Document({
    numbering: NUMBERING,
    sections: [{
      properties: PAGE_PROPS,
      headers: { default: makeHeader() },
      footers: { default: makeFooter("Consultation Agenda — Confidential") },
      children: [
        ...titleBlock("CONSULTATION AGENDA", `Aubrey Law  |  Peace of Mind Planning Session`, `${data.matter.date}  |  ${names}`),
        ...body
      ]
    }]
  });

  return Packer.toBuffer(doc);
};
