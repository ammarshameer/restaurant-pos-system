/** @type {import('tailwindcss').Config} */
module.exports = {
  // Preflight is intentionally NOT enabled (index.css does not import
  // @tailwind base) so the existing POS styling keeps its browser defaults.
  corePlugins: {
    preflight: false,
  },
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        brand: {
          primary: 'var(--primary)',
          accent: 'var(--accent)',
          onprimary: 'var(--on-primary)',
        },
        surface: {
          DEFAULT: 'var(--bg-card)',
          raised: 'var(--bg-elevated)',
          hover: 'var(--bg-card-hover)',
        },
        line: {
          DEFAULT: 'var(--border-color)',
          active: 'var(--border-active)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          soft: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        ok: 'var(--success)',
        warn: 'var(--warning)',
        bad: 'var(--danger)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        glow: 'var(--shadow-glow)',
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(48px)', opacity: '0.5' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pop-in': {
          from: { transform: 'scale(0.94)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.24s cubic-bezier(0.2,0.8,0.3,1)',
        'fade-in': 'fade-in 0.25s ease',
        'pop-in': 'pop-in 0.2s cubic-bezier(0.2,0.8,0.3,1)',
      },
    },
  },
  plugins: [],
};
