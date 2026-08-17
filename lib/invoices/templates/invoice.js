/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * invoice.js — client invoice.
 * Usage: require('./invoice')(data)
 *
 * Built programmatically rather than from a DOCX template asset because an
 * invoice is a generated statement with a variable-length line-item table and
 * computed totals — the same shape as metlife-claim.js, which this follows.
 * Branding comes from the PMPS template pack so an invoice looks like every
 * other Aubrey Law document; keep changes there backwards-compatible.
 *
 * This file never does arithmetic. Every total arrives pre-formatted from
 * lib/invoices/generate.ts, so the PDF and the on-screen preview cannot drift.
 */
'use strict';
const shared = require('../../pmps/templates/_shared');
const {
  docx, TEAL, NAVY, L_NAVY, GRAY,
  PAGE_PROPS, NUMBERING, hdrCell, dataCell, totalCell,
  spacer, sectionHdr, bodyP, makeHeader, makeFooter,
} = shared;

const { Document, Packer, Paragraph, TextRun, Table, TableRow,
  AlignmentType, WidthType, BorderStyle } = docx;

/** Description, amount. The amount column is fixed so long labels wrap. */
const LINE_WIDTHS = [7160, 2200];
/** Bill-to on the left, invoice facts on the right. */
const META_WIDTHS = [4680, 4680];

function right(text, width, bg, bold) {
  return dataCell(text, width, bg, bold || false, undefined, { alignment: AlignmentType.RIGHT });
}

function metaCell(width, heading, lines) {
  return new docx.TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    margins: { top: 80, bottom: 80, left: 0, right: 160 },
    children: [
      new Paragraph({
        spacing: { before: 0, after: 60 },
        children: [new TextRun({
          text: heading.toUpperCase(), font: 'Garamond', size: 18, bold: true, color: TEAL,
        })],
      }),
      ...lines.filter(Boolean).map(line => new Paragraph({
        spacing: { before: 0, after: 20 },
        children: [new TextRun({ text: line, font: 'Garamond', size: 20 })],
      })),
    ],
  });
}

function totalsRow(label, value, emphasis) {
  return new TableRow({
    cantSplit: true,
    children: emphasis
      ? [totalCell(label, LINE_WIDTHS[0]), totalCell(value, LINE_WIDTHS[1])]
      : [
        right(label, LINE_WIDTHS[0], 'FFFFFF', true),
        right(value, LINE_WIDTHS[1], 'FFFFFF', true),
      ],
  });
}

/**
 * @param {object} data see InvoiceRenderData in lib/invoices/types.ts
 * @returns {Promise<Buffer>}
 */
module.exports = async function generateInvoice(data) {
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: 'INVOICE', font: 'Garamond', size: 40, bold: true, color: NAVY })],
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 40 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: data.firm.name, font: 'Garamond', size: 24, color: GRAY })],
    spacing: { before: 0, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 6 } },
  }));
  children.push(spacer(160));

  children.push(new Table({
    width: { size: META_WIDTHS[0] + META_WIDTHS[1], type: WidthType.DXA },
    rows: [new TableRow({
      cantSplit: true,
      children: [
        metaCell(META_WIDTHS[0], 'Bill to', [
          data.billTo.name,
          data.billTo.email,
          data.billTo.matterName,
          data.billTo.matterNumber ? `Matter ${data.billTo.matterNumber}` : null,
        ]),
        metaCell(META_WIDTHS[1], 'Invoice', [
          `Number: ${data.invoiceNumber}`,
          `Issued: ${data.issueDate}`,
          `Due: ${data.dueDate}`,
        ]),
      ],
    })],
  }));

  children.push(spacer(280));

  const lineRows = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        hdrCell('Description', LINE_WIDTHS[0]),
        hdrCell('Amount', LINE_WIDTHS[1]),
      ],
    }),
    ...data.lines.map((line, index) => new TableRow({
      cantSplit: true,
      children: [
        dataCell(line.description, LINE_WIDTHS[0], index % 2 === 0 ? 'FFFFFF' : L_NAVY),
        right(line.amount, LINE_WIDTHS[1], index % 2 === 0 ? 'FFFFFF' : L_NAVY),
      ],
    })),
    totalsRow('Subtotal', data.subtotal, false),
  ];

  // Only shown on a reissue or a receipt — a first invoice has nothing applied.
  if (data.paymentsApplied) {
    lineRows.push(totalsRow('Payments applied', data.paymentsApplied, false));
  }
  lineRows.push(totalsRow('Balance due', data.balanceDue, true));

  children.push(new Table({
    width: { size: LINE_WIDTHS[0] + LINE_WIDTHS[1], type: WidthType.DXA },
    rows: lineRows,
  }));

  if (data.payLink) {
    children.push(spacer(280));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [new TableRow({
        cantSplit: true,
        children: [totalCell(`Pay online:  ${data.payLink}`, 9360)],
      })],
    }));
  }

  if (data.notes) {
    children.push(spacer(280));
    children.push(sectionHdr('Notes'));
    children.push(bodyP(data.notes));
  }

  if (data.terms) {
    children.push(spacer(200));
    children.push(sectionHdr('Payment terms'));
    children.push(bodyP(data.terms));
  }

  children.push(spacer(320));
  children.push(sectionHdr('Remit to'));
  children.push(bodyP(data.remitTo));

  const doc = new Document({
    numbering: NUMBERING,
    sections: [{
      properties: PAGE_PROPS,
      headers: { default: makeHeader() },
      footers: { default: makeFooter('Invoice') },
      children,
    }],
  });

  return Packer.toBuffer(doc);
};
