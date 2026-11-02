import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiptPrintContent } from '../../components/receipt/ReceiptSlips';
import type { ReceiptPrintMode } from '../../components/receipt/ReceiptSlips';
import type { ReceiptData } from '../../types/receipt.types';
import { RECEIPT_PRINT_CSS } from './receiptPrintCss';

export function buildReceiptPrintHtml(receiptData: ReceiptData, mode: ReceiptPrintMode): string {
  const markup = renderToStaticMarkup(
    <ReceiptPrintContent receiptData={receiptData} mode={mode} />
  );

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Receipt</title>
    <style>${RECEIPT_PRINT_CSS}</style>
  </head>
  <body>${markup}</body>
</html>`;
}

/**
 * Prints only the requested receipt(s) from a dedicated hidden iframe document.
 * This avoids printing the app shell, modal chrome or any other page content.
 */
export async function printReceiptInBrowser(
  receiptData: ReceiptData,
  mode: ReceiptPrintMode
): Promise<void> {
  const html = buildReceiptPrintHtml(receiptData, mode);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Receipt print document');
  // Do not use display:none: some browsers will not print a display:none frame.
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:72mm;height:1px;border:0;margin:0;padding:0;';

  const loaded = new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    iframe.onload = done;
    iframe.srcdoc = html;

    // Safety net for browsers that do not fire onload for srcdoc frames.
    window.setTimeout(done, 750);
  });

  document.body.appendChild(iframe);
  await loaded;

  const printWindow = iframe.contentWindow;
  if (!printWindow) {
    iframe.remove();
    throw new Error('Could not create the receipt print document.');
  }

  // Give the iframe one paint before opening the print dialog.
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.setTimeout(() => iframe.remove(), 500);
  };

  printWindow.addEventListener('afterprint', cleanup, { once: true });
  printWindow.focus();
  printWindow.print();

  // If afterprint is not fired (some Chromium builds), remove the frame later.
  window.setTimeout(cleanup, 60000);
}
