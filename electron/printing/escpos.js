'use strict';

const { DEFAULT_COLUMNS } = require('./constants');

const ESC = 0x1b;
const GS = 0x1d;

/** Shop title printed on every customer slip. */
const RESTAURANT_NAME = 'Dimlight Cafe';

const COMMANDS = {
  init: Buffer.from([ESC, 0x40]),
  alignLeft: Buffer.from([ESC, 0x61, 0x00]),
  alignCenter: Buffer.from([ESC, 0x61, 0x01]),
  alignRight: Buffer.from([ESC, 0x61, 0x02]),
  boldOn: Buffer.from([ESC, 0x45, 0x01]),
  boldOff: Buffer.from([ESC, 0x45, 0x00]),
  // GS ! n: bit 4 = double width, bit 0 = double height.
  sizeNormal: Buffer.from([GS, 0x21, 0x00]),
  sizeDouble: Buffer.from([GS, 0x21, 0x11]),
  // Partial cut: GS V m (m=1 is a partial cut on Epson-compatible printers).
  partialCut: Buffer.from([GS, 0x56, 0x01]),
  // ESC p m t1 t2: drawer pin 2, 50 ms on, 500 ms off.
  cashDrawer: Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]),
};

function feedCommand(lines = 1) {
  const count = Math.max(0, Math.min(255, Number(lines) || 0));
  return Buffer.from([ESC, 0x64, count]);
}

const TEXT_REPLACEMENTS = [
  [/[\u20b9\u20a8]/g, 'Rs'],
  [/[\u20ac]/g, 'EUR'],
  [/[\u00a3]/g, 'GBP'],
  [/[\u00a5]/g, 'JPY'],
  [/[\u2192]/g, '->'],
  [/[\u21b3]/g, '>'],
  [/[\u2022\u00b7]/g, '-'],
  [/[\u00d7]/g, 'x'],
  [/[\u2013\u2014]/g, '-'],
  [/[\u2018\u2019]/g, "'"],
  [/[\u201c\u201d]/g, '"'],
  [/[\u2026]/g, '...'],
  [/[\u26a0\ufe0f\u26a0]/g, '!'],
  [/[\u2702\ufe0f\u2702]/g, ''],
  [/[\u2705\u2713]/g, ''],
  [/[\u2717\u2718]/g, 'x'],
  [/[\ud83c\udf73]/g, ''], // 🍳
  [/[\ud83c\udf81]/g, ''], // 🎁
  [/[\ud83d\udc49]/g, '>'], // 👉
  [/[\u00a9]/g, '(c)'],
  [/[\u00ae]/g, '(r)'],
  [/[\u2122]/g, '(tm)'],
];

/**
 * ESC/POS printers generally expect a single-byte code page. Transliterate the
 * few symbols used by the POS UI so receipts never contain mojibake.
 */
function sanitizeText(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\r\n?/g, '\n');
  // Keep tab/newline/printable ASCII only.
  return text.replace(/[^\t\n\x20-\x7e]/g, '?');
}

function formatMoney(value) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `PKR ${safe.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatReceiptDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
}

function getOrderNumber(receipt) {
  return String(receipt.orderNumber || receipt.orderId?.slice(0, 6) || '101');
}

class EscPosBuilder {
  constructor(columns = DEFAULT_COLUMNS) {
    this.columns = Math.max(24, Number(columns) || DEFAULT_COLUMNS);
    this.parts = [];
  }

  raw(buffer) {
    if (buffer && buffer.length) this.parts.push(buffer);
    return this;
  }

  init() {
    return this.raw(COMMANDS.init);
  }

  align(direction = 'left') {
    const command =
      direction === 'center'
        ? COMMANDS.alignCenter
        : direction === 'right'
          ? COMMANDS.alignRight
          : COMMANDS.alignLeft;
    return this.raw(command);
  }

  bold(enabled = true) {
    return this.raw(enabled ? COMMANDS.boldOn : COMMANDS.boldOff);
  }

  doubleSize(enabled = true) {
    return this.raw(enabled ? COMMANDS.sizeDouble : COMMANDS.sizeNormal);
  }

  text(value = '') {
    const clean = sanitizeText(value);
    for (const line of clean.split('\n')) {
      this.parts.push(Buffer.from(`${line}\n`, 'ascii'));
    }
    return this;
  }

  line(left, right, width = this.columns) {
    const leftText = sanitizeText(left);
    const rightText = sanitizeText(right);
    const available = Math.max(1, width - rightText.length);
    const leftPart = leftText.length > available ? leftText.slice(0, available) : leftText;
    const gap = Math.max(1, width - leftPart.length - rightText.length);
    return this.text(`${leftPart}${' '.repeat(gap)}${rightText}`);
  }

  /**
   * Three-column row: left label wraps inside its column; mid and right are
   * right-aligned in fixed-width columns (ITEM / PRICE / TOTAL table).
   */
  line3(left, mid, right) {
    const midW = Math.min(12, Math.floor(this.columns / 4));
    const rightW = Math.min(13, Math.floor(this.columns / 4) + 1);
    const leftW = this.columns - midW - rightW - 2;
    const words = sanitizeText(left).trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const word of words) {
      if (word.length > leftW) {
        if (cur) {
          lines.push(cur);
          cur = '';
        }
        let rest = word;
        while (rest.length > leftW) {
          lines.push(rest.slice(0, leftW));
          rest = rest.slice(leftW);
        }
        cur = rest;
        continue;
      }
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length <= leftW) cur = candidate;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur || !lines.length) lines.push(cur);

    const midText = sanitizeText(mid).slice(-midW).padStart(midW);
    const rightText = sanitizeText(right).slice(-rightW).padStart(rightW);
    lines.forEach((l, i) => {
      if (i === lines.length - 1) {
        this.text(`${l.padEnd(leftW)} ${midText} ${rightText}`);
      } else {
        this.text(l);
      }
    });
    return this;
  }

  wrapped(value, width = this.columns, indent = '') {
    const paragraphs = sanitizeText(value).split('\n');
    const safeWidth = Math.max(8, width);
    const indentText = sanitizeText(indent);
    const firstLineWidth = Math.max(8, safeWidth - indentText.length);

    for (const paragraph of paragraphs) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        this.text(indentText);
        continue;
      }

      let current = '';
      let currentWidth = firstLineWidth;

      const flush = () => {
        if (current) {
          this.text(`${indentText}${current}`);
          current = '';
          currentWidth = safeWidth;
        }
      };

      for (const word of words) {
        if (word.length > currentWidth) {
          flush();
          let remainder = word;
          while (remainder.length > safeWidth) {
            this.text(`${indentText}${remainder.slice(0, safeWidth)}`);
            remainder = remainder.slice(safeWidth);
          }
          current = remainder;
          currentWidth = safeWidth;
          continue;
        }

        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= currentWidth) {
          current = candidate;
        } else {
          flush();
          current = word;
          currentWidth = safeWidth;
        }
      }
      flush();
    }
    return this;
  }

  divider(character = '-') {
    return this.text(String(character || '-').repeat(this.columns));
  }

  feed(lines = 1) {
    return this.raw(feedCommand(lines));
  }

  cut() {
    return this.raw(COMMANDS.partialCut);
  }

  drawer() {
    return this.raw(COMMANDS.cashDrawer);
  }

  build() {
    return Buffer.concat(this.parts);
  }
}

const DEFAULT_ADDRESS = 'Main Boulevard, Gulberg III, Lahore';
const DEFAULT_PHONE = '+92 (42) 3578-9000';

function buildCustomerSlip(receipt, options = {}) {
  const columns = options.columns || DEFAULT_COLUMNS;
  const builder = new EscPosBuilder(columns);
  const restaurant = receipt.restaurant || {};
  const orderNumber = getOrderNumber(receipt);
  const orderType = String(receipt.orderType || 'Dine In').toUpperCase();
  const cashier = receipt.server || 'Cashier';
  const formattedDate = formatReceiptDate(receipt.date);

  builder
    .init()
    .align('center')
    .bold(true)
    .doubleSize(true)
    .text(RESTAURANT_NAME)
    .doubleSize(false)
    .bold(false);

  builder.wrapped(restaurant.address || DEFAULT_ADDRESS, columns);
  builder.text(`Tel: ${restaurant.phone || DEFAULT_PHONE}`);

  builder
    .divider()
    .align('left')
    .line(`Order #: ${orderNumber}`, formattedDate, columns)
    .line(`TYPE: ${orderType}`, `Cashier: ${cashier}`, columns);

  if (receipt.customerName) {
    builder.line('Customer Name', receipt.customerName, columns);
  }
  if (receipt.customerPhone) {
    builder.line('Mobile No.', receipt.customerPhone, columns);
  }

  if (receipt.notes) {
    builder.wrapped(receipt.notes, columns);
  }

  builder.divider().bold(true).line3('ITEM / QTY', 'PRICE', 'TOTAL').bold(false);

  for (const item of Array.isArray(receipt.items) ? receipt.items : []) {
    const quantity = Number(item.quantity) || 1;
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
    const itemTotal = Number(item.total ?? unitPrice * quantity);

    builder.line3(`${quantity}x ${item.name || 'Item'}`, formatMoney(unitPrice), formatMoney(itemTotal));

    if (Array.isArray(item.dealComponents)) {
      for (const component of item.dealComponents) {
        builder.wrapped(`   > ${component}`, columns);
      }
    }
    if (item.notes) {
      builder.wrapped(`   * ${item.notes}`, columns);
    }
  }

  builder
    .divider()
    .line('Subtotal', formatMoney(receipt.subtotal), columns);

  if (Number(receipt.tax) > 0) {
    builder.line(
      `Tax${receipt.taxRate ? ` (${receipt.taxRate}%)` : ''}`,
      formatMoney(receipt.tax),
      columns
    );
  }
  if (Number(receipt.serviceCharge) > 0) {
    builder.line(
      `Service Charges${receipt.serviceChargeRate ? ` (${receipt.serviceChargeRate}%)` : ''}`,
      formatMoney(receipt.serviceCharge),
      columns
    );
  }
  if (Number(receipt.deliveryCharge) > 0) {
    builder.line('Delivery Charges', formatMoney(receipt.deliveryCharge), columns);
  }
  if (Number(receipt.tipAmount) > 0) {
    builder.line('Tip', formatMoney(receipt.tipAmount), columns);
  }

  builder
    .divider('=')
    .bold(true)
    .line('TOTAL AMOUNT', formatMoney(receipt.total), columns)
    .bold(false)
    .feed(1)
    .line('Payment Method', String(receipt.paymentMethod || 'CASH').toUpperCase(), columns);

  if (Number(receipt.totalPaid) > 0) {
    builder.line('Amount Tendered', formatMoney(receipt.totalPaid), columns);
  }
  if (Number(receipt.change) > 0) {
    builder.line('Change Returned', formatMoney(receipt.change), columns);
  }

  builder
    .divider()
    .align('center')
    .bold(true)
    .text('Thank you for ordering with us!')
    .bold(false)
    .text('Please visit again soon.')
    .text('*** OFFICIAL CUSTOMER RECEIPT ***');

  return builder;
}

function buildKitchenSlip(receipt, options = {}) {
  const columns = options.columns || DEFAULT_COLUMNS;
  const builder = new EscPosBuilder(columns);
  const orderNumber = getOrderNumber(receipt);
  const orderType = String(receipt.orderType || 'Dine In').toUpperCase();
  const cashier = receipt.server || 'Server';
  const formattedDate = formatReceiptDate(receipt.date);

  builder
    .init()
    .align('center')
    .bold(true)
    .doubleSize(true)
    .text('KITCHEN ORDER TICKET')
    .doubleSize(false)
    .text('*** PREPARATION COPY ***')
    .bold(false)
    .divider()
    .align('left')
    .line('TICKET #:', `#${orderNumber}`, columns)
    .line('ORDER TYPE:', orderType, columns)
    .line('TIME:', formattedDate, columns)
    .line('SERVER:', cashier, columns);

  if (receipt.customerName) {
    builder.line('CUSTOMER:', receipt.customerName, columns);
  }
  if (receipt.customerPhone) {
    builder.line('MOBILE:', receipt.customerPhone, columns);
  }

  if (receipt.notes) {
    builder
      .divider()
      .bold(true)
      .wrapped(`ORDER DETAILS / INSTRUCTIONS: ${receipt.notes}`, columns)
      .bold(false);
  }

  builder.divider().bold(true).line('QTY', 'ITEM DESCRIPTION', columns).bold(false);

  for (const item of Array.isArray(receipt.items) ? receipt.items : []) {
    const quantity = Number(item.quantity) || 1;
    builder.bold(true).wrapped(`${quantity}x  ${item.name || 'Item'}`, columns).bold(false);

    if (Array.isArray(item.dealComponents)) {
      for (const component of item.dealComponents) {
        builder.wrapped(`   > ${component}`, columns);
      }
    }
    if (item.notes) {
      builder.wrapped(`   * ${item.notes}`, columns);
    }
  }

  const totalItems = (Array.isArray(receipt.items) ? receipt.items : []).reduce(
    (sum, item) => sum + (Number(item.quantity) || 1),
    0
  );

  builder
    .divider()
    .align('center')
    .bold(true)
    .text(`TOTAL ITEMS: ${totalItems}`)
    .bold(false)
    .text('*** END OF KITCHEN TICKET ***');

  return builder;
}

/**
 * Builds the full ESC/POS byte stream for one or both slips. Each slip ends
 * with a feed and exactly one partial cut.
 */
function buildReceiptEscPos(receipt, options = {}) {
  const mode = options.mode === 'CUSTOMER' || options.mode === 'KITCHEN' ? options.mode : 'BOTH';
  const columns = options.columns || DEFAULT_COLUMNS;
  const openDrawer = Boolean(options.openDrawer);
  const chunks = [];

  if (mode === 'CUSTOMER' || mode === 'BOTH') {
    const customer = buildCustomerSlip(receipt, { columns });
    if (openDrawer) customer.drawer();
    customer.feed(4).cut();
    chunks.push(customer.build());
  }

  if (mode === 'KITCHEN' || mode === 'BOTH') {
    const kitchen = buildKitchenSlip(receipt, { columns });
    if (openDrawer && mode === 'KITCHEN') kitchen.drawer();
    kitchen.feed(4).cut();
    chunks.push(kitchen.build());
  }

  return Buffer.concat(chunks);
}

function buildTestEscPos(options = {}) {
  const columns = options.columns || DEFAULT_COLUMNS;
  const builder = new EscPosBuilder(columns);

  builder
    .init()
    .align('center')
    .bold(true)
    .doubleSize(true)
    .text('PRINT TEST')
    .doubleSize(false)
    .bold(false)
    .text('Restaurant POS Print Helper')
    .feed(1)
    .divider()
    .align('left')
    .line('Printer', options.printerName || '(current)', columns)
    .line('Time', formatReceiptDate(new Date()), columns)
    .divider()
    .align('center')
    .text('If you can read this, RAW printing is working.')
    .text('*** TEST RECEIPT ***')
    .feed(4)
    .cut();

  return builder.build();
}

module.exports = {
  COMMANDS,
  EscPosBuilder,
  sanitizeText,
  formatMoney,
  formatReceiptDate,
  buildCustomerSlip,
  buildKitchenSlip,
  buildReceiptEscPos,
  buildTestEscPos,
};
