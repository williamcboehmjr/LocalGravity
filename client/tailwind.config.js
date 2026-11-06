/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: '#0B0D11',
        surface: {
          DEFAULT: '#111318',
          1: '#111318',
          2: '#161920',
          elevated: '#1C2029',
          muted: '#1C2029',
          highlight: '#262B36',
        },
        border: {
          subtle: '#262B36',
          strong: '#384050',
          focus: '#8AB4F8',
        },
        accent: {
          blue: '#8AB4F8',
          buttonStart: '#1A73E8',
          buttonEnd: '#4285F4',
          purple: '#C58AF9',
          coral: '#F28B82',
          cyan: '#06b6d4',
          amber: '#f59e0b',
          emerald: '#10b981',
          rose: '#f43f5e',
        },
        text: {
          primary: '#E8EAED',
          secondary: '#9AA0A6',
          muted: '#5F6368',
        },
      },
      fontFamily: {
        sans: ['"Google Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      backgroundImage: {
        'antigravity-sparkle': 'linear-gradient(135deg, #8AB4F8 0%, #C58AF9 50%, #F28B82 100%)',
        'antigravity-button': 'linear-gradient(135deg, #1A73E8 0%, #4285F4 100%)',
      },
    },
  },
  plugins: [],
};
