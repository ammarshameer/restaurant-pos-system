'use strict';

// ESC/POS builder for 80mm (48 col) / 58mm (32 col) thermal printers.

const ESC = 0x1b;
const GS = 0x1d;

const money = (n) =>
  'PKR ' +
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Printers use a single-byte code page; keep output to plain ASCII.
const ascii = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u21b3/g, '>')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '');

class Builder {
  constructor(cols, cutMode) {
    this.cols = cols;
    this.cutMode = cutMode;
    this.bytes = [];
    this.raw(ESC, 0x40); // initialize
  }

  raw(...b) {
    this.bytes.push(...b);
    return this;
  }

  text(s) {
    for (const ch of ascii(s)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }

  line(s = '') {
    return this.text(s).raw(0x0a);
  }

  align(a) {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]);
  }

  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  size(w, h) {
    return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  }

  rule(ch = '-') {
    return this.line(ch.repeat(this.cols));
  }

  // Left text and right text on one line; left wraps if too long.
  row(left, right = '') {
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

  wrapped(s, indent = 0) {
    wrap(ascii(s), this.cols - indent).forEach((l) => this.line(' '.repeat(indent) + l));
    return this;
  }

  // Feed past the cutter blade, then cut. GS V 66 n feeds n dots then partial-cuts.
  cut() {
    this.line().line().line();
    if (this.cutMode === 'full') return this.raw(GS, 0x56, 65, 3);
    if (this.cutMode === 'none') return this;
    return this.raw(GS, 0x56, 66, 3);
  }

  build() {
    return Buffer.from(this.bytes);
  }
}

function wrap(s, width) {
  const out = [];
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

function header(r) {
  const orderNo = String(r.orderNumber || (r.orderId || '').slice(0, 6) || '');
  const when = r.date ? new Date(r.date) : new Date();
  return {
    orderNo,
    when: when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    type: r.orderType || 'Dine In',
  };
}

function customerSlip(b, r) {
  const h = header(r);
  const rest = r.restaurant || {};
  b.align('center').bold(true).size(2, 2).line(rest.name || 'Restaurant').size(1, 1).bold(false);
  if (rest.address) b.wrapped(rest.address);
  if (rest.phone) b.line('Tel: ' + rest.phone);
  b.line().bold(true).line('CUSTOMER RECEIPT').bold(false).align('left').rule();
  b.row('Order #: ' + h.orderNo, h.when);
  b.row('Type: ' + h.type.toUpperCase(), 'Cashier: ' + (r.server || 'Cashier'));
  if (r.table) b.line('Table: ' + r.table);
  if (r.notes) b.wrapped('Note: ' + r.notes);
  b.rule();
  b.bold(true).row('ITEM', 'TOTAL').bold(false).rule();
  for (const it of r.items || []) {
    const total = it.total || it.unitPrice * it.quantity;
    b.row(`${it.quantity}x ${it.name}`, money(total));
    if (it.quantity > 1) b.line(`   @ ${money(it.unitPrice)}`);
    (it.dealComponents || []).forEach((c) => b.wrapped('> ' + c, 3));
    if (it.notes) b.wrapped('* ' + it.notes, 3);
  }
  b.rule();
  b.row('Subtotal', money(r.subtotal));
  if (r.tax > 0) b.row(`Tax${r.taxRate ? ` (${r.taxRate}%)` : ''}`, money(r.tax));
  if (r.serviceCharge > 0)
    b.row(`Service${r.serviceChargeRate ? ` (${r.serviceChargeRate}%)` : ''}`, money(r.serviceCharge));
  if (r.deliveryCharge > 0) b.row('Delivery', money(r.deliveryCharge));
  if (r.tipAmount > 0) b.row('Tip', money(r.tipAmount));
  b.rule('=');
  b.bold(true).row('TOTAL', money(r.total)).bold(false);
  b.line().row('Payment', r.paymentMethod || 'CASH');
  if (r.totalPaid > 0) b.row('Tendered', money(r.totalPaid));
  if (r.change > 0) b.bold(true).row('Change', money(r.change)).bold(false);
  b.rule().align('center').bold(true).line('Thank you for ordering with us!').bold(false);
  b.line('Please visit again soon.');
}

function kitchenSlip(b, r) {
  const h = header(r);
  b.align('center').bold(true).size(2, 2).line('KITCHEN ORDER').size(1, 1).bold(false);
  b.line('*** PREPARATION COPY ***').align('left').rule();
  b.bold(true).size(2, 1).line('Ticket #' + h.orderNo).size(1, 1);
  b.line(h.type.toUpperCase()).bold(false);
  b.line('Time: ' + h.when);
  b.line('Server: ' + (r.server || 'Server'));
  if (r.table) b.line('Table: ' + r.table);
  if (r.notes) b.bold(true).wrapped('NOTE: ' + r.notes).bold(false);
  b.rule();
  for (const it of r.items || []) {
    b.bold(true).size(1, 2).wrapped(`${it.quantity}x ${it.name}`).size(1, 1).bold(false);
    (it.dealComponents || []).forEach((c) => b.wrapped('> ' + c, 3));
    if (it.notes) b.bold(true).wrapped('* ' + it.notes, 3).bold(false);
  }
  b.rule();
}

// Each slip is cut separately so BOTH yields two physical tickets.
function buildJob(receiptData, mode, { cols = 48, cutMode = 'partial' } = {}) {
  const b = new Builder(cols, cutMode);
  if (mode === 'BOTH' || mode === 'CUSTOMER') {
    customerSlip(b, receiptData);
    b.cut();
  }
  if (mode === 'BOTH' || mode === 'KITCHEN') {
    kitchenSlip(b, receiptData);
    b.cut();
  }
  return b.build();
}

module.exports = { buildJob };
