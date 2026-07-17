/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * _shared.js — Shared branding, helpers, and docx utilities for all PMPS templates.
 * All templates require this file: const shared = require('./_shared');
 *
 * NOTE: This file is shared between pmps-proposal and pmps-one-page-summary.
 * Keep changes backwards-compatible.
 */

'use strict';

const docx = require('docx');

const {
  BorderStyle, WidthType, ShadingType, AlignmentType,
  VerticalAlign, LevelFormat, PageNumber, Header, Footer,
  ImageRun, Paragraph, TextRun, Table, TableRow, TableCell,
  PageBreak, HeightRule
} = docx;

const fs = require('fs');
const path = require('path');

// ── BRAND CONSTANTS ──────────────────────────────────────────────────────────
const TEAL    = "1A7A6D";
const NAVY    = "1B3A5C";
const L_TEAL  = "E8F5F3";
const L_NAVY  = "EDF0F5";
const GRAY    = "F5F5F5";
const AMBER   = "FFF3CD";
const AMBER_B = "FFC107";
const BLACK   = "000000";          // Body text — always pure black, never 333333
const RED     = "CC0000";          // CONFIDENTIAL banner
const PINK_BG = "FDECEA";          // "Without Planning" column background in tax table
const HDR_RULE = "666666";         // Subtle separator in header line

const LOGO_PATH = path.join(__dirname, 'assets', 'aubrey-law-logo.png');

const PAGE_PROPS = {
  page: {
    size: { width: 12240, height: 15840 },
    margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
  }
};

const NUMBERING = {
  config: [
    { reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 480, hanging: 240 } } } }] },
    { reference: "sub-bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 960, hanging: 240 } } } }] },
    { reference: "numbers",
      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 480, hanging: 240 } } } }] },
  ]
};

// ── BORDER FACTORIES ─────────────────────────────────────────────────────────
function bdr(color = "CCCCCC", size = 4) {
  return { style: BorderStyle.SINGLE, size, color };
}
function allBorders(color = "CCCCCC") {
  const b = bdr(color);
  return { top: b, bottom: b, left: b, right: b };
}
function noBorders() {
  const nb = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: nb, bottom: nb, left: nb, right: nb };
}
function thinBorders() { return allBorders("DDDDDD"); }

// ── CELL FACTORIES ───────────────────────────────────────────────────────────
function hdrCell(text, width, bg = NAVY) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    borders: noBorders(),
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      keepNext: true, keepLines: true,
      children: [new TextRun({ text, font: "Garamond", size: 20, bold: true, color: "FFFFFF" })]
    })]
  });
}

function dataCell(text, width, bg = "FFFFFF", bold = false, color = BLACK, opts = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    borders: thinBorders(),
    margins: { top: 80, bottom: 80, left: 160, right: 160 },
    verticalAlign: opts.verticalAlign || VerticalAlign.CENTER,
    children: [new Paragraph({
      keepNext: true, keepLines: true,
      alignment: opts.alignment || undefined,
      children: [new TextRun({ text, font: "Garamond", size: 20, bold, color, italics: opts.italics || false })]
    })]
  });
}

function totalCell(text, width, bg = TEAL, color = "FFFFFF") {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    borders: noBorders(),
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      keepNext: true, keepLines: true,
      children: [new TextRun({ text, font: "Garamond", size: 22, bold: true, color })]
    })]
  });
}

function flagCell(text, width = 9360) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: AMBER, type: ShadingType.CLEAR },
    borders: {
      top: bdr(AMBER_B), bottom: bdr(AMBER_B),
      left: { style: BorderStyle.SINGLE, size: 12, color: AMBER_B },
      right: bdr(AMBER_B)
    },
    margins: { top: 100, bottom: 100, left: 200, right: 200 },
    children: [new Paragraph({
      children: [new TextRun({ text: "⚑  " + text, font: "Garamond", size: 20, color: "856404" })]
    })]
  });
}

// ── PARAGRAPH FACTORIES ──────────────────────────────────────────────────────
function spacer(size = 120) {
  return new Paragraph({ children: [new TextRun("")], spacing: { before: size, after: 0 } });
}

function sectionHdr(text, color = NAVY, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: "Garamond", size: 32, bold: true, color })],
    spacing: { before: 280, after: 140 },
    keepNext: true, keepLines: true,
    pageBreakBefore: opts.pageBreakBefore || false,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL, space: 4 } }
  });
}

/** H2 subsection header — black, slightly smaller, no border. */
function subSectionHdr(text, color = BLACK, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: "Garamond", size: 26, bold: true, color })],
    spacing: { before: 200, after: 80 },
    keepNext: true, keepLines: true,
    pageBreakBefore: opts.pageBreakBefore || false
  });
}

/** Bold inline-prefix paragraph: "Label: rest of text..." */
function labeledP(label, body, opts = {}) {
  return new Paragraph({
    children: [
      new TextRun({ text: label, font: "Garamond", size: 22, bold: true, color: BLACK }),
      new TextRun({ text: body, font: "Garamond", size: 22, color: BLACK })
    ],
    keepNext: opts.keepNext || false,
    keepLines: true,
    spacing: { before: 80, after: 80 },
    alignment: opts.alignment || undefined
  });
}

/** Bullet with bold label + body: "• Label: body text..." */
function labeledBullet(label, body) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [
      new TextRun({ text: label, font: "Garamond", size: 22, bold: true, color: BLACK }),
      new TextRun({ text: body, font: "Garamond", size: 22, color: BLACK })
    ],
    spacing: { before: 60, after: 60 },
    keepLines: true
  });
}

function bodyP(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({
      text,
      font: "Garamond",
      size: opts.size || 22,
      color: opts.color || BLACK,
      bold: opts.bold || false,
      italics: opts.italics || false
    })],
    keepNext: opts.keepNext || false,
    keepLines: true,
    spacing: { before: 80, after: 80 },
    alignment: opts.alignment || undefined
  });
}

function bulletP(text, bold = false) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [new TextRun({ text, font: "Garamond", size: 22, color: BLACK, bold })],
    spacing: { before: 40, after: 40 },
    keepLines: true
  });
}

function numP(text) {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    children: [new TextRun({ text, font: "Garamond", size: 22, color: BLACK })],
    spacing: { before: 60, after: 60 },
    keepLines: true
  });
}

function subBulletP(text) {
  return new Paragraph({
    numbering: { reference: "sub-bullets", level: 0 },
    children: [new TextRun({ text, font: "Garamond", size: 20, color: BLACK })],
    spacing: { before: 20, after: 20 },
    keepLines: true
  });
}

// ── HEADER / FOOTER ──────────────────────────────────────────────────────────
/** Legacy empty header used by pmps-one-page-summary (preserves existing behavior). */
function makeHeader() {
  return new Header({
    children: [new Paragraph({
      children: [],
    })]
  });
}

/** Legacy footer used by pmps-one-page-summary: contact line + page number on right. */
function makeFooter(docType) {
  return new Footer({
    children: [new Paragraph({
      children: [
        new TextRun({ text: `Aubrey Law  |  scott@aubreylegal.com  |  Needham, MA  |  `, font: "Garamond", size: 16, color: BLACK }),
        new TextRun({ text: docType, font: "Garamond", size: 16, color: BLACK, italics: true }),
        new TextRun({ text: "\t", font: "Garamond", size: 16 }),
        new TextRun({ text: "Page ", font: "Garamond", size: 16, color: BLACK }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Garamond", size: 16, color: BLACK }),
      ],
      tabStops: [{ type: "right", position: 9360 }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: TEAL, space: 4 } }
    })]
  });
}

/**
 * Header for the Estate Plan Proposal: text-based, no logo.
 * "AUBREY LAW  |  Estate Plan Proposal  |  {client identifier}"
 * with a teal bottom rule.
 */
function makeHeaderProposal(docType, clientId) {
  return new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 8 } },
      spacing: { after: 60 },
      children: [
        new TextRun({ text: "AUBREY LAW", font: "Garamond", size: 20, bold: true, color: BLACK }),
        new TextRun({ text: "  |  ", font: "Garamond", size: 20, color: HDR_RULE }),
        new TextRun({ text: `${docType || "Document"}`, font: "Garamond", size: 20, color: BLACK }),
        ...(clientId ? [
          new TextRun({ text: "  |  ", font: "Garamond", size: 20, color: HDR_RULE }),
          new TextRun({ text: clientId, font: "Garamond", size: 20, color: BLACK })
        ] : [])
      ]
    })]
  });
}

/**
 * Footer for the Estate Plan Proposal: centered
 * "Confidential Attorney Work Product  |  Page N"  with a teal top rule.
 */
function makeFooterProposal(_docType) {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: TEAL, space: 4 } },
      children: [
        new TextRun({ text: "Confidential Attorney Work Product  |  Page ", font: "Garamond", size: 20, color: BLACK }),
        new TextRun({ children: [PageNumber.CURRENT], font: "Garamond", size: 20, color: BLACK })
      ]
    })]
  });
}

// ── TITLE BLOCK ──────────────────────────────────────────────────────────────
/**
 * Cover page title block matching the reference Estate Plan Proposal.
 *   ESTATE PLAN PROPOSAL  (large, navy, centered, with teal rule under it)
 *   {Client Name(s)}      (large bold, centered, black)
 *   Prepared by
 *   Scott Aubrey, Esq.
 *   CONFIDENTIAL ATTORNEY-CLIENT COMMUNICATION  (small red italic, centered)
 * Followed by a page break so body starts on page 2.
 */
function titleBlockCover(clientNamesText) {
  return [
    // Top spacer to vertically push the title down a bit
    new Paragraph({ children: [new TextRun("")], spacing: { before: 1800, after: 0 } }),

    // ESTATE PLAN PROPOSAL — navy, large, centered
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "ESTATE PLAN PROPOSAL", font: "Garamond", size: 60, bold: true, color: NAVY })]
    }),

    // Teal rule
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 16 } },
      spacing: { after: 40 },
      children: []
    }),

    // Spacer
    new Paragraph({ children: [new TextRun("")], spacing: { before: 280, after: 0 } }),

    // Client names — large bold black, centered
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: clientNamesText, font: "Garamond", size: 36, bold: true, color: BLACK })]
    }),

    // Spacer
    new Paragraph({ children: [new TextRun("")], spacing: { before: 700, after: 0 } }),

    // "Prepared by"
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 },
      children: [new TextRun({ text: "Prepared by", font: "Garamond", size: 20, color: BLACK })]
    }),

    // Scott Aubrey, Esq.
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: "Scott Aubrey, Esq.", font: "Garamond", size: 26, bold: true, color: BLACK })]
    }),

    // Big spacer
    new Paragraph({ children: [new TextRun("")], spacing: { before: 900, after: 0 } }),

    // CONFIDENTIAL banner
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: "CONFIDENTIAL ATTORNEY-CLIENT COMMUNICATION",
        font: "Garamond", size: 18, bold: true, italics: true, color: RED
      })]
    }),

    // Page break — body content starts on page 2
    new Paragraph({ children: [new PageBreak()] })
  ];
}

/** Legacy title block used by pmps-one-page-summary. */
function titleBlock(title, subtitle, date) {
  return [
    new Paragraph({
      children: [new TextRun({ text: title, font: "Garamond", size: 32, bold: true, color: NAVY })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 }
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, font: "Garamond", size: 26, color: BLACK, italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60 }
    }),
    new Paragraph({
      children: [new TextRun({ text: date, font: "Garamond", size: 20, color: BLACK })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 280 }
    })
  ];
}

// ── CLIENT NAME HELPERS ──────────────────────────────────────────────────────
function clientNames(data) {
  const s1 = data.clients.spouse1.fullName;
  if (data.clients.type === "couple") return `${s1} and ${data.clients.spouse2.fullName}`;
  return s1;
}

/** "Miller – Bethlehem" for couples with different last names, "Smith" otherwise. */
function clientIdentifier(data) {
  const s1Last = data.clients.spouse1.lastName || "";
  if (data.clients.type === "couple") {
    const s2Last = data.clients.spouse2.lastName || "";
    if (s1Last && s2Last && s1Last.toLowerCase() !== s2Last.toLowerCase()) {
      return `${s1Last} – ${s2Last}`;
    }
  }
  return s1Last || data.matter.filePrefix || "";
}

function fmt(n) {
  if (n == null || n === 0) return "$0";
  return "$" + Number(n).toLocaleString();
}

// ── PLAN STRUCTURE RESOLVER ──────────────────────────────────────────────────
// Master switch (added 2026). Derives booleans from data.plan.planStructure when
// present; falls back to the legacy top-level booleans when absent so existing
// data still renders. See references/pmps-planstructure-mapping.md.
//   "joint_outright"    couple, joint trust, outright; NO credit shelter; 1 exemption
//   "joint_disclaimer"  couple, joint trust; disclaimer → both exemptions ($4M) if timely
//   "separate_clayton"  couple, 2 trusts + credit shelter + Clayton; both exemptions ($4M)
//   "individual_single" single person; 1 exemption; no spouse/CS/Clayton/QTIP
function resolvePlanStructure(data) {
  const plan = data.plan || {};
  const ps = plan.planStructure || null;
  const isCoupleData = data.clients && data.clients.type === "couple";
  let isCouple, hasCreditShelter, clayton, maQtip, disclaimer;
  switch (ps) {
    case "joint_outright":
      isCouple = true;  hasCreditShelter = false; clayton = false; maQtip = false; disclaimer = false; break;
    case "joint_disclaimer":
      isCouple = true;  hasCreditShelter = true;  clayton = false; maQtip = true;  disclaimer = true;  break;
    case "separate_clayton":
      isCouple = true;  hasCreditShelter = true;  clayton = true;  maQtip = true;  disclaimer = false; break;
    case "individual_single":
      isCouple = false; hasCreditShelter = false; clayton = false; maQtip = false; disclaimer = false; break;
    default:
      isCouple = isCoupleData;
      hasCreditShelter = !!(isCoupleData && data.hasCreditShelter);
      clayton = !!plan.clayton;
      maQtip = !!plan.maQtip;
      disclaimer = false;
  }
  if (plan.clayton != null) clayton = !!plan.clayton;
  if (plan.maQtip  != null) maQtip  = !!plan.maQtip;
  return {
    planStructure: ps, isCouple, hasCreditShelter, clayton, maQtip, disclaimer,
    isSeparateTrusts: ps === "separate_clayton",
    isJointTrust: ps === "joint_outright" || ps === "joint_disclaimer",
    isIndividual: ps === "individual_single" || (!ps && !isCoupleData)
  };
}

// Accept BOTH legacy keys (trustee, successorTrustee) and current schema keys
// (initialTrustee, successorTrustees[]). Returns flat display strings.
function normalizeFiduciary(fid) {
  fid = fid || {};
  const initialTrustee = fid.initialTrustee || fid.trustee || "";
  let successor = "";
  if (Array.isArray(fid.successorTrustees) && fid.successorTrustees.length) {
    successor = fid.successorTrustees.join(", then ");
  } else if (fid.successorTrustee) {
    successor = fid.successorTrustee;
  } else if (fid.trustee && !fid.initialTrustee) {
    successor = fid.trustee;
  }
  return {
    initialTrustee, successorTrustee: successor,
    successorTrustees: Array.isArray(fid.successorTrustees) ? fid.successorTrustees : (successor ? [successor] : []),
    personalRep: fid.personalRep || "",
    poaAgent: fid.poaAgent || "", poaSuccessor: fid.poaSuccessor || "",
    hcpAgent: fid.hcpAgent || "", hcpSuccessor: fid.hcpSuccessor || "",
    guardian: fid.guardian || ""
  };
}

function normalizeNotes(notes) {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes;
  return [notes];
}

// ── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  docx,
  TEAL, NAVY, L_TEAL, L_NAVY, GRAY, AMBER, AMBER_B, BLACK, RED, PINK_BG, HDR_RULE,
  PAGE_PROPS, NUMBERING,
  bdr, allBorders, noBorders, thinBorders,
  hdrCell, dataCell, totalCell, flagCell,
  spacer, sectionHdr, subSectionHdr, bodyP, bulletP, numP, subBulletP,
  labeledP, labeledBullet,
  makeHeader, makeFooter,                  // legacy — used by pmps-one-page-summary
  makeHeaderProposal, makeFooterProposal,  // new — used by pmps-proposal
  titleBlock, titleBlockCover,
  clientNames, clientIdentifier, fmt,
  resolvePlanStructure, normalizeFiduciary, normalizeNotes
};
