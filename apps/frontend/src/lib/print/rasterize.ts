import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import html2canvas from 'html2canvas';
import { CustomerSlip, KitchenSlip } from '../../components/receipt/ReceiptSlips';
import type { ReceiptPrintMode } from '../../components/receipt/ReceiptSlips';
import type { ReceiptData } from '../../types/receipt.types';
import type { CutMode } from './escpos';

// Renders the real slip components offscreen and packs them as ESC/POS raster
// graphics (GS v 0), so the printed ticket is pixel-identical to the preview —
// same fonts, borders, spacing, everything.

const ESC = 0x1b;
const GS = 0x1d;

// Printable dot width: 576 for 80mm paper (72mm @ 8 dots/mm), 384 for 58mm.
function dotsForCols(cols: number): number {
  return cols <= 32 ? 384 : 576;
}

async function renderSlip(
  receiptData: ReceiptData,
  mode: 'CUSTOMER' | 'KITCHEN',
  targetWidth: number
): Promise<Uint8Array> {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:360px;background:#ffffff;padding:0;margin:0;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        mode === 'CUSTOMER'
          ? React.createElement(CustomerSlip, { receiptData })
          : React.createElement(KitchenSlip, { receiptData })
      )
    );
    await document.fonts?.ready;
    const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
      backgroundColor: '#ffffff',
      scale: targetWidth / 360,
      logging: false,
    });
    return canvasToRaster(canvas);
  } finally {
    root.unmount();
    host.remove();
  }
}

// Packs the canvas as 1bpp raster data for the ESC/POS "GS v 0" command:
// each byte is 8 horizontal dots, MSB = leftmost dot.
function canvasToRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const { width, height } = canvas;
  const bytesPerRow = Math.ceil(width / 8);
  const paddedWidth = bytesPerRow * 8;
  const img = ctx.getImageData(0, 0, width, height).data;
  const raster = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < paddedWidth; x++) {
      let black = false;
      if (x < width) {
        const i = (y * width + x) * 4;
        // Luminance threshold for 1-bit dither-free output.
        black = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114 < 140;
      }
      if (black) raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return raster;
}

function rasterCommand(raster: Uint8Array, dotsWide: number): number[] {
  const bytesPerRow = Math.ceil(dotsWide / 8);
  const rows = raster.length / bytesPerRow;
  return [
    GS, 0x76, 0x30, 0x00, // GS v 0, mode normal
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    rows & 0xff, (rows >> 8) & 0xff,
    ...raster,
  ];
}

function cutCommand(cutMode: CutMode): number[] {
  const bytes = [0x0a, 0x0a, 0x0a]; // feed past the cutter
  if (cutMode === 'full') bytes.push(GS, 0x56, 65, 3);
  else if (cutMode === 'partial') bytes.push(GS, 0x56, 66, 3);
  return bytes;
}

/**
 * Builds a complete raster ESC/POS job: the same slips the modal previews,
 * rendered to bitmaps, each followed by feed + cut.
 */
export async function buildReceiptRasterEscPos(
  receiptData: ReceiptData,
  mode: ReceiptPrintMode,
  { cols = 48, cutMode = 'partial', openDrawer = false }: { cols?: number; cutMode?: CutMode; openDrawer?: boolean } = {}
): Promise<Uint8Array> {
  const dots = dotsForCols(cols);
  const bytes: number[] = [ESC, 0x40]; // init

  if (mode === 'BOTH' || mode === 'CUSTOMER') {
    bytes.push(...rasterCommand(await renderSlip(receiptData, 'CUSTOMER', dots), dots));
    bytes.push(...cutCommand(cutMode));
  }
  if (mode === 'BOTH' || mode === 'KITCHEN') {
    bytes.push(...rasterCommand(await renderSlip(receiptData, 'KITCHEN', dots), dots));
    bytes.push(...cutCommand(cutMode));
  }
  if (openDrawer) bytes.push(ESC, 0x70, 0, 25, 250); // drawer kick

  return Uint8Array.from(bytes);
}
