import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

// =====================================================================
// Public customer menu & ordering page (/m/:slug)
// Modern dark appetizing theme, mobile-first, Tailwind, full RTL.
// All business bindings, language switcher, badges, ordering logic,
// cart, checkout, WhatsApp flow and Turnstile preserved.
// =====================================================================

const API_BASE = '/api';

type Lang = 'en' | 'ur' | 'roman';

const T: Record<string, Record<Lang, string>> = {
  open: { en: 'Open now', ur: 'کھلے ہیں', roman: 'Khule hain' },
  closed: { en: 'Closed', ur: 'بند ہیں', roman: 'Band hain' },
  browseOnly: {
    en: 'Browsing only — online ordering is unavailable right now.',
    ur: 'صرف دیکھیں — آن لائن آرڈرنگ فی الحال دستیاب نہیں۔',
    roman: 'Sirf dekhein — online ordering filhaal available nahi.',
  },
  hoursTitle: { en: 'Opening hours', ur: 'اوقاتِ کار', roman: 'Opening hours' },
  minOrderNote: { en: 'Minimum order', ur: 'کم سے کم آرڈر', roman: 'Minimum order' },
  deliveryFee: { en: 'Delivery fee', ur: 'ڈیلیوری فیس', roman: 'Delivery fee' },
  freeAbove: { en: 'Free above', ur: 'مفت اس سے اوپر', roman: 'Free above' },
  search: { en: 'Search the menu…', ur: 'مینو تلاش کریں…', roman: 'Menu talash karein…' },
  all: { en: 'All', ur: 'سب', roman: 'Sab' },
  deals: { en: "Today's Deals", ur: 'آج کے ڈیلز', roman: 'Aaj ke Deals' },
  soldOut: { en: 'Sold out', ur: 'ختم', roman: 'Khatam' },
  addToCart: { en: 'Add', ur: 'شامل کریں', roman: 'Add' },
  viewCart: { en: 'View cart', ur: 'کارٹ دیکھیں', roman: 'Cart dekhein' },
  yourCart: { en: 'Your order', ur: 'آپ کا آرڈر', roman: 'Aap ka order' },
  emptyCart: { en: 'Your cart is empty — add something delicious!', ur: 'کارٹ خالی ہے — کچھ لذیذ شامل کریں!', roman: 'Cart khali hai — kuch lazeez shamil karein!' },
  subtotal: { en: 'Subtotal', ur: 'ذیلی کل', roman: 'Subtotal' },
  deliveryTbd: { en: 'To be confirmed', ur: 'بعد میں طے ہوگا', roman: 'Baad mein tay hoga' },
  totalExclDelivery: { en: 'Total (delivery extra)', ur: 'کل (ڈیلیوری الگ)', roman: 'Total (delivery alag)' },
  total: { en: 'Total', ur: 'کل', roman: 'Total' },
  checkout: { en: 'Continue to checkout', ur: 'چیک آؤٹ جاری رکھیں', roman: 'Checkout par jayein' },
  placeOrder: { en: 'Place order', ur: 'آرڈر دیں', roman: 'Order dein' },
  sending: { en: 'Placing your order…', ur: 'آرڈر بھیجا جا رہا ہے…', roman: 'Order bheja ja raha hai…' },
  name: { en: 'Your name', ur: 'آپ کا نام', roman: 'Aap ka naam' },
  phone: { en: 'Phone number', ur: 'فون نمبر', roman: 'Phone number' },
  deliveryType: { en: '🛵 Delivery', ur: '🛵 ڈیلیوری', roman: '🛵 Delivery' },
  pickupType: { en: '🏃 Pickup', ur: '🏃 خود لے کر', roman: '🏃 Pickup' },
  address: { en: 'Delivery address', ur: 'ڈیلیوری ایڈریس', roman: 'Delivery address' },
  shareLocation: { en: 'Share my location', ur: 'اپنی لوکیشن شیئر کریں', roman: 'Apni location share karein' },
  locationShared: { en: 'Location attached', ur: 'لوکیشن منسلک', roman: 'Location attach ho gayi' },
  orderNotes: { en: 'Notes for the kitchen (optional)', ur: 'کچن کے لیے نوٹس (اختیاری)', roman: 'Kitchen ke liye notes (optional)' },
  itemNotes: { en: 'Special instructions…', ur: 'خاص ہدایات…', roman: 'Khaas hidayat…' },
  addedToCart: { en: 'Added to cart ✓', ur: 'کارٹ میں شامل ✓', roman: 'Cart mein shamil ✓' },
  each: { en: 'each', ur: 'فی آئٹم', roman: 'each' },
  minOrderWarn: { en: 'Add {0} more to reach the {1} minimum order.', ur: 'کم سے کم آرڈر {1} تک {0} مزید شامل کریں۔', roman: 'Min order {1} tak {0} mazeed shamil karein.' },
  required: { en: 'Required', ur: 'لازمی', roman: 'Zaroori' },
  optional: { en: 'Optional', ur: 'اختیاری', roman: 'Ikhtiyari' },
  customize: { en: 'Customize', ur: 'اپنی پسند', roman: 'Customize' },
  orderPlaced: { en: 'Order placed!', ur: 'آرڈر موصول ہو گیا!', roman: 'Order mil gaya!' },
  orderRef: { en: 'Your order reference', ur: 'آپ کا آرڈر نمبر', roman: 'Aap ka order number' },
  openWhatsappAgain: { en: 'Open WhatsApp again', ur: 'واٹس ایپ دوبارہ کھولیں', roman: 'WhatsApp dobara kholein' },
  startNew: { en: 'Start a new order', ur: 'نیا آرڈر شروع کریں', roman: 'Naya order shuru karein' },
  notFound: { en: 'This restaurant page does not exist.', ur: 'یہ صفحہ موجود نہیں۔', roman: 'Ye page maujood nahi.' },
  notFoundSub: { en: 'Check the link and try again.', ur: 'لنک چیک کریں اور دوبارہ کوشش کریں۔', roman: 'Link check karein aur dobara koshish karein.' },
  loading: { en: 'Loading the menu…', ur: 'مینو لوڈ ہو رہا ہے…', roman: 'Menu load ho raha hai…' },
  noItems: { en: 'No items found', ur: 'کوئی آئٹم نہیں ملا', roman: 'Koi item nahi mila' },
  tryOther: { en: 'Try another category or search.', ur: 'دوسری کیٹیگری یا سرچ آزمائیں۔', roman: 'Dusri category ya search karein.' },
  backToCart: { en: 'Back to cart', ur: 'کارٹ پر واپس', roman: 'Cart par wapas' },
  closedDay: { en: 'Closed', ur: 'بند', roman: 'Band' },
  free: { en: 'Free', ur: 'مفت', roman: 'Free' },
  payNote: { en: 'Payment note', ur: 'ادائیگی کی نوٹ', roman: 'Payment note' },
  chooseUpTo: { en: 'Choose up to', ur: 'تک منتخب کریں', roman: 'Choose up to' },
};

const DAY_NAMES: Record<Lang, string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ur: ['پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ', 'اتوار'],
  roman: ['Pir', 'Mangal', 'Budh', 'Jumeraat', 'Jumma', 'Hafta', 'Itwaar'],
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const LANG_LABEL: Record<Lang, string> = { en: 'EN', ur: 'اردو', roman: 'Roman' };

const money = (n: number) => `Rs ${(Math.round(n * 100) / 100).toLocaleString('en-PK')}`;

// ---------- Theme (derived from the business palette) ----------
interface PubTheme {
  accent: string; onAccent: string; bg: string; surface: string; surface2: string;
  border: string; text: string; muted: string; ring: string;
}
const THEMES: Record<string, PubTheme> = {
  espresso: { accent: '#e0a172', onAccent: '#241408', bg: '#171210', surface: '#211a15', surface2: '#2a2119', border: 'rgba(255,255,255,0.09)', text: '#f5efe7', muted: '#a89e93', ring: 'rgba(224,161,114,0.35)' },
  wine: { accent: '#e27285', onAccent: '#2a0d13', bg: '#1a0f12', surface: '#251418', surface2: '#2f1a20', border: 'rgba(255,255,255,0.09)', text: '#f7ece9', muted: '#b39a9e', ring: 'rgba(226,114,133,0.35)' },
  ocean: { accent: '#6fb8d9', onAccent: '#0b1c24', bg: '#0e1518', surface: '#152026', surface2: '#1c2a31', border: 'rgba(255,255,255,0.09)', text: '#e8f1f5', muted: '#93aab4', ring: 'rgba(111,184,217,0.35)' },
  emerald: { accent: '#68c9a0', onAccent: '#0a2318', bg: '#0e1613', surface: '#152019', surface2: '#1c2a21', border: 'rgba(255,255,255,0.09)', text: '#e8f1ec', muted: '#93aab0', ring: 'rgba(104,201,160,0.35)' },
  royal: { accent: '#a184e0', onAccent: '#1a142a', bg: '#131018', surface: '#1d1826', surface2: '#251e30', border: 'rgba(255,255,255,0.09)', text: '#efe9f7', muted: '#a39ab4', ring: 'rgba(161,132,224,0.35)' },
  sunset: { accent: '#f0a05c', onAccent: '#2a1708', bg: '#171210', surface: '#221a14', surface2: '#2b2119', border: 'rgba(255,255,255,0.09)', text: '#f5efe7', muted: '#a89e93', ring: 'rgba(240,160,92,0.35)' },
  rose: { accent: '#e08db4', onAccent: '#2a0d1a', bg: '#170f14', surface: '#221620', surface2: '#2b1c29', border: 'rgba(255,255,255,0.09)', text: '#f5edf1', muted: '#ab9aa5', ring: 'rgba(224,141,180,0.35)' },
  midnight: { accent: '#8fb2e0', onAccent: '#0d1424', bg: '#0f1118', surface: '#161a24', surface2: '#1d2230', border: 'rgba(255,255,255,0.09)', text: '#edf1f7', muted: '#98a2b4', ring: 'rgba(143,178,224,0.35)' },
};
const FALLBACK_THEME = THEMES.espresso;

// ---------- Types ----------
interface PubModifierOption { id: string; name: string; price: number }
interface PubModifierGroup { id: string; name: string; minSelections: number; maxSelections: number | null; isRequired: boolean; options: PubModifierOption[] }
interface PublicCategory { id: string; name: string }
interface PublicItem {
  id: string; name: string; description?: string | null; price: number;
  imageUrl?: string | null; isAvailable: boolean; categoryId: string; modifiers: PubModifierGroup[];
}
interface PublicDeal { id: string; name: string; description?: string | null; price: number; imageUrl?: string | null; isAvailable: boolean }
interface PublicBusiness {
  name: string; slug: string; logoUrl?: string | null; coverUrl?: string | null;
  about?: string | null; palette?: string | null; orderingEnabled: boolean; open: boolean;
  openingHours: Record<string, { closed?: boolean; open?: string; close?: string }>;
  orderTypesEnabled: string[]; deliveryFee: number | null; freeDeliveryAbove: number | null;
  minOrder: number; paymentNote?: string | null;
}
interface PublicMenuResponse { business: PublicBusiness; categories: PublicCategory[]; items: PublicItem[]; deals: PublicDeal[] }

interface CartLine {
  key: string;
  itemId: string;
  name: string;
  unitPrice: number;
  qty: number;
  modifierIds: string[];
  modifierNames: string[];
  notes: string;
}

interface PubPostResponse { reference: string; total: number; whatsappUrl: string }

// ---------- Shared CSS ----------
const BASE_CSS = `
.pub-root { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif; }
.pub-root[dir="rtl"] { font-family: 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Outfit', Tahoma, serif; line-height: 2; }
.pub-food-pattern {
  background-color: #241a10;
  background-image:
    radial-gradient(ellipse 60% 80% at 50% 20%, rgba(224,161,114,0.28), transparent 70%),
    radial-gradient(ellipse 40% 60% at 20% 80%, rgba(224,161,114,0.14), transparent 70%);
}
.pub-card-glow { transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
.pub-card-glow:hover { transform: translateY(-2px); }
.pub-desc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pub-qty { transition: transform .12s ease; }
.pub-qty:active { transform: scale(0.93); }
.pub-fade-in { animation: pubFadeIn .25s ease; }
@keyframes pubFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.pub-sheet-shadow { box-shadow: 0 -8px 40px rgba(0,0,0,0.55); }
.pub-scroll::-webkit-scrollbar { display: none; }
`;

// =====================================================================
// Component
// =====================================================================
export const PublicMenuPage: React.FC = () => {
  const { slug = '' } = useParams();

  const [lang, setLang] = useState<Lang>((localStorage.getItem('pub-lang') as Lang) || 'en');
  useEffect(() => { localStorage.setItem('pub-lang', lang); }, [lang]);
  const tr = (key: keyof typeof T) => T[key][lang];

  const [menu, setMenu] = useState<PublicMenuResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showHours, setShowHours] = useState(false);

  const [cat, setCat] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const [detailItem, setDetailItem] = useState<PublicItem | null>(null);
  const [detailDeal, setDetailDeal] = useState<PublicDeal | null>(null);
  const [selectedMods, setSelectedMods] = useState<PubModifierOption[]>([]);
  const [detailNotes, setDetailNotes] = useState('');

  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    address: '',
    lat: null as number | null,
    lng: null as number | null,
    orderType: 'DELIVERY',
    notes: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<PubPostResponse | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string) || '';

  // ---------- data ----------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setMenu(null);
    setCat('ALL');
    setSearch('');
    fetch(`${API_BASE}/public/${encodeURIComponent(slug)}/menu`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 404) { setNotFound(true); return null; }
          const data = await r.json().catch(() => ({}));
          throw new Error(data?.error || 'Failed to load menu');
        }
        return r.json();
      })
      .then((data: PublicMenuResponse | null) => {
        if (!cancelled && data) {
          setMenu(data);
          if (data.business.orderTypesEnabled?.length > 0) {
            setProfile((p) => ({ ...p, orderType: data.business.orderTypesEnabled[0] }));
          }
        }
      })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to load menu'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  // ---------- turnstile ----------
  useEffect(() => {
    if (!siteKey || document.getElementById('cf-turnstile-script')) return;
    const s = document.createElement('script');
    s.id = 'cf-turnstile-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    document.head.appendChild(s);
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey || !checkoutOpen || !menu) return;
    const t = setTimeout(() => {
      (window as any).turnstile?.render('#cf-turnstile-box', {
        sitekey: siteKey,
        callback: (token: string) => setTurnstileToken(token),
      });
    }, 100);
    return () => {
      (window as any).turnstile?.remove?.('#cf-turnstile-box');
      clearTimeout(t);
    };
  }, [siteKey, checkoutOpen, menu]);

  // ---------- derived ----------
  const theme = useMemo(() => THEMES[(menu?.business.palette || '').toLowerCase()] || FALLBACK_THEME, [menu?.business.palette]);

  const cssVars = {
    '--pub-accent': theme.accent,
    '--pub-on-accent': theme.onAccent,
    '--pub-bg': theme.bg,
    '--pub-surface': theme.surface,
    '--pub-surface2': theme.surface2,
    '--pub-border': theme.border,
    '--pub-text': theme.text,
    '--pub-muted': theme.muted,
    '--pub-ring': theme.ring,
  } as React.CSSProperties;

  const isRTL = lang === 'ur';
  const b = menu?.business;
  const canOrder = Boolean(b?.orderingEnabled && b.open);

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const isDelivery = profile.orderType === 'DELIVERY';
  const deliveryFee = isDelivery && b?.freeDeliveryAbove != null && subtotal >= Number(b.freeDeliveryAbove) ? 0 : Number(b?.deliveryFee) || 0;
  const total = subtotal + deliveryFee;
  const minOrder = Number(b?.minOrder) || 0;
  const belowMin = subtotal > 0 && minOrder > 0 && subtotal < minOrder;
  const minOrderMissing = minOrder > 0 ? Math.max(0, minOrder - subtotal) : 0;

  const filteredItems = useMemo(() => {
    if (!menu) return [];
    const q = search.trim().toLowerCase();
    return menu.items.filter((i) => {
      if (cat !== 'ALL' && cat !== 'DEALS' && i.categoryId !== cat) return false;
      if (q && !(`${i.name} ${i.description || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [menu, search, cat]);

  const filteredDeals = useMemo(() => {
    if (!menu) return [];
    const q = search.trim().toLowerCase();
    return menu.deals.filter((d) => {
      if (cat !== 'ALL' && cat !== 'DEALS') return false;
      if (q && !(`${d.name} ${d.description || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [menu, search, cat]);

  // ---------- cart actions ----------
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const addToCart = (item: { id: string; name: string; price: number }, mods: PubModifierOption[], notes = '') => {
    const key = `${item.id}::${mods.map((m) => m.id).sort().join('|')}::${notes}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, qty: Math.min(50, l.qty + 1) } : l));
      }
      return [
        ...prev,
        {
          key,
          itemId: item.id,
          name: item.name,
          unitPrice: Number(item.price) + mods.reduce((s, m) => s + Number(m.price || 0), 0),
          qty: 1,
          modifierIds: mods.map((m) => m.id),
          modifierNames: mods.map((m) => m.name),
          notes,
        },
      ];
    });
    flash(tr('addedToCart'));
  };

  const decrementItem = (itemId: string) => {
    // find the first line for this item (plain items without mods/notes)
    const line = cart.find((l) => l.itemId === itemId && l.modifierIds.length === 0 && !l.notes);
    if (!line) return;
    setQty(line.key, line.qty - 1);
  };

  const setQty = (key: string, qty: number) => {
    setCart((prev) => (qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, qty: Math.min(50, qty) } : l))));
  };

  const qtyForItem = (itemId: string) => {
    const line = cart.find((l) => l.itemId === itemId && l.modifierIds.length === 0 && !l.notes);
    return line?.qty || 0;
  };

  const openDetail = (item: PublicItem) => {
    setDetailItem(item);
    setSelectedMods([]);
    setDetailNotes('');
  };

  // ---------- submit ----------
  const submitOrder = async () => {
    if (!b || !cart.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/public/${encodeURIComponent(slug)}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((l) => ({ id: l.itemId, qty: l.qty, modifiers: l.modifierIds.map((id) => ({ id })), notes: l.notes || undefined })),
          name: profile.name,
          phone: profile.phone,
          orderType: profile.orderType,
          address: isDelivery ? profile.address : undefined,
          lat: profile.lat,
          lng: profile.lng,
          notes: profile.notes || undefined,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to place the order. Please try again.');
      setConfirmation(data as PubPostResponse);
      setCart([]);
      setCheckoutOpen(false);
      setCartOpen(false);
      window.open(data.whatsappUrl, '_blank', 'noopener');
    } catch (e: any) {
      setError(e.message || 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const shareLocation = () => {
    if (!navigator.geolocation) { setError('Location not supported on this device'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setProfile((p) => ({ ...p, lat: pos.coords.latitude, lng: pos.coords.longitude }));
        flash(tr('locationShared'));
      },
      () => setError('Could not get your location. Please enter the address manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // ---------- loading ----------
  if (loading) {
    return (
      <div className="pub-root min-h-screen bg-[#171210] text-[#f5efe7]" style={cssVars} dir={isRTL ? 'rtl' : 'ltr'}>
        <style>{BASE_CSS}</style>
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="mb-4 h-40 animate-pulse rounded-3xl bg-white/5" />
          <div className="flex items-center gap-3">
            <div className="h-20 w-20 animate-pulse rounded-2xl bg-white/5" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-1/2 animate-pulse rounded bg-white/5" />
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-white/5" />
            </div>
          </div>
          <div className="mt-6 flex gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-9 w-20 animate-pulse rounded-full bg-white/5" />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="aspect-square w-full animate-pulse rounded-2xl bg-white/5" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- not found ----------
  if (notFound || !menu || !b) {
    return (
      <div className="pub-root flex min-h-screen flex-col items-center justify-center gap-3 bg-[#171210] px-6 text-center text-[#f5efe7]" style={cssVars} dir={isRTL ? 'rtl' : 'ltr'}>
        <style>{BASE_CSS}</style>
        <div className="text-6xl">🍽️</div>
        <h1 className="text-xl font-bold">{tr('notFound')}</h1>
        <p className="text-sm text-[#a89e93]">{tr('notFoundSub')}</p>
      </div>
    );
  }

  const hasDeals = menu.deals.length > 0;
  const tabs = [{ id: 'ALL', name: tr('all') }, ...menu.categories.map((c) => ({ id: c.id, name: c.name })), ...(hasDeals ? [{ id: 'DEALS', name: tr('deals') }] : [])];

  return (
    <div className="pub-root min-h-screen bg-[var(--pub-bg)] pb-28 text-[var(--pub-text)]" style={cssVars} dir={isRTL ? 'rtl' : 'ltr'}>
      <style>{BASE_CSS}</style>

      {/* ============ HERO ============ */}
      <div className="mx-auto max-w-3xl">
        <div className="relative h-44 overflow-hidden sm:h-56" style={{ background: 'var(--pub-bg)' }}>
          {b.coverUrl && !coverFailed ? (
            <img src={b.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setCoverFailed(true)} />
          ) : (
            <div className="pub-food-pattern absolute inset-0" style={{ background: `linear-gradient(135deg, ${theme.accent}22, ${theme.bg})` }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--pub-bg)] via-transparent to-transparent" />
          {/* language switch */}
          <div className="absolute top-3 end-3 z-20 flex gap-0.5 rounded-full border border-white/10 bg-black/45 p-0.5 backdrop-blur-md">
            {(['en', 'roman', 'ur'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all duration-200 ${lang === l ? 'bg-[var(--pub-accent)] text-[var(--pub-on-accent)]' : 'text-white/70 hover:text-white'}`}
              >
                {LANG_LABEL[l]}
              </button>
            ))}
          </div>
        </div>

        <div className="relative -mt-9 px-4 sm:-mt-11 sm:px-6">
          {/* logo */}
          <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl border-2 border-white/10 bg-[var(--pub-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] sm:h-[88px] sm:w-[88px]">
            {b.logoUrl && !logoFailed ? (
              <img src={b.logoUrl} alt={b.name} className="h-full w-full object-cover" onError={() => setLogoFailed(true)} />
            ) : (
              <div className="pub-food-pattern flex h-full w-full items-center justify-center text-3xl">🍽️</div>
            )}
          </div>
          <h1 className="mt-2.5 text-[22px] font-extrabold leading-tight tracking-tight sm:text-3xl">{b.name}</h1>
          {b.about && <p className="pub-desc mt-1 text-sm text-[var(--pub-muted)]">{b.about}</p>}
        </div>

        {/* badges */}
        <div className="mt-3 flex flex-wrap items-center gap-2 px-4 sm:px-6">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${b.open ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${b.open ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {b.open ? tr('open') : tr('closed')}
          </span>
          <button
            onClick={() => setShowHours(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pub-border)] bg-[var(--pub-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--pub-muted)] transition-colors hover:border-[var(--pub-accent)] hover:text-[var(--pub-text)]"
            style={{ minHeight: 32 }}
          >
            🕐 {tr('hoursTitle')}
          </button>
          {b.minOrder > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--pub-border)] bg-[var(--pub-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--pub-muted)]">
              🧾 {tr('minOrderNote')} {money(b.minOrder)}
            </span>
          )}
          {b.orderTypesEnabled.includes('DELIVERY') && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--pub-border)] bg-[var(--pub-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--pub-muted)]">
              🛵 {b.deliveryFee != null ? money(b.deliveryFee) : tr('deliveryFee')} {b.freeDeliveryAbove ? `· ${tr('freeAbove')} ${money(b.freeDeliveryAbove)}` : ''}
            </span>
          )}
        </div>

        {!canOrder && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 sm:mx-6">
            <span className="text-base">🔕</span>
            <span className="flex-1">{tr('browseOnly')}</span>
          </div>
        )}
      </div>

      {/* ============ STICKY SEARCH + TABS ============ */}
      <div className="sticky top-0 z-30 mt-5 border-y border-[var(--pub-border)] bg-[var(--pub-bg)]/80 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="relative pt-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('search')}
              className="w-full rounded-2xl border border-[var(--pub-border)] bg-[var(--pub-surface)] py-3 ps-11 pe-11 text-sm placeholder:text-[var(--pub-muted)] focus:border-[var(--pub-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-ring)]"
              style={{ minHeight: 44 }}
            />
            <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 pt-1.5 text-[var(--pub-muted)]">🔍</span>
            {search && (
              <button onClick={() => setSearch('')} className="absolute end-3.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-[var(--pub-muted)] hover:text-[var(--pub-text)]" style={{ minHeight: 36, minWidth: 36 }}>
                ✕
              </button>
            )}
          </div>
          <div className="pub-scroll flex gap-2 overflow-x-auto py-3" style={{ scrollbarWidth: 'none' }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setCat(t.id)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition-all duration-200 ${cat === t.id ? 'bg-[var(--pub-accent)] text-[var(--pub-on-accent)]' : 'bg-[var(--pub-surface)] text-[var(--pub-muted)] hover:text-[var(--pub-text)]'}`}
                style={{ minHeight: 36 }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ============ MENU ============ */}
      <main className="mx-auto max-w-3xl px-4 sm:px-6">
        {/* deals */}
        {hasDeals && (cat === 'ALL' || cat === 'DEALS') && (
          <div className="mt-4">
            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--pub-accent)]">🔥 {tr('deals')}</h2>
            <div className="pub-scroll flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {filteredDeals.map((d) => (
                <div
                  key={d.id}
                  onClick={() => canOrder && d.isAvailable && setDetailDeal(d)}
                  className={`pub-card-glow relative flex w-[230px] shrink-0 flex-col gap-2.5 overflow-hidden rounded-2xl border bg-[var(--pub-surface)] p-3.5 ${canOrder && d.isAvailable ? 'border-[var(--pub-border)] hover:border-[var(--pub-accent)] cursor-pointer' : 'border-[var(--pub-border)] opacity-60'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                      {d.imageUrl ? (
                        <img src={d.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="pub-food-pattern flex h-full w-full items-center justify-center text-2xl">🔥</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="pub-name text-sm font-bold">{d.name}</div>
                      {d.description && <div className="pub-desc mt-0.5 text-[11px] leading-snug text-[var(--pub-muted)]">{d.description}</div>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-extrabold text-[var(--pub-accent)]">{money(d.price)}</span>
                    {canOrder && d.isAvailable && (
                      <button className="pub-qty rounded-full bg-[var(--pub-accent)] px-3.5 py-1.5 text-xs font-bold text-[var(--pub-on-accent)]" style={{ minHeight: 32 }}>
                        + {tr('addToCart')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* items grid */}
        <div className={`mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 ${hasDeals && cat === 'ALL' ? '' : 'mt-4'}`}>
          {filteredItems.map((item) => {
            const inCart = qtyForItem(item.id);
            const hasMods = item.modifiers.length > 0;
            return (
              <div
                key={item.id}
                onClick={() => canOrder && item.isAvailable && setDetailItem(item)}
                className={`pub-card-glow group relative overflow-hidden rounded-2xl border bg-[var(--pub-surface)] ${item.isAvailable ? 'border-[var(--pub-border)]' : 'border-[var(--pub-border)] opacity-55 grayscale'}`}
              >
                <div className="relative aspect-square w-full overflow-hidden bg-[var(--pub-surface2)]">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" loading="lazy" className={`h-full w-full object-cover transition-transform duration-300 ${item.isAvailable ? 'group-hover:scale-105' : 'grayscale'}`} />
                  ) : (
                    <div className="pub-food-pattern flex h-full w-full items-center justify-center text-4xl">🍽️</div>
                  )}
                  {!item.isAvailable && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                      <span className="rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-bold text-white/90">🔒 {tr('soldOut')}</span>
                    </div>
                  )}
                </div>
                <div className="p-3.5">
                  <div className="pub-name text-sm font-bold leading-snug">{item.name}</div>
                  {item.description && <div className="pub-desc mt-1 text-xs leading-relaxed text-[var(--pub-muted)]">{item.description}</div>}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-extrabold text-[var(--pub-accent)]">{money(item.price)}</span>
                    {canOrder && item.isAvailable && (
                      inCart > 0 && !hasMods ? (
                        <div className="pub-qty flex items-center gap-1 rounded-full border border-[var(--pub-accent)]/40 bg-[var(--pub-accent)]/10">
                          <button onClick={(e) => { e.stopPropagation(); decrementItem(item.id); }} className="h-9 w-9 rounded-full text-sm font-bold text-[var(--pub-accent)]">−</button>
                          <span className="min-w-5 text-center text-sm font-bold">{inCart}</span>
                          <button onClick={(e) => { e.stopPropagation(); addToCart(item, [], ''); }} className="h-9 w-9 rounded-full text-sm font-bold text-[var(--pub-accent)]">+</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (hasMods) { setDetailItem(item); setSelectedMods([]); setDetailNotes(''); } else { addToCart(item, [], ''); } }}
                          className="pub-qty rounded-full bg-[var(--pub-accent)] px-4 py-2 text-xs font-bold text-[var(--pub-on-accent)] transition-transform hover:scale-105 active:scale-95"
                          style={{ minHeight: 36 }}
                        >
                          {hasMods ? `⚙ ${tr('customize')}` : `+ ${tr('addToCart')}`}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredItems.length === 0 && !hasDeals && (
          <div className="mt-10 text-center">
            <div className="mb-2 text-4xl">🍽️</div>
            <p className="text-sm font-bold">{tr('noItems')}</p>
            <p className="mt-1 text-xs text-[var(--pub-muted)]">{tr('tryOther')}</p>
          </div>
        )}
      </main>

      {/* ============ FLOATING CART BAR ============ */}
      {canOrder && cartCount > 0 && (
        <div className="pub-fade-in fixed inset-x-0 bottom-0 z-40 px-4 pb-5">
          <button
            onClick={() => setCartOpen(true)}
            className="pub-qty mx-auto flex h-14 max-w-md items-center justify-between gap-3 rounded-2xl bg-[var(--pub-accent)] px-5 font-bold text-[var(--pub-on-accent)] shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--pub-on-accent)]/20 text-xs font-black">{cartCount}</span>
              <span className="text-sm">{tr('viewCart')}</span>
            </span>
            <span className="text-base">{money(total)}</span>
          </button>
        </div>
      )}

      {/* ============ HOURS POPUP ============ */}
      {showHours && (
        <div onClick={() => setShowHours(false)} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="pub-sheet-shadow w-full max-w-sm rounded-3xl border border-[var(--pub-border)] bg-[var(--pub-surface)] p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <h3 className="text-base font-bold">🕐 {tr('hoursTitle')}</h3>
              <button onClick={() => setShowHours(false)} className="pub-qty flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pub-surface2)] text-sm hover:bg-[var(--pub-border)]">✕</button>
            </div>
            <div className="space-y-1.5">
              {DAY_ORDER.map((dk, idx) => {
                const day = b.openingHours?.[dk];
                return (
                  <div key={dk} className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm ${day?.closed ? 'bg-[var(--pub-surface2)] text-[var(--pub-muted)]' : 'bg-[var(--pub-surface2)]'}`}>
                    <span className="font-semibold">{DAY_NAMES[lang][idx]}</span>
                    <span className={day?.closed ? 'text-[var(--pub-muted)] line-through' : 'text-[var(--pub-text)]'}>
                      {day?.closed ? tr('closedDay') : day?.open || day?.close ? `${day.open} – ${day.close}` : '24h'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============ ITEM DETAIL SHEET ============ */}
      {detailItem && (
        <div onClick={() => setDetailItem(null)} className="pub-fade-in fixed inset-0 z-[70] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4">
          <div onClick={(e) => e.stopPropagation()} className="pub-sheet-shadow max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-[var(--pub-border)] bg-[var(--pub-bg)] sm:max-w-md sm:rounded-3xl">
            <div className="relative h-36 overflow-hidden sm:h-44">
              {detailItem.imageUrl ? (
                <img src={detailItem.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="pub-food-pattern flex h-full w-full items-center justify-center text-4xl">🍽️</div>
              )}
              <button onClick={() => setDetailItem(null)} className="absolute top-3 end-3 pub-qty flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-sm text-white backdrop-blur-md">✕</button>
            </div>
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-bold">{detailItem.name}</h3>
                <span className="shrink-0 text-lg font-extrabold text-[var(--pub-accent)]">{money(detailItem.price)}</span>
              </div>
              {detailItem.description && <p className="mt-1.5 text-sm text-[var(--pub-muted)]">{detailItem.description}</p>}

              {detailItem.modifiers.map((g) => (
                <div key={g.id} className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-bold">{g.name}</span>
                    <span className="text-xs text-[var(--pub-muted)]">{g.isRequired ? tr('required') : tr('optional')}{g.maxSelections ? ` · ${tr('chooseUpTo')} ${g.maxSelections}` : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.options.map((o) => {
                      const on = selectedMods.some((m) => m.id === o.id);
                      return (
                        <button
                          key={o.id}
                          onClick={() => setSelectedMods((prev) => {
                            if (on) return prev.filter((m) => m.id !== o.id);
                            const sameGroup = prev.filter((m) => g.options.some((x) => x.id === m.id));
                            if (g.maxSelections && sameGroup.length >= g.maxSelections) return prev;
                            return [...prev, o];
                          })}
                          className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-all duration-150 ${on ? 'border-[var(--pub-accent)] bg-[var(--pub-accent)]/15 text-[var(--pub-accent)]' : 'border-[var(--pub-border)] text-[var(--pub-muted)] hover:border-[var(--pub-accent)]'}`}
                          style={{ minHeight: 36 }}
                        >
                          {on ? '✓ ' : ''}{o.name}{o.price ? ` +${money(o.price)}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-semibold text-[var(--pub-muted)]">{tr('itemNotes')}</label>
                <input
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder={tr('itemNotes')}
                  className="w-full rounded-2xl border border-[var(--pub-border)] bg-[var(--pub-surface)] px-4 py-3 text-sm placeholder:text-[var(--pub-muted)] focus:border-[var(--pub-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-ring)]"
                  style={{ minHeight: 44 }}
                />
              </div>

              <button
                onClick={() => { addToCart(detailItem, selectedMods, detailNotes); setDetailItem(null); }}
                className="pub-qty mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--pub-accent)] text-sm font-bold text-[var(--pub-on-accent)]"
                style={{ minHeight: 48 }}
              >
                + {tr('addToCart')} · {money(detailItem.price + selectedMods.reduce((s, m) => s + Number(m.price || 0), 0))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ CART DRAWER ============ */}
      {cartOpen && (
        <div onClick={() => setCartOpen(false)} className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="pub-sheet-shadow absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-3xl border border-[var(--pub-border)] bg-[var(--pub-bg)]">
            <div className="flex items-center justify-between border-b border-[var(--pub-border)] px-5 py-4">
              <div>
                <h3 className="text-base font-bold">🛒 {tr('yourCart')}</h3>
                <p className="text-xs text-[var(--pub-muted)]">{b.name}</p>
              </div>
              <button onClick={() => setCartOpen(false)} className="pub-qty flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pub-surface)] text-sm hover:bg-[var(--pub-surface2)]">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-2">
              {cart.length === 0 ? (
                <div className="py-14 text-center">
                  <div className="mb-2 text-4xl">🛒</div>
                  <p className="text-sm text-[var(--pub-muted)]">{tr('emptyCart')}</p>
                </div>
              ) : (
                cart.map((line) => (
                  <div key={line.key} className="border-b border-[var(--pub-border)] py-3.5 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold">{line.name}</div>
                        {line.modifierNames.length > 0 && <p className="mt-0.5 text-xs text-[var(--pub-muted)]">+ {line.modifierNames.join(', ')}</p>}
                        {line.notes && <p className="mt-0.5 text-xs italic text-[var(--pub-muted)]">📝 {line.notes}</p>}
                        <div className="mt-1 text-xs text-[var(--pub-muted)]">{money(line.unitPrice)} · {tr('each')}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-sm font-extrabold text-[var(--pub-accent)]">{money(line.unitPrice * line.qty)}</span>
                        <div className="pub-qty flex items-center gap-0.5 rounded-full border border-[var(--pub-border)] bg-[var(--pub-surface)]">
                          <button onClick={() => setQty(line.key, line.qty - 1)} className="h-9 w-9 rounded-full text-sm font-bold hover:bg-[var(--pub-surface2)]">−</button>
                          <span className="min-w-6 text-center text-sm font-bold">{line.qty}</span>
                          <button onClick={() => setQty(line.key, line.qty + 1)} className="h-9 w-9 rounded-full text-sm font-bold hover:bg-[var(--pub-surface2)]">+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t border-[var(--pub-border)] bg-[var(--pub-surface)] px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--pub-muted)]">{tr('subtotal')}</span>
                  <span className="font-semibold">{money(subtotal)}</span>
                </div>
                {isDelivery && (
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-[var(--pub-muted)]">{tr('deliveryFee')}</span>
                    <span className="font-semibold">{deliveryFee === 0 ? tr('free') : money(deliveryFee)}</span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between text-base font-extrabold">
                  <span>{isDelivery ? tr('total') : tr('total')}</span>
                  <span className="text-[var(--pub-accent)]">{money(total)}</span>
                </div>
                {belowMin && (
                  <div className="mt-2.5 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
                    {tr('minOrderWarn').replace('{0}', money(minOrderMissing)).replace('{1}', money(minOrder))}
                  </div>
                )}
                <button
                  onClick={() => { setCartOpen(false); setCheckoutOpen(true); }}
                  disabled={belowMin}
                  className="pub-qty mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--pub-accent)] text-sm font-bold text-[var(--pub-on-accent)] disabled:opacity-40"
                  style={{ minHeight: 48 }}
                >
                  {tr('checkout')} →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ CHECKOUT SHEET ============ */}
      {checkoutOpen && (
        <div onClick={() => setCheckoutOpen(false)} className="fixed inset-0 z-[70] flex items-end bg-black/70 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="pub-sheet-shadow absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-3xl border border-[var(--pub-border)] bg-[var(--pub-bg)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--pub-border)] bg-[var(--pub-bg)] px-5 py-4">
              <h3 className="text-base font-bold">{tr('checkout')}</h3>
              <button onClick={() => setCheckoutOpen(false)} className="pub-qty flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pub-surface)] text-sm hover:bg-[var(--pub-surface2)]">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4">
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {(['DELIVERY', 'PICKUP'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setProfile((p) => ({ ...p, orderType: t }))}
                    className={`flex h-12 items-center justify-center rounded-2xl border text-sm font-bold transition-all ${profile.orderType === t ? 'border-[var(--pub-accent)] bg-[var(--pub-accent)]/15 text-[var(--pub-accent)]' : 'border-[var(--pub-border)] text-[var(--pub-muted)]'}`}
                  >
                    {t === 'DELIVERY' ? tr('deliveryType') : tr('pickupType')}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3.5">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--pub-muted)]">{tr('name')}</label>
                  <input
                    value={profile.name}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-2xl border border-[var(--pub-border)] bg-[var(--pub-surface)] px-4 py-3 text-sm focus:border-[var(--pub-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-ring)]"
                    style={{ minHeight: 44 }}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--pub-muted)]">{tr('phone')}</label>
                  <input
                    value={profile.phone}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    inputMode="tel"
                    placeholder="0300 1234567"
                    className="w-full rounded-2xl border border-[var(--pub-border)] bg-[var(--pub-surface)] px-4 py-3 text-sm focus:border-[var(--pub-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-ring)]"
                    style={{ minHeight: 44, direction: 'ltr' }}
                  />
                </div>
                {isDelivery && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-[var(--pub-muted)]">{tr('address')}</label>
                    <textarea
                      value={profile.address}
                      onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                      rows={2}
                      className="w-full resize-none rounded-2xl border border-[var(--pub-border)] bg-[var(--pub-surface)] px-4 py-3 text-sm focus:border-[var(--pub-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-ring)]"
                    />
                    <button
                      onClick={shareLocation}
                      className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${profile.lat != null ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-[var(--pub-border)] bg-[var(--pub-surface)] text-[var(--pub-muted)]'}`}
                      style={{ minHeight: 36 }}
                    >
                      {profile.lat != null ? `✓ ${tr('locationShared')}` : `📍 ${tr('shareLocation')}`}
                    </button>
                    {profile.lat != null && (
                      <a href={`https://maps.google.com/?q=${profile.lat},${profile.lng}`} target="_blank" rel="noopener" className="ms-2 text-xs text-[var(--pub-accent)] underline">
                        {profile.lat.toFixed(4)}, {profile.lng?.toFixed(4)}
                      </a>
                    )}
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--pub-muted)]">{tr('orderNotes')}</label>
                  <textarea
                    value={profile.notes}
                    onChange={(e) => setProfile((p) => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    className="w-full resize-none rounded-2xl border border-[var(--pub-border)] bg-[var(--pub-surface)] px-4 py-3 text-sm focus:border-[var(--pub-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-ring)]"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-[var(--pub-border)] bg-[var(--pub-surface)] px-3.5 py-3 text-xs text-[var(--pub-muted)]">
                💳 <span>{b.paymentNote || tr('payNote')}</span>
              </div>

              <div className="mt-4 rounded-2xl bg-[var(--pub-surface)] px-4 py-3.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--pub-muted)]">{tr('subtotal')}</span>
                  <span className="font-semibold">{money(subtotal)}</span>
                </div>
                {isDelivery && (
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-[var(--pub-muted)]">{tr('deliveryFee')}</span>
                    <span className="font-semibold">{deliveryFee === 0 ? tr('free') : money(deliveryFee)}</span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-[var(--pub-border)] pt-2.5 text-base font-extrabold">
                  <span>{tr('total')}</span>
                  <span className="text-[var(--pub-accent)]">{money(total)}</span>
                </div>
              </div>

              {siteKey && <div id="cf-turnstile-box" className="mt-4" />}
              {error && <div className="mt-3 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400">{error}</div>}

              <button
                onClick={submitOrder}
                disabled={submitting || !profile.name.trim() || !profile.phone.trim() || (isDelivery && !profile.address.trim()) || belowMin || cart.length === 0}
                className="pub-qty mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--pub-accent)] text-sm font-bold text-[var(--pub-on-accent)] disabled:opacity-40"
                style={{ minHeight: 52 }}
              >
                {submitting ? tr('sending') : `💬 ${tr('placeOrder')} · ${money(total)}`}
              </button>
              <button onClick={() => { setCheckoutOpen(false); setCartOpen(true); }} className="mt-2.5 w-full py-2.5 text-center text-xs font-semibold text-[var(--pub-muted)] hover:text-[var(--pub-text)]">
                ← {tr('backToCart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ CONFIRMATION ============ */}
      {confirmation && (
        <div className="pub-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-5 backdrop-blur-sm">
          <div className="pub-sheet-shadow w-full max-w-sm rounded-3xl border border-[var(--pub-border)] bg-[var(--pub-surface)] p-7 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl">✅</div>
            <h3 className="text-xl font-bold">{tr('orderPlaced')}</h3>
            <p className="mt-1 text-xs text-[var(--pub-muted)]">{tr('orderRef')}</p>
            <div className="mt-2 text-2xl font-black tracking-wider text-[var(--pub-accent)]">{confirmation.reference}</div>
            <div className="mt-2.5 text-sm">
              <span className="text-[var(--pub-muted)]">{tr('total')}: </span>
              <strong>{money(confirmation.total)}</strong>
            </div>
            <button
              onClick={() => window.open(confirmation.whatsappUrl, '_blank', 'noopener')}
              className="pub-qty mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#25d366] text-sm font-bold text-white"
              style={{ minHeight: 48 }}
            >
              💬 {tr('openWhatsappAgain')}
            </button>
            <button onClick={() => { setConfirmation(null); setSearch(''); }} className="mt-3 w-full py-2.5 text-center text-xs font-semibold text-[var(--pub-muted)] hover:text-[var(--pub-text)]">
              {tr('startNew')}
            </button>
          </div>
        </div>
      )}

      {/* ============ TOAST ============ */}
      {toast && (
        <div className="pub-fade-in fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-full border border-[var(--pub-accent)]/40 bg-[var(--pub-surface)] px-4 py-2.5 text-xs font-bold shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
};

// ---------- helpers ----------
export default PublicMenuPage;
