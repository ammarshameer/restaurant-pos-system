export interface ThemePaletteOption {
  id: string;
  name: string;
  hex: string;
  desc: string;
}

/**
 * Accent palettes supported by `index.css` via `[data-palette="..."]`.
 * Keep this list in sync with the CSS palette definitions.
 */
export const PALETTE_OPTIONS: ThemePaletteOption[] = [
  { id: 'espresso', name: 'Espresso & Gold', hex: '#e0a93f', desc: 'Warm coffee roast & amber gold' },
  { id: 'wine', name: 'Merlot & Rose', hex: '#e11d48', desc: 'Deep burgundy & rose gold' },
  { id: 'ocean', name: 'Ocean & Cyan', hex: '#0284c7', desc: 'Deep oceanic slate & rich cyan' },
  { id: 'emerald', name: 'Emerald & Mint', hex: '#059669', desc: 'Lush forest green & mint' },
  { id: 'royal', name: 'Royal & Lilac', hex: '#7c3aed', desc: 'Regal amethyst plum & lilac' },
  { id: 'sunset', name: 'Sunset Amber', hex: '#ea580c', desc: 'Warm charcoal & terracotta amber' },
  { id: 'rose', name: 'Dusty Rose', hex: '#db2777', desc: 'Charcoal with ruby pink accent' },
  { id: 'midnight', name: 'Midnight Slate', hex: '#64748b', desc: 'Modern dark slate with silver tone' },
];
