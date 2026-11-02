/**
 * Print-only CSS for the hidden receipt iframe.
 *
 * The receipt document is intentionally 72 mm wide (the printable area of an
 * 80 mm roll), has zero page margins and never declares a fixed/minimum height.
 * A page break is placed BEFORE each slip after the first one, so "Print Both"
 * produces two pages and there is no forced break (and therefore no blank
 * page/slip) after the last receipt.
 */
export const RECEIPT_PRINT_CSS = `
  @page {
    /* Let the printer driver supply the roll paper size (80 mm roll with a
       ~72 mm printable area). A fixed page height here makes the driver feed a
       whole page after a short receipt, which is the blank-slip bug. Note that
       "size: 72mm auto" is invalid CSS and is silently ignored by Chrome/Edge;
       the document width below is what keeps the receipt at 72 mm. */
    size: auto;
    margin: 0;
  }

  html,
  body {
    width: 72mm;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    color: #000000 !important;
    overflow: visible !important;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* Only the receipt document is ever laid out. */
  body > *:not(.print-document) {
    display: none !important;
  }

  .print-document {
    display: block !important;
    width: 72mm;
    max-width: 72mm;
    margin: 0;
    padding: 0;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
  }

  .print-slip {
    display: block !important;
    width: 72mm;
    max-width: 72mm;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0;
    padding: 0;
    overflow: visible !important;
    page-break-inside: auto;
    break-inside: auto;
  }

  /* Break BEFORE the second slip, never after the last one. */
  .print-slip + .print-slip {
    page-break-before: always;
    break-before: page;
  }

  .print-slip:last-child {
    page-break-after: auto !important;
    break-after: auto !important;
  }

  .receipt-paper,
  .kot-paper {
    position: static !important;
    display: block !important;
    width: 100% !important;
    max-width: none !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    background: #ffffff !important;
    color: #000000 !important;
    font-family: "Courier New", Courier, monospace;
    font-size: 11px;
    line-height: 1.3;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .receipt-badge,
  .kot-badge {
    display: none !important;
  }

  .receipt-header,
  .kot-header {
    text-align: center;
    margin: 0 0 6px;
  }

  .receipt-restaurant-name {
    font-size: 15px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .receipt-divider,
  .kot-divider {
    border: none;
    border-top: 1px dashed #000000;
    margin: 6px 0;
  }

  .receipt-double-divider {
    border: none;
    border-top: 2px dashed #000000;
    margin: 6px 0;
  }

  .receipt-row {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    margin: 2px 0;
  }

  .receipt-total-row {
    font-size: 13px;
    font-weight: 800;
    margin: 5px 0;
  }

  .receipt-footer {
    text-align: center;
    font-size: 10px;
    margin-top: 8px;
    color: #000000;
  }

  .kot-title {
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .kot-subtitle {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #000000;
  }

  .kot-meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    font-size: 10px;
  }

  .kot-label {
    font-weight: 700;
    margin-right: 3px;
  }

  .kot-val.highlight {
    font-size: 12px;
    font-weight: 900;
    background: #000000;
    color: #ffffff;
    padding: 0 4px;
    border-radius: 2px;
    display: inline-block;
  }

  .kot-order-notes {
    margin-top: 6px;
    padding: 4px 5px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 2px;
    font-size: 10px;
  }

  .kot-items-list {
    margin: 6px 0;
  }

  .kot-items-header {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 800;
    border-bottom: 2px solid #000000;
    padding-bottom: 3px;
    margin-bottom: 5px;
  }

  .kot-item-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 4px 0;
    border-bottom: 1px dotted #cccccc;
  }

  .kot-item-row:last-child {
    border-bottom: none;
  }

  .kot-item-qty {
    font-size: 15px;
    font-weight: 900;
    min-width: 30px;
    line-height: 1;
  }

  .kot-item-details {
    flex: 1;
  }

  .kot-item-name {
    font-size: 13px;
    font-weight: 800;
    line-height: 1.2;
  }

  .kot-item-note {
    font-size: 10px;
    font-weight: 600;
    color: #b91c1c;
    margin-top: 2px;
  }

  .kot-footer {
    text-align: center;
    margin-top: 8px;
  }
`;
