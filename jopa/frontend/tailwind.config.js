/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'Outfit', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Unbounded', 'Manrope', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      colors: {
        jess: {
          bg: 'var(--bg-primary)',
          sidebar: 'var(--bg-secondary)',
          surface: 'var(--bg-surface)',
          accent: 'var(--accent)',
          accentHover: 'var(--accent-hover)',
          textMain: 'var(--text-main)',
          textMuted: 'var(--text-muted)',
          msgOwn: 'var(--msg-own)',
          msgOther: 'var(--msg-other)'
        }
      },
      borderRadius: {
        jess: 'var(--radius)'
      }
    }
  },
  plugins: []
};
