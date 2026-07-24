/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        kxbg: '#09090B',
        kxsurface: '#0F172A',
        kxsurface2: '#1E293B',
        kxblue: '#00A3FF',
        kxpurple: '#8B5CF6',
        kxpink: '#D946C6',
        kxmist: '#94A3B8',
        kxmistdim: '#5B6579',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      backgroundImage: {
        'kx-gradient': 'linear-gradient(120deg, #D946C6 0%, #8B5CF6 48%, #00A3FF 100%)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(148,163,184,.12), 0 20px 60px -25px rgba(0,163,255,.35)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(14px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: {
        'fade-up': 'fade-up .5s cubic-bezier(.16,1,.3,1) both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
