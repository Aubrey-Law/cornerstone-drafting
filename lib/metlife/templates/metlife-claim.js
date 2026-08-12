/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
/**
 * metlife-claim.js — MetLife Legal Plan reimbursement claim checklist.
 * Usage: require('./metlife-claim')(data)
 *
 * Two documents in one file: a print-ready checklist Scott works from while
 * entering the claim, and a Portal Submission Table the submit-metlife-claim
 * skill drives the attorney portal from. Every total is passed in already
 * summed by lib/metlife/assemble.ts — this file never does arithmetic.
 *
 * Branding helpers come from the PMPS template pack so a claim looks like every
 * other Aubrey Law document; keep changes there backwards-compatible.
 */
'use strict';
const shared = require('../../pmps/templates/_shared');
const {
  docx, TEAL, NAVY, L_NAVY, GRAY,
  PAGE_PROPS, NUMBERING, hdrCell, dataCell, totalCell,
  spacer, sectionHdr, bodyP, makeHeader, makeFooter, titleBlock
} = shared;

const { Document, Packer, Paragraph, TextRun, Table, TableRow,
  AlignmentType, WidthType } = docx;

const CHECKBOX = '☐';

/** Checklist columns: checkbox, document, fee, comment. */
const CHECK_WIDTHS = [520, 3900, 1140, 3800];
/** Portal columns: #, document, service type, fee, comment, complete. */
const PORTAL_WIDTHS = [520, 2900, 2000, 1000, 2140, 800];

function right(text, width, bg, bold) {
  return dataCell(text, width, bg, bold || false, undefined, { alignment: AlignmentType.RIGHT });
}

function infoRow(label, value) {
  return new TableRow({
    cantSplit: true,
    children: [dataCell(label, 2600, L_NAVY, true), dataCell(value, 6760)],
  });
}

function checklistTable(section) {
  const rows = [
    new TableRow({
      cantSplit: true,
      children: [hdrCell('', CHECK_WIDTHS[0]), hdrCell('Document', CHECK_WIDTHS[1]),
        hdrCell('Fee', CHECK_WIDTHS[2]), hdrCell('Comment', CHECK_WIDTHS[3])],
    }),
  ];
  section.items.forEach((item, index) => {
    const bg = index % 2 === 0 ? 'FFFFFF' : GRAY;
    rows.push(new TableRow({
      cantSplit: true,
      children: [
        dataCell(CHECKBOX, CHECK_WIDTHS[0], bg, false, undefined, { alignment: AlignmentType.CENTER }),
        dataCell(item.document, CHECK_WIDTHS[1], bg),
        right(item.fee, CHECK_WIDTHS[2], bg),
        dataCell(item.comment, CHECK_WIDTHS[3], bg),
      ],
    }));
  });
  rows.push(new TableRow({
    cantSplit: true,
    children: [
      totalCell('', CHECK_WIDTHS[0]),
      totalCell('TOTAL', CHECK_WIDTHS[1]),
      totalCell(section.total, CHECK_WIDTHS[2]),
      totalCell('', CHECK_WIDTHS[3]),
    ],
  }));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: CHECK_WIDTHS, rows });
}

function portalTable(rows) {
  const tableRows = [
    new TableRow({
      cantSplit: true,
      children: [hdrCell('#', PORTAL_WIDTHS[0]), hdrCell('Document', PORTAL_WIDTHS[1]),
        hdrCell('Service Type', PORTAL_WIDTHS[2]), hdrCell('Fee', PORTAL_WIDTHS[3]),
        hdrCell('Comment', PORTAL_WIDTHS[4]), hdrCell('Complete', PORTAL_WIDTHS[5])],
    }),
  ];
  rows.forEach((row, index) => {
    const bg = index % 2 === 0 ? 'FFFFFF' : GRAY;
    tableRows.push(new TableRow({
      cantSplit: true,
      children: [
        dataCell(String(row.index), PORTAL_WIDTHS[0], bg, false, undefined, { alignment: AlignmentType.CENTER }),
        dataCell(row.document, PORTAL_WIDTHS[1], bg),
        dataCell(row.serviceType, PORTAL_WIDTHS[2], bg),
        right(row.fee, PORTAL_WIDTHS[3], bg),
        dataCell(row.comment, PORTAL_WIDTHS[4], bg),
        dataCell(row.complete, PORTAL_WIDTHS[5], bg, false, undefined, { alignment: AlignmentType.CENTER }),
      ],
    }));
  });
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: PORTAL_WIDTHS, rows: tableRows });
}

module.exports = function generateMetlifeClaim(data) {
  const children = [];

  const infoRows = [
    infoRow('Member ID', data.memberId),
    infoRow('Member', data.memberName),
  ];
  if (data.spouseName) infoRows.push(infoRow('Spouse', data.spouseName));
  infoRows.push(infoRow('Work started', data.serviceStart));
  infoRows.push(infoRow('Work finished', data.serviceEnd));
  infoRows.push(infoRow('Date submitted', data.dateSubmitted));
  if (data.matterNumber) infoRows.push(infoRow('Matter', data.matterNumber));
  infoRows.push(new TableRow({
    cantSplit: true,
    children: [totalCell('Total Claim', 2600), totalCell(data.grandTotal, 6760)],
  }));

  children.push(new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2600, 6760],
    rows: infoRows,
  }));

  data.sections.forEach(section => {
    children.push(sectionHdr(section.title));
    children.push(checklistTable(section));
  });

  children.push(spacer(200));
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 120, after: 120 },
    children: [new TextRun({ text: `GRAND TOTAL  ${data.grandTotal}`, font: 'Garamond', size: 30, bold: true, color: NAVY })],
  }));

  children.push(sectionHdr('Portal Submission Table', NAVY, { pageBreakBefore: true }));
  children.push(bodyP(
    `${data.submissionRows.length} submission${data.submissionRows.length === 1 ? '' : 's'} — enter one per line item on the MetLife attorney portal.`,
    { italics: true, size: 18 },
  ));
  children.push(spacer(80));
  children.push(portalTable(data.submissionRows));

  const doc = new Document({
    numbering: NUMBERING,
    sections: [{
      properties: PAGE_PROPS,
      headers: { default: makeHeader() },
      footers: { default: makeFooter('MetLife claim — draft pending attorney review') },
      children: [
        ...titleBlock('METLIFE CLAIM', data.planTypeLabel, data.dateSubmitted),
        ...children,
      ],
    }],
  });

  return Packer.toBuffer(doc);
};
