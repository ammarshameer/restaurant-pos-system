import type { ReceiptData, ReceiptItem } from '../../types/receipt.types';
import type { ReceiptPrintMode } from '../../components/receipt/ReceiptSlips';
import {
  formatReceiptDate,
  getOrderNumber,
  RECEIPT_RESTAURANT_NAME,
} from '../../components/receipt/ReceiptSlips';
import { formatPKR } from '../../utils/format';

// ESC/POS builder that mirrors the receipt-modal preview (ReceiptSlips.tsx)
// line for line, adapted to monospaced thermal columns. Both the local print
// bridge and direct-USB printing send these bytes, so what you preview is
// what the printer outputs. Layout constants are imported from the preview
// itself to keep the two in sync.

const ESC = 0x1b;
const GS = 0x1d;

export type CutMode = 'partial' | 'full' | 'none';

export interface EscPosOptions {
  cols?: number;
  cutMode?: CutMode;
  openDrawer?: boolean;
}

const DEFAULT_ADDRESS = 'Main Boulevard, Gulberg III, Lahore';
const DEFAULT_PHONE = '+92 (42) 3578-9000';

// Printers use a single-byte code page; keep output to plain ASCII.
const ascii = (s: unknown): string =>
  String(s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/↳/g, '>')
    .replace(/⚠️|⚠/g, '!')
    .replace(/👉/g, '*')
    .replace(/🍳/g, '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '');

class Builder {
  private bytes: number[] = [];

  constructor(
    private readonly cols: number,
    private readonly cutMode: CutMode
  ) {
    this.raw(ESC, 0x40); // initialize
  }

  private raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }

  private text(s: string): this {
    for (const ch of ascii(s)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }

  private line(s = ''): this {
    return this.text(s).raw(0x0a);
  }

  private align(a: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]);
  }

  private bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  private size(w: number, h: number): this {
    return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  }

  private rule(ch = '-'): this {
    return this.line(ch.repeat(this.cols));
  }

  private feed(n = 1): this {
    for (let i = 0; i < n; i++) this.raw(0x0a);
    return this;
  }

  // Left text and right text on one line; left wraps if too long.
  private row(left: string, right = ''): this {
    left = ascii(left);
    right = ascii(right);
    const room = this.cols - right.length - 1;
    const lines = wrap(left, Math.max(room, 8));
    lines.forEach((l, i) => {
      if (i === lines.length - 1) {
        this.line(l + ' '.repeat(Math.max(this.cols - l.length - right.length, 1)) + right);
      } else {
        this.line(l);
      }
    });
    return this;
  }

  // Three-column row: left label wraps in its column; mid and right are
  // right-aligned in fixed-width columns (used by the items table so the
  // printed slip has the same ITEM / PRICE / TOTAL columns as the preview).
  private row3(left: string, mid: string, right: string): this {
    const midW = Math.min(12, Math.floor(this.cols / 4));
    const rightW = Math.min(13, Math.floor(this.cols / 4) + 1);
    const leftW = this.cols - midW - rightW - 2;
    const lines = wrap(ascii(left), Math.max(leftW, 8));
    const m = ascii(mid).slice(-midW).padStart(midW);
    const r = ascii(right).slice(-rightW).padStart(rightW);
    lines.forEach((l, i) => {
      if (i === lines.length - 1) {
        this.line(l.padEnd(leftW) + ' ' + m + ' ' + r);
      } else {
        this.line(l);
      }
    });
    return this;
  }

  private wrapped(s: string, indent = 0): this {
    wrap(ascii(s), this.cols - indent).forEach((l) => this.line(' '.repeat(indent) + l));
    return this;
  }

  // ESC p m t1 t2 — pulse the cash-drawer kick pin (m=0 -> pin 2).
  private drawerKick(): this {
    return this.raw(ESC, 0x70, 0, 25, 250);
  }

  // Feed past the cutter blade, then cut. GS V 66 n feeds n dots then partial-cuts.
  private cut(): this {
    this.feed(3);
    if (this.cutMode === 'full') return this.raw(GS, 0x56, 65, 3);
    if (this.cutMode === 'none') return this;
    return this.raw(GS, 0x56, 66, 3);
  }

  customerSlip(r: ReceiptData): this {
    const orderNo = getOrderNumber(r);
    const when = formatReceiptDate(r.date);
    const type = (r.orderType || 'Dine In').toUpperCase();

    this.align('center').bold(true);
    this.size(2, 2).line(RECEIPT_RESTAURANT_NAME).size(1, 1).bold(false);
    this.wrapped(r.restaurant?.address || DEFAULT_ADDRESS);
    this.line('Tel: ' + (r.restaurant?.phone || DEFAULT_PHONE));
    this.align('left').rule();

    this.row('Order #: ' + orderNo, when);
    this.row('TYPE: ' + type, 'Cashier: ' + (r.server || 'Cashier'));
    if (r.customerName) this.row('Customer Name', r.customerName);
    if (r.customerPhone) this.row('Mobile No.', r.customerPhone);
    if (r.notes) this.wrapped(r.notes);
    this.rule();

    this.bold(true).row3('ITEM / QTY', 'PRICE', 'TOTAL').bold(false);
    for (const it of r.items || []) this.customerItem(it);
    this.rule();

    this.row('Subtotal', formatPKR(r.subtotal));
    if ((r.tax ?? 0) > 0) this.row(`Tax${r.taxRate ? ` (${r.taxRate}%)` : ''}`, formatPKR(r.tax));
    if ((r.serviceCharge ?? 0) > 0)
      this.row(
        `Service Charges${r.serviceChargeRate ? ` (${r.serviceChargeRate}%)` : ''}`,
        formatPKR(r.serviceCharge)
      );
    if ((r.deliveryCharge ?? 0) > 0) this.row('Delivery Charges', formatPKR(r.deliveryCharge));
    if ((r.tipAmount ?? 0) > 0) this.row('Tip', formatPKR(r.tipAmount));

    this.rule('=');
    this.bold(true).row('TOTAL AMOUNT', formatPKR(r.total)).bold(false);
    this.feed(1).row('Payment Method', (r.paymentMethod || 'CASH').toUpperCase());
    if ((r.totalPaid ?? 0) > 0) this.row('Amount Tendered', formatPKR(r.totalPaid));
    if ((r.change ?? 0) > 0) this.bold(true).row('Change Returned', formatPKR(r.change)).bold(false);

    this.rule().align('center');
    this.bold(true).line('Thank you for ordering with us!').bold(false);
    this.line('Please visit again soon.');
    this.line('*** OFFICIAL CUSTOMER RECEIPT ***');
    return this;
  }

  private customerItem(it: ReceiptItem): this {
    const total = it.total || it.unitPrice * it.quantity;
    this.row3(`${it.quantity}x ${it.name}`, formatPKR(it.unitPrice), formatPKR(total));
    (it.dealComponents || []).forEach((c) => this.wrapped('> ' + c, 3));
    if (it.notes) this.wrapped('* ' + it.notes, 3);
    return this;
  }

  kitchenSlip(r: ReceiptData): this {
    const orderNo = getOrderNumber(r);
    const when = formatReceiptDate(r.date);
    const type = (r.orderType || 'Dine In').toUpperCase();

    this.align('center').bold(true);
    this.size(2, 2).line('KITCHEN ORDER TICKET').size(1, 1);
    this.line('*** PREPARATION COPY ***').bold(false).align('left').rule();

    this.row('TICKET #:', '#' + orderNo);
    this.row('ORDER TYPE:', type);
    this.row('TIME:', when);
    this.row('SERVER:', r.server || 'Server');
    if (r.customerName) this.row('CUSTOMER:', r.customerName);
    if (r.customerPhone) this.row('MOBILE:', r.customerPhone);
    if (r.notes) {
      this.rule().bold(true).wrapped('ORDER DETAILS / INSTRUCTIONS: ' + r.notes).bold(false);
    }
    this.rule();

    this.bold(true).row('QTY', 'ITEM DESCRIPTION').bold(false);
    for (const it of r.items || []) this.kitchenItem(it);
    this.rule();

    const totalItems = (r.items || []).reduce((s, i) => s + i.quantity, 0);
    this.align('center').bold(true).line('TOTAL ITEMS: ' + totalItems).bold(false);
    this.line('*** END OF KITCHEN TICKET ***');
    return this;
  }

  private kitchenItem(it: ReceiptItem): this {
    const label = `${it.quantity}x`;
    wrap(ascii(it.name), this.cols - 6).forEach((l, i) => {
      this.line((i === 0 ? label.padEnd(6) : ' '.repeat(6)) + l);
    });
    (it.dealComponents || []).forEach((c) => this.wrapped('> ' + c, 6));
    if (it.notes) this.wrapped('* ' + it.notes, 6);
    return this;
  }

  end(openDrawer: boolean): this {
    if (openDrawer) this.drawerKick();
    return this;
  }

  cutSlip(): this {
    return this.cut();
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    let w = word;
    while (w.length > width) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur || !out.length) out.push(cur);
  return out;
}

// Each slip is cut separately so BOTH yields two physical tickets.
export function buildReceiptEscPos(
  receiptData: ReceiptData,
  mode: ReceiptPrintMode,
  { cols = 48, cutMode = 'partial', openDrawer = false }: EscPosOptions = {}
): Uint8Array {
  const b = new Builder(cols, cutMode);
  if (mode === 'BOTH' || mode === 'CUSTOMER') {
    b.customerSlip(receiptData).cutSlip();
  }
  if (mode === 'BOTH' || mode === 'KITCHEN') {
    b.kitchenSlip(receiptData).cutSlip();
  }
  return b.end(openDrawer).build();
}

export function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
