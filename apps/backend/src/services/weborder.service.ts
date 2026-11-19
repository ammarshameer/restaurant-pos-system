import { PrismaClient, Prisma } from '@prisma/client';
import { getIO } from '../websocket';
import { normalizePhone, digitsOnly, PHONE_FORMAT_ERROR } from '../utils/phone';
import { validateLogo } from '../utils/validateLogo';
import { InventoryService } from './inventory.service';

const prisma = new PrismaClient();
const inventoryService = new InventoryService();

/**
 * Database seam used by unit tests: swap in an in-memory fake so the
 * service logic can be tested without a live database.
 */
export function setPrismaForTests(fake: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (globalThis as any).__weborderDb = fake;
  (weborderDbRef as any).target = fake;
}
const weborderDbRef: { target: any } = { target: prisma };
const db: any = new Proxy({}, {
  get(_t, prop) {
    const current = (globalThis as any).__weborderDb || weborderDbRef.target;
    return (current as any)[prop];
  },
});

// ============================================
// SLUG VALIDATION
// ============================================

const RESERVED_SLUGS = new Set([
  'api', 'public', 'admin', 'administrator', 'login', 'logout', 'auth', 'app',
  'm', 'www', 'pos', 'kitchen', 'orders', 'order', 'menu', 'settings', 'platform',
  'dashboard', 'invoices', 'payments', 'employees', 'customers', 'inventory',
  'deals', 'roles', 'analytics', 'expenses', 'payroll', 'dues', 'costing',
  'health', 'socket.io', 'static', 'assets', 'new', 'null', 'undefined',
]);

export interface SlugValidation {
  valid: boolean;
  error?: string;
}

/** Validate a website slug: lowercase letters, numbers and hyphens only, reserved words blocked. */
export function validateWebsiteSlug(raw: string): SlugValidation {
  const slug = String(raw || '').trim().toLowerCase();
  if (!slug) return { valid: false, error: 'Slug is required' };
  if (slug.length < 3) return { valid: false, error: 'Slug must be at least 3 characters' };
  if (slug.length > 40) return { valid: false, error: 'Slug must be at most 40 characters' };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { valid: false, error: 'Only lowercase letters, numbers and hyphens are allowed' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { valid: false, error: `"${slug}" is a reserved word and cannot be used` };
  }
  return { valid: true };
}

function slugifyName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Default slug derived from the Business Code (name slug + short id suffix when needed). */
export function defaultSlugFor(businessCode: string): string {
  const base = slugifyName(businessCode) || 'store';
  return base;
}

// ============================================
// OPENING HOURS
// ============================================

export interface DayHours {
  closed?: boolean;
  open?: string; // "11:00"
  close?: string; // "23:00"
}

export type OpeningHours = Partial<Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', DayHours>>;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function parseOpeningHours(json: string | null | undefined): OpeningHours {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function toMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Whether the restaurant is open at the given time. Overnight windows
 * (close < open, e.g. 18:00 -> 02:00) wrap past midnight.
 */
export function isOpenAt(hoursJson: string | null | undefined, date: Date): boolean {
  const hours = parseOpeningHours(hoursJson);
  const key = DAY_KEYS[date.getDay()];
  const day = hours[key];
  if (!day) return true; // No configured hours -> always open
  if (day.closed) return false;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (open === null || close === null) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  if (close <= open) {
    // Overnight window, e.g. 18:00 -> 02:00
    return now >= open || now < close;
  }
  return now >= open && now < close;
}

// ============================================
// PRICING (server-authoritative)
// ============================================

export interface ClientOrderItem {
  id?: string;
  qty?: number;
  modifiers?: Array<{ id?: string; qty?: number }>;
  notes?: string;
}

export interface QuotedModifier {
  group?: string;
  name: string;
  price: number;
  modifierId: string;
}

export interface QuotedItem {
  menuItemId?: string;
  dealId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  modifiers: QuotedModifier[];
  notes: string | null;
}

export interface Quote {
  items: QuotedItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}

/**
 * Re-price an order from the database. Client-supplied prices are ignored
 * entirely — this protects against price tampering.
 */
export function quoteItems(
  clientItems: ClientOrderItem[],
  menuItems: any[],
  deals: any[]
): Quote | { error: string } {
  const itemById = new Map(menuItems.map((i) => [i.id, i]));
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const items: QuotedItem[] = [];

  for (const ci of clientItems) {
    const qty = Math.floor(Number(ci.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
      return { error: 'Invalid item quantity' };
    }

    let unitPrice = 0;
    let name = '';
    let menuItemId: string | undefined;
    let dealId: string | undefined;

    if (ci.id && dealById.has(ci.id)) {
      const deal = dealById.get(ci.id)!;
      if (!deal.isActive) return { error: 'One of the items is no longer available' };
      unitPrice = Number(deal.price) || 0;
      name = deal.name;
      dealId = deal.id;
    } else {
      const item = ci.id ? itemById.get(ci.id) : null;
      if (!item) return { error: 'One of the items is no longer on the menu' };
      if (!item.isAvailable || item.is86d) {
        return { error: `"${item.name}" is sold out right now` };
      }
      unitPrice = Number(item.price) || 0;
      name = item.name;
      menuItemId = item.id;
    }

    // Resolve modifiers from the database; unknown or mis-matched modifier
    // ids are rejected so prices always come from our own menu.
    const quotedModifiers: QuotedModifier[] = [];
    const allowedModifiers = menuItemId
      ? (itemById.get(menuItemId)?.modifiers || []).flatMap((g: any) =>
          (g.modifiers || []).map((m: any) => ({ group: g.name, ...m })))
      : [];
    for (const cm of Array.isArray(ci.modifiers) ? ci.modifiers : []) {
      const modId = cm && cm.id;
      if (!modId || !menuItemId) return { error: 'Invalid option selection' };
      const mod = allowedModifiers.find((m: any) => m.id === modId);
      if (!mod) return { error: 'Invalid option selection' };
      quotedModifiers.push({
        group: mod.group,
        name: mod.name,
        price: Number(mod.price) || 0,
        modifierId: mod.id,
      });
    }

    const modifierTotal = quotedModifiers.reduce((s, m) => s + m.price, 0);
    const lineTotal = (unitPrice + modifierTotal) * qty;
    items.push({
      menuItemId,
      dealId,
      name,
      qty,
      unitPrice: unitPrice + modifierTotal,
      lineTotal,
      modifiers: quotedModifiers,
      notes: sanitizeText(ci.notes, 200, { maxLineBreaks: MAX_NOTE_LINE_BREAKS }),
    });
  }

  if (items.length === 0) return { error: 'Your cart is empty' };

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return { items, subtotal, deliveryFee: 0, total: subtotal };
}

// ============================================
// TEXT SANITIZATION
// ============================================

/** Notes may span a few lines; names, addresses and other fields may not. */
export const MAX_NOTE_LINE_BREAKS = 3;

export interface SanitizeTextOptions {
  /** Maximum line breaks to keep (default 3). 0 collapses them into spaces. */
  maxLineBreaks?: number;
}

/**
 * Strip control characters and clamp length for any customer-provided text.
 * Multi-line notes keep up to three line breaks; single-line fields such as
 * customer names and addresses pass maxLineBreaks: 0 to collapse them.
 */
export function sanitizeText(
  input: unknown,
  maxLen: number,
  options: SanitizeTextOptions = {}
): string | null {
  if (input === undefined || input === null) return null;
  const s = String(input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!s) return null;

  const maxLineBreaks = options.maxLineBreaks ?? MAX_NOTE_LINE_BREAKS;
  const cleaned = maxLineBreaks > 0
    ? s.split('\n').map((line) => line.trim()).slice(0, maxLineBreaks + 1).join('\n')
    : s.replace(/\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

/**
 * Website images can be either a remote HTTPS URL or a (potentially large)
 * base64 data URL uploaded from the settings screen. They must NOT be clamped
 * with sanitizeText(): that corrupts base64 payloads and leaves a broken image.
 */
const MAX_IMAGE_URL_LENGTH = 3_000_000; // ~2 MB decoded

export function sanitizeImageField(
  input: unknown,
  label = 'Image'
): { value?: string | null; error?: string } {
  if (input === undefined) return {};
  if (input === null || input === '') return { value: null };

  const value = String(input).trim();
  if (!value) return { value: null };
  if (value.length > MAX_IMAGE_URL_LENGTH) {
    return { error: `${label} is too large. Please upload an image smaller than 2 MB.` };
  }

  const check = validateLogo(value);
  if (!check.valid) {
    return { error: check.error || `${label} must be a valid HTTPS URL or PNG/JPEG/WebP image.` };
  }
  return { value };
}

// ============================================
// SPAM PROTECTION
// ============================================

export const RATE_LIMITS = {
  MAX_ORDERS_PER_PHONE_PER_HOUR: 3,
  MAX_ORDERS_PER_IP_PER_HOUR: 10,
} as const;

export async function checkPhoneSpam(restaurantId: string, phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await db.webOrder.count({
    where: { restaurantId, customerPhone: phone, createdAt: { gte: since } },
  });
  return count < RATE_LIMITS.MAX_ORDERS_PER_PHONE_PER_HOUR;
}

// ============================================
// WHATSAPP MESSAGE
// ============================================

const rs = (n: number) => `Rs ${Math.round(n * 100) / 100}`;

export interface WhatsAppMessageOptions {
  reference: string;
  businessName: string;
  items: QuotedItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  orderType: string;
  customerName: string;
  customerPhone: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  paymentNote?: string | null;
  notes?: string | null;
}

export function buildWhatsAppMessage(opts: WhatsAppMessageOptions): string {
  const lines: string[] = [];
  lines.push(`New order ${opts.reference} - ${opts.businessName}`);
  for (const item of opts.items) {
    let line = `${item.qty} x ${item.name} - ${rs(item.lineTotal)}`;
    if (item.modifiers && item.modifiers.length > 0) {
      line += ` (${item.modifiers.map((m) => m.name).join(', ')})`;
    }
    lines.push(line);
  }
  lines.push(`Subtotal: ${rs(opts.subtotal)}`);
  if (opts.orderType === 'DELIVERY') {
    lines.push(`Delivery: ${rs(opts.deliveryFee)}`);
  }
  lines.push(`Total: ${rs(opts.total)}`);
  lines.push(`Order type: ${opts.orderType === 'DELIVERY' ? 'Delivery' : 'Pickup'}`);
  lines.push(`Name: ${opts.customerName}`);
  lines.push(`Phone: ${formatPhoneDisplayForMessage(opts.customerPhone)}`);
  if (opts.orderType === 'DELIVERY' && opts.address) {
    lines.push(`Address: ${opts.address}`);
  }
  if (opts.lat != null && opts.lng != null) {
    lines.push(`Map: https://www.google.com/maps?q=${opts.lat},${opts.lng}`);
  }
  if (opts.paymentNote) {
    lines.push(`Payment: ${opts.paymentNote}`);
  }
  if (opts.notes) {
    lines.push(`Notes: ${opts.notes}`);
  }
  return lines.join('\n');
}

export function formatPhoneDisplayForMessage(digits: string): string {
  return '+' + digitsOnly(digits);
}

export function buildWhatsAppUrl(phoneDigits: string, message: string): string {
  return `https://wa.me/${digitsOnly(phoneDigits)}?text=${encodeURIComponent(message)}`;
}

/** wa.me links longer than this are unreliable on some phones / WhatsApp clients. */
export const MAX_WHATSAPP_URL_LENGTH = 1800;

/** Compact message used when a full order would produce an over-long wa.me link. */
export function buildShortWhatsAppMessage(opts: {
  reference: string;
  businessName: string;
  items: QuotedItem[];
  total: number;
  customerName: string;
  customerPhone: string;
}): string {
  const itemCount = opts.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  return [
    `New order ${opts.reference} - ${opts.businessName}`,
    `Total: ${rs(opts.total)}`,
    `Items: ${itemCount}`,
    `Name: ${opts.customerName}`,
    `Phone: ${formatPhoneDisplayForMessage(opts.customerPhone)}`,
    `Full details are in the order system under ${opts.reference}`,
  ].join('\n');
}

/** Shorten the message only when the encoded wa.me URL would exceed the limit. */
export function buildWhatsAppUrlForMessage(
  phoneDigits: string,
  fullMessage: string,
  shortOpts: Parameters<typeof buildShortWhatsAppMessage>[0]
): string {
  const fullUrl = buildWhatsAppUrl(phoneDigits, fullMessage);
  if (fullUrl.length <= MAX_WHATSAPP_URL_LENGTH) return fullUrl;
  return buildWhatsAppUrl(phoneDigits, buildShortWhatsAppMessage(shortOpts));
}

/** Rebuild the WhatsApp link for an order already saved in the database. */
export function whatsappUrlForStoredOrder(restaurant: any, order: any): string {
  const items: QuotedItem[] = (order.items || []).map((item: any) => {
    let modifiers: QuotedModifier[] = [];
    try {
      const parsed = JSON.parse(item.modifiers || '[]');
      if (Array.isArray(parsed)) modifiers = parsed;
    } catch {
      // Keep an empty modifier list when stored JSON is unreadable.
    }
    const unitPrice = Number(item.unitPrice) || 0;
    const qty = Number(item.qty) || 0;
    return {
      menuItemId: item.menuItemId || undefined,
      dealId: item.dealId || undefined,
      name: item.name,
      qty,
      unitPrice,
      lineTotal: unitPrice * qty,
      modifiers,
      notes: item.notes || null,
    };
  });

  const opts: WhatsAppMessageOptions = {
    reference: order.reference,
    businessName: restaurant.name,
    items,
    subtotal: Number(order.subtotal) || 0,
    deliveryFee: Number(order.deliveryFee) || 0,
    total: Number(order.total) || 0,
    orderType: order.orderType,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: order.address,
    lat: order.lat,
    lng: order.lng,
    paymentNote: restaurant.websitePaymentNote,
    notes: order.notes,
  };
  return buildWhatsAppUrlForMessage(
    restaurant.whatsappNumber || '',
    buildWhatsAppMessage(opts),
    opts
  );
}

// ============================================
// REFERENCE
// ============================================

export function generateReference(): string {
  return `W-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function nextReference(restaurantId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const ref = generateReference();
    const clash = await db.webOrder.findFirst({ where: { restaurantId, reference: ref }, select: { id: true } });
    if (!clash) return ref;
  }
  // Extremely unlikely: fall back to a timestamp-based reference
  return `W-${Date.now().toString().slice(-6)}`;
}

// ============================================
// PUBLIC MENU
// ============================================

export async function getPublicRestaurantBySlug(slug: string) {
  const restaurant = await db.restaurant.findUnique({
    where: { websiteSlug: String(slug || '').toLowerCase() },
  });
  return restaurant;
}

export async function getPublicMenu(restaurant: any) {
  const [categories, menuItems, deals] = await Promise.all([
    db.category.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true, displayOrder: true },
    }),
    db.menuItem.findMany({
      where: { restaurantId: restaurant.id },
      include: {
        category: { select: { id: true, name: true } },
        modifiers: { include: { modifiers: true } },
      },
      orderBy: { name: 'asc' },
    }),
    db.deal.findMany({
      where: { restaurantId: restaurant.id, isActive: true },
      include: { items: { include: { menuItem: { select: { id: true, name: true } } } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const open = isOpenAt(restaurant.websiteOpeningHours, new Date());
  const orderTypes = String(restaurant.websiteOrderTypes || 'DELIVERY,PICKUP')
    .split(',')
    .map((t: string) => t.trim())
    .filter(Boolean);

  // Public menu never exposes cost, stock or staff data.
  return {
    business: {
      name: restaurant.name,
      slug: restaurant.websiteSlug,
      logoUrl: restaurant.logoUrl,
      coverUrl: restaurant.websiteCoverUrl,
      about: restaurant.websiteAbout,
      phone: null,
      palette: restaurant.themePalette,
      orderingEnabled: restaurant.onlineOrderingEnabled,
      open,
      openingHours: parseOpeningHours(restaurant.websiteOpeningHours),
      orderTypes,
      deliveryFee: Number(restaurant.websiteDeliveryFee) || 0,
      freeDeliveryAbove: restaurant.websiteFreeDeliveryAbove != null ? Number(restaurant.websiteFreeDeliveryAbove) : null,
      minOrder: Number(restaurant.websiteMinOrder) || 0,
      paymentNote: restaurant.websitePaymentNote,
    },
    categories,
    items: menuItems.map((item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      imageUrl: item.imageUrl,
      isAvailable: item.isAvailable && !item.is86d,
      categoryId: item.categoryId,
      modifiers: (item.modifiers || []).map((group: any) => ({
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        options: (group.modifiers || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          price: m.price,
        })),
      })),
    })),
    deals: deals.map((deal: any) => ({
      id: deal.id,
      name: deal.name,
      description: deal.description,
      price: deal.price,
      imageUrl: deal.imageUrl,
      items: (deal.items || []).map((di: any) => ({ name: di.menuItem?.name, quantity: di.quantity })),
    })),
  };
}

// ============================================
// PUBLIC ORDER CREATION
// ============================================

export interface CreatePublicOrderInput {
  slug: string;
  items: ClientOrderItem[];
  name: string;
  phone: string;
  orderType: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
  paymentMethod?: string;
  cfToken?: string;
  /** Client-generated UUID so a retried submit never creates a second order. */
  clientRef?: string;
  ip?: string;
}

export async function verifyTurnstile(token: string | undefined, ip?: string): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Public ordering is exposed to the internet: never run it in production
    // without human verification. Rate limits alone are not enough.
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'Online ordering is temporarily unavailable. Please try again later.' };
    }
    return { ok: true }; // Development only -> rely on rate limits
  }
  if (!token) return { ok: false, error: 'Please complete the human verification' };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data: any = await res.json();
    if (data?.success) return { ok: true };
    return { ok: false, error: 'Verification failed, please try again' };
  } catch {
    return { ok: false, error: 'Verification service unavailable, please try again' };
  }
}

function findOrderByClientRef(restaurantId: string, clientRef: string) {
  return db.webOrder.findFirst({
    where: { restaurantId, clientRef },
    include: { items: true },
  });
}

function successfulOrderResult(restaurant: any, webOrder: any, duplicate = false) {
  return {
    webOrder,
    reference: webOrder.reference,
    total: Number(webOrder.total) || 0,
    whatsappUrl: whatsappUrlForStoredOrder(restaurant, webOrder),
    duplicate,
  };
}

export async function createPublicOrder(input: CreatePublicOrderInput) {
  const restaurant = await getPublicRestaurantBySlug(input.slug);
  if (!restaurant || !restaurant.isActive) {
    return { error: 'Not found', status: 404 };
  }
  if (!(await hasWebsiteModule(restaurant.id))) {
    return { error: 'Not found', status: 404 };
  }

  if (!restaurant.onlineOrderingEnabled) {
    return { error: 'Online ordering is currently unavailable', status: 403 };
  }

  // Idempotency: the checkout page generates a UUID when it opens. If the same
  // submit arrives again (retry, double tap, reload), return the saved order
  // instead of charging the customer a second order / hitting rate limits.
  const clientRef = sanitizeText(input.clientRef, 100, { maxLineBreaks: 0 });
  if (clientRef) {
    const existing = await findOrderByClientRef(restaurant.id, clientRef);
    if (existing) return successfulOrderResult(restaurant, existing, true);
  }

  // Opening hours
  if (!isOpenAt(restaurant.websiteOpeningHours, new Date())) {
    return { error: 'We are currently closed. Please check our opening hours and try again later.', status: 400 };
  }

  // Human verification (Cloudflare Turnstile or compatible)
  const captcha = await verifyTurnstile(input.cfToken, input.ip);
  if (!captcha.ok) {
    return { error: captcha.error, status: 400 };
  }

  const phone = normalizePhone(input.phone);
  if (!phone) {
    return { error: PHONE_FORMAT_ERROR, status: 400 };
  }

  const customerName = sanitizeText(input.name, 60, { maxLineBreaks: 0 });
  if (!customerName) {
    return { error: 'Please enter your name', status: 400 };
  }

  const orderType = String(input.orderType || '').toUpperCase();
  const enabledTypes = String(restaurant.websiteOrderTypes || 'DELIVERY,PICKUP').split(',').map((t: string) => t.trim().toUpperCase());
  if (!['DELIVERY', 'PICKUP'].includes(orderType) || !enabledTypes.includes(orderType)) {
    return { error: 'Invalid order type', status: 400 };
  }

  const address = sanitizeText(input.address, 250, { maxLineBreaks: 0 });
  if (orderType === 'DELIVERY' && !address) {
    return { error: 'Please enter your delivery address', status: 400 };
  }

  const lat = Number.isFinite(Number(input.lat)) ? Number(input.lat) : null;
  const lng = Number.isFinite(Number(input.lng)) ? Number(input.lng) : null;
  const notes = sanitizeText(input.notes, 300, { maxLineBreaks: MAX_NOTE_LINE_BREAKS });
  const paymentMethod = sanitizeText(input.paymentMethod, 40, { maxLineBreaks: 0 });

  // Rate limit per phone
  if (!(await checkPhoneSpam(restaurant.id, phone))) {
    return { error: 'Too many orders from this number. Please call us instead.', status: 429 };
  }

  // Server-side pricing: load items and deals and ignore all client prices.
  const ids = (Array.isArray(input.items) ? input.items : []).map((i) => i && i.id).filter(Boolean) as string[];
  if (ids.length === 0) {
    return { error: 'Your cart is empty', status: 400 };
  }
  const [menuItems, deals] = await Promise.all([
    db.menuItem.findMany({
      where: { restaurantId: restaurant.id, id: { in: ids } },
      include: { modifiers: { include: { modifiers: true } } },
    }),
    db.deal.findMany({ where: { restaurantId: restaurant.id, id: { in: ids }, isActive: true } }),
  ]);

  const quote = quoteItems(input.items, menuItems, deals);
  if ('error' in quote) {
    return { error: quote.error, status: 400 };
  }

  // Delivery fee & minimum order
  let deliveryFee = 0;
  if (orderType === 'DELIVERY') {
    const fee = Number(restaurant.websiteDeliveryFee) || 0;
    const freeAbove = restaurant.websiteFreeDeliveryAbove != null ? Number(restaurant.websiteFreeDeliveryAbove) : null;
    deliveryFee = freeAbove != null && quote.subtotal >= freeAbove ? 0 : fee;
  }
  const minOrder = Number(restaurant.websiteMinOrder) || 0;
  if (minOrder > 0 && quote.subtotal < minOrder) {
    return { error: `Minimum order for ${orderType === 'DELIVERY' ? 'delivery' : 'pickup'} is Rs ${minOrder}`, status: 400 };
  }

  const total = quote.subtotal + deliveryFee;
  const reference = await nextReference(restaurant.id);

  let webOrder: any;
  try {
    webOrder = await db.webOrder.create({
      data: {
        restaurantId: restaurant.id,
        reference,
        status: 'NEW',
        clientRef,
        customerName,
        customerPhone: phone,
        orderType,
        address,
        lat,
        lng,
        notes,
        subtotal: quote.subtotal,
        deliveryFee,
        total,
        paymentMethod,
        customerIp: input.ip ? String(input.ip).slice(0, 60) : null,
        expiresAt: new Date(Date.now() + ttlMinutes() * 60 * 1000),
        items: {
          create: quote.items.map((item) => ({
            menuItemId: item.menuItemId || null,
            dealId: item.dealId || null,
            name: item.name,
            qty: item.qty,
            unitPrice: item.unitPrice,
            modifiers: JSON.stringify(item.modifiers),
            notes: item.notes,
          })),
        },
      },
      include: { items: true },
    });
  } catch (err: any) {
    // The DB unique index is the final guard when two submits race.
    const uniqueClash = err?.code === 'P2002' || /unique constraint/i.test(String(err?.message || ''));
    if (clientRef && uniqueClash) {
      const existing = await findOrderByClientRef(restaurant.id, clientRef);
      if (existing) return successfulOrderResult(restaurant, existing, true);
    }
    throw err;
  }

  const messageOpts: WhatsAppMessageOptions = {
    reference,
    businessName: restaurant.name,
    items: quote.items,
    subtotal: quote.subtotal,
    deliveryFee,
    total,
    orderType,
    customerName,
    customerPhone: phone,
    address,
    lat,
    lng,
    paymentNote: restaurant.websitePaymentNote,
    notes,
  };
  const whatsappUrl = buildWhatsAppUrlForMessage(
    restaurant.whatsappNumber || '',
    buildWhatsAppMessage(messageOpts),
    messageOpts
  );

  // Notify the POS inbox live
  notifyNewWebOrder(restaurant.id, webOrder.id);

  return {
    webOrder,
    reference,
    total,
    whatsappUrl,
    duplicate: false,
  };
}

function ttlMinutes(): number {
  const v = Number(process.env.WEBORDER_TTL_MINUTES);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

async function hasWebsiteModule(restaurantId: string): Promise<boolean> {
  const row = await db.tenantFeature.findFirst({
    where: { restaurantId, featureKey: 'website', enabled: true },
    select: { expiresAt: true },
  });
  if (!row) return false;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export { hasWebsiteModule as hasWebsiteModuleSafe };

// ============================================
// POS SIDE: INBOX, ACCEPT, REJECT
// ============================================

export function notifyNewWebOrder(restaurantId: string, webOrderId: string) {
  try {
    // Imported lazily to avoid a circular dependency with websocket.ts
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getIO } = require('../websocket') as { getIO: () => any };
    getIO()?.to(`restaurant:${restaurantId}`).emit('weborder:new', { id: webOrderId });
  } catch {
    // Websocket notifications are best-effort
  }
}

export async function listWebOrders(restaurantId: string, opts?: { status?: string; limit?: number }) {
  const limit = Math.min(200, Math.max(1, Number(opts?.limit) || 50));
  const where: Prisma.WebOrderWhereInput = { restaurantId };
  if (opts?.status) where.status = String(opts.status).toUpperCase();
  const statuses = ['NEW', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'DELIVERED'];
  if (opts?.status && !statuses.includes(String(opts.status).toUpperCase())) {
    delete where.status;
    where.status = { in: ['NEW'] };
  }
  return db.webOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { items: true },
  });
}

export async function getWebOrderByReference(restaurantId: string, reference: string) {
  return db.webOrder.findFirst({
    where: { restaurantId, reference },
    include: { items: true },
  });
}

/** Tenant isolation guard: only return the order when it belongs to this restaurant. */
export async function getWebOrderForTenant(restaurantId: string, id: string) {
  return db.webOrder.findFirst({
    where: { id, restaurantId },
    include: { items: true },
  });
}

/**
 * POS-order creation seam. Real implementation delegates to orderService so
 * accepted web orders become normal POS orders (kitchen + receipts as usual).
 * Tests can override it with setPosOrderCreatorForTests.
 */
type OrderCommittedCallback = (result: { order: any; lowStockAlerts: any[] }) => void;

let posOrderCreator: (
  args: any,
  tx?: any,
  notify?: boolean,
  onCommitted?: OrderCommittedCallback
) => Promise<any> = async (args, tx, notify = true, onCommitted) => {
  const { orderService } = await import('./order.service');
  return orderService.createOrder(args, tx, notify, onCommitted);
};
export function setPosOrderCreatorForTests(
  fn: (args: any, tx?: any, notify?: boolean, onCommitted?: OrderCommittedCallback) => Promise<any>
): void {
  posOrderCreator = fn;
}

async function createPosOrderForWebOrder(
  args: any,
  tx: any,
  notify = true,
  onCommitted?: OrderCommittedCallback
): Promise<any> {
  return posOrderCreator(args, tx, notify, onCommitted);
}

export async function acceptWebOrder(
  restaurantId: string,
  webOrderId: string,
  acceptedByEmployeeId?: string,
  deliveryChargeInput?: unknown
): Promise<{ webOrder?: any; error?: string; status?: number }> {
  const webOrder = await getWebOrderForTenant(restaurantId, webOrderId);
  if (!webOrder) return { error: 'Order not found', status: 404 };
  if (webOrder.status !== 'NEW') {
    return { error: `Order already ${webOrder.status.toLowerCase()}`, status: 400 };
  }

  // The manager receiving the order can set/adjust the delivery charge.
  // An empty value keeps the fee already quoted to the customer.
  let deliveryFee = Number(webOrder.deliveryFee) || 0;
  const hasDeliveryChargeInput =
    deliveryChargeInput !== undefined &&
    deliveryChargeInput !== null &&
    String(deliveryChargeInput).trim() !== '';
  if (hasDeliveryChargeInput && webOrder.orderType === 'DELIVERY') {
    const parsed = Number(deliveryChargeInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: 'Please enter a valid delivery charge (0 or more)', status: 400 };
    }
    deliveryFee = Math.round(parsed * 100) / 100;
  }
  const orderTotal =
    Math.round((Number(webOrder.subtotal || 0) + (webOrder.orderType === 'DELIVERY' ? deliveryFee : 0)) * 100) / 100;

  const now = new Date();

  const deferredLowStockAlerts: any[] = [];

  try {
    const { accepted: updated, posOrder } = await db.$transaction(async (tx: any) => {
      // Atomic claim: exactly one concurrent accept can flip NEW -> ACCEPTED.
      const claim = await tx.webOrder.updateMany({
        where: { id: webOrder.id, restaurantId, status: 'NEW' },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });
      if (claim.count !== 1) {
        const err: any = new Error('Order was already claimed');
        err.code = 'ALREADY_CLAIMED';
        throw err;
      }

      // Create a normal POS order inside the same transaction as the claim.
      // Notifications are deferred until after commit so a rolled-back accept
      // never announces an order that does not exist.
      let posOrder: any;
      try {
        posOrder = await createPosOrderForWebOrder(
          {
            restaurantId,
            serverId: acceptedByEmployeeId,
            orderType: webOrder.orderType === 'DELIVERY' ? 'DELIVERY' : 'TAKE_AWAY',
            orderTypeLabel: webOrder.orderType === 'DELIVERY' ? 'Delivery (Website)' : 'Take Away (Website)',
            customerName: webOrder.customerName,
            customerPhone: webOrder.customerPhone,
            deliveryAddress: webOrder.address || undefined,
            subtotal: webOrder.subtotal,
            deliveryCharge: webOrder.orderType === 'DELIVERY' ? deliveryFee : 0,
            total: orderTotal,
            notes: webOrder.notes || undefined,
            source: 'WEBSITE',
            status: 'confirmed',
            paymentStatus: 'UNPAID',
            items: webOrder.items.map((item: any) => {
              let modifiers: any[] = [];
              try {
                modifiers = JSON.parse(item.modifiers || '[]');
              } catch {
                modifiers = [];
              }
              const modifierText = modifiers.map((m) => m.name).filter(Boolean).join(', ');
              return {
                menuItemId: item.menuItemId || undefined,
                dealId: item.dealId || undefined,
                name: item.name,
                quantity: item.qty,
                unitPrice: item.unitPrice,
                notes: [item.notes, modifierText ? `+ ${modifierText}` : null].filter(Boolean).join(' | ') || undefined,
              };
            }),
          },
          tx,
          false,
          ({ lowStockAlerts }) => deferredLowStockAlerts.push(...lowStockAlerts)
        );
      } catch (err: any) {
        console.error('[WebOrder] Failed to create POS order for web order', webOrder.reference, err?.message);
        const failure: any = new Error('POS order creation failed');
        failure.code = 'POS_ORDER_FAILED';
        throw failure;
      }

      // Same transaction as the claim: the order never appears ACCEPTED to the
      // POS inbox without its linked POS order.
      const accepted = await tx.webOrder.update({
        where: { id: webOrder.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: now,
          posOrderId: posOrder.id,
          deliveryFee: webOrder.orderType === 'DELIVERY' ? deliveryFee : 0,
          total: orderTotal,
        },
        include: { items: true },
      });
      return { accepted, posOrder };
    });

    // All websocket events are emitted only after the shared transaction has
    // committed, so a rollback can never announce stock or an order that does
    // not exist.
    const io = getIO();
    io?.to(`restaurant:${restaurantId}`).emit('order:created', posOrder);
    io?.to(`restaurant:${restaurantId}:kitchen`).emit('kitchen:order:new', posOrder);
    for (const item of deferredLowStockAlerts) {
      inventoryService.emitLowStockAlert(item);
    }
    return { webOrder: updated };
  } catch (err: any) {
    if (err?.code === 'ALREADY_CLAIMED') {
      const current = await getWebOrderForTenant(restaurantId, webOrderId);
      return { error: current ? `Order already ${current.status.toLowerCase()}` : 'Order not found', status: 400 };
    }
    if (err?.code === 'POS_ORDER_FAILED') {
      // The transaction rollback restores NEW; this also covers test fakes and
      // any driver that committed the claim separately.
      await db.webOrder.updateMany({
        where: { id: webOrder.id, restaurantId, status: 'ACCEPTED' },
        data: { status: 'NEW', acceptedAt: null, posOrderId: null },
      });
      return { error: 'Could not create the POS order. Please try again.', status: 500 };
    }
    throw err;
  }
}

export async function rejectWebOrder(
  restaurantId: string,
  webOrderId: string,
  reason: string
): Promise<{ webOrder?: any; error?: string; status?: number }> {
  const webOrder = await getWebOrderForTenant(restaurantId, webOrderId);
  if (!webOrder) return { error: 'Order not found', status: 404 };
  if (webOrder.status !== 'NEW') {
    return { error: `Order already ${webOrder.status.toLowerCase()}`, status: 400 };
  }
  const cleanReason = sanitizeText(reason, 200, { maxLineBreaks: 0 });
  if (!cleanReason) {
    return { error: 'A rejection reason is required', status: 400 };
  }
  const updated = await db.webOrder.update({
    where: { id: webOrder.id },
    data: { status: 'REJECTED', rejectionReason: cleanReason },
    include: { items: true },
  });
  return { webOrder: updated };
}

/** Mark accepted orders as delivered (optional lifecycle step). */
export async function markDelivered(restaurantId: string, webOrderId: string) {
  const webOrder = await getWebOrderForTenant(restaurantId, webOrderId);
  if (!webOrder) return { error: 'Order not found', status: 404 };
  if (webOrder.status !== 'ACCEPTED') {
    return { error: 'Only accepted orders can be marked delivered', status: 400 };
  }
  const updated = await db.webOrder.update({
    where: { id: webOrder.id },
    data: { status: 'DELIVERED' },
    include: { items: true },
  });
  return { webOrder: updated };
}

// ============================================
// EXPIRY & RETENTION
// ============================================

/** Expire NEW web orders that were not accepted within their TTL. */
export async function expireStaleWebOrders(): Promise<number> {
  const result = await db.webOrder.updateMany({
    where: { status: 'NEW', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

const DATA_RETENTION_DAYS = 30;

/** Purge expired / rejected (never-accepted) web orders and their personal data after 30 days. */
export async function purgeOldWebOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.webOrder.deleteMany({
    where: {
      status: { in: ['EXPIRED', 'REJECTED'] },
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}

// ============================================
// SETTINGS (POS side)
// ============================================

export async function getWebsiteSettings(restaurantId: string) {
  return db.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true,
      name: true,
      slug: true,
      websiteSlug: true,
      onlineOrderingEnabled: true,
      whatsappNumber: true,
      logoUrl: true,
      websiteCoverUrl: true,
      websiteAbout: true,
      websiteOpeningHours: true,
      websiteOrderTypes: true,
      websiteDeliveryFee: true,
      websiteFreeDeliveryAbove: true,
      websiteMinOrder: true,
      websitePaymentNote: true,
    },
  });
}

export interface WebsiteSettingsUpdate {
  onlineOrderingEnabled?: boolean;
  whatsappNumber?: string | null;
  websiteSlug?: string;
  logoUrl?: string | null;
  websiteCoverUrl?: string | null;
  websiteAbout?: string | null;
  websiteOpeningHours?: string;
  websiteOrderTypes?: string[];
  websiteDeliveryFee?: number;
  websiteFreeDeliveryAbove?: number | null;
  websiteMinOrder?: number;
  websitePaymentNote?: string | null;
}

export async function updateWebsiteSettings(
  restaurantId: string,
  update: WebsiteSettingsUpdate
): Promise<{ restaurant?: any; error?: string; status?: number }> {
  const restaurant = await db.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) return { error: 'Restaurant not found', status: 404 };

  const data: Prisma.RestaurantUpdateInput = {};

  if (update.onlineOrderingEnabled !== undefined) {
    if (update.onlineOrderingEnabled) {
      // WhatsApp number is required before enabling ordering.
      const digits = normalizePhone(String(update.whatsappNumber ?? restaurant.whatsappNumber ?? ''));
      if (!digits) {
        return { error: `A valid WhatsApp number is required to enable online ordering. ${PHONE_FORMAT_ERROR}`, status: 400 };
      }
      data.whatsappNumber = digits;
    }
    data.onlineOrderingEnabled = Boolean(update.onlineOrderingEnabled);
  }

  if (update.whatsappNumber !== undefined) {
    if (update.whatsappNumber === null || update.whatsappNumber === '') {
      data.whatsappNumber = null;
    } else {
      const digits = normalizePhone(String(update.whatsappNumber));
      if (!digits) {
        return { error: `Invalid WhatsApp number. ${PHONE_FORMAT_ERROR} You can also use +92 300 1234567.`, status: 400 };
      }
      data.whatsappNumber = digits;
    }
  }

  if (update.websiteSlug !== undefined && update.websiteSlug !== restaurant.websiteSlug) {
    const slug = String(update.websiteSlug || '').trim().toLowerCase();
    const validation = validateWebsiteSlug(slug);
    if (!validation.valid) return { error: validation.error, status: 400 };
    const clash = await db.restaurant.findUnique({ where: { websiteSlug: slug }, select: { id: true } });
    if (clash && clash.id !== restaurantId) {
      return { error: 'This link is already taken', status: 400 };
    }
    data.websiteSlug = slug;
  }

  if (update.logoUrl !== undefined) {
    const logo = sanitizeImageField(update.logoUrl, 'Logo');
    if (logo.error) return { error: logo.error, status: 400 };
    data.logoUrl = logo.value;
  }
  if (update.websiteCoverUrl !== undefined) {
    const cover = sanitizeImageField(update.websiteCoverUrl, 'Cover image');
    if (cover.error) return { error: cover.error, status: 400 };
    data.websiteCoverUrl = cover.value;
  }
  if (update.websiteAbout !== undefined) data.websiteAbout = sanitizeText(update.websiteAbout, 1000);
  if (update.websiteOpeningHours !== undefined) {
    const parsed = parseOpeningHours(update.websiteOpeningHours);
    data.websiteOpeningHours = JSON.stringify(parsed);
  }
  if (update.websiteOrderTypes !== undefined) {
    const types = (Array.isArray(update.websiteOrderTypes) ? update.websiteOrderTypes : [])
      .map((t) => String(t).toUpperCase())
      .filter((t) => t === 'DELIVERY' || t === 'PICKUP');
    if (types.length === 0) return { error: 'At least one order type must be enabled', status: 400 };
    data.websiteOrderTypes = types.join(',');
  }
  if (update.websiteDeliveryFee !== undefined) {
    const fee = Number(update.websiteDeliveryFee);
    if (!Number.isFinite(fee) || fee < 0) return { error: 'Invalid delivery fee', status: 400 };
    data.websiteDeliveryFee = fee;
  }
  if (update.websiteFreeDeliveryAbove !== undefined) {
    data.websiteFreeDeliveryAbove =
      update.websiteFreeDeliveryAbove === null || update.websiteFreeDeliveryAbove === ('' as any)
        ? null
        : Number(update.websiteFreeDeliveryAbove) || null;
  }
  if (update.websiteMinOrder !== undefined) {
    const min = Number(update.websiteMinOrder);
    if (!Number.isFinite(min) || min < 0) return { error: 'Invalid minimum order', status: 400 };
    data.websiteMinOrder = min;
  }
  if (update.websitePaymentNote !== undefined) data.websitePaymentNote = sanitizeText(update.websitePaymentNote, 200);

  const updated = await db.restaurant.update({
    where: { id: restaurantId },
    data,
    select: {
      id: true,
      name: true,
      websiteSlug: true,
      onlineOrderingEnabled: true,
      whatsappNumber: true,
      logoUrl: true,
      websiteCoverUrl: true,
      websiteAbout: true,
      websiteOpeningHours: true,
      websiteOrderTypes: true,
      websiteDeliveryFee: true,
      websiteFreeDeliveryAbove: true,
      websiteMinOrder: true,
      websitePaymentNote: true,
    },
  });

  return { restaurant: updated };
}

/** Ensure a business gets a default website slug derived from its business code. */
export async function ensureWebsiteSlug(restaurantId: string): Promise<string | null> {
  const restaurant = await db.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) return null;
  if (restaurant.websiteSlug) return restaurant.websiteSlug;
  const base = defaultSlugFor(restaurant.slug || restaurant.name);
  let candidate = base;
  let suffix = 1;
  // Ensure global uniqueness
  while (await db.restaurant.findUnique({ where: { websiteSlug: candidate }, select: { id: true } })) {
    candidate = `${base}-${++suffix}`;
  }
  await db.restaurant.update({ where: { id: restaurantId }, data: { websiteSlug: candidate } });
  return candidate;
}
