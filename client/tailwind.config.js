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
        canvas: '#101114',
        surface: {
          DEFAULT: '#131314',
          1: '#101012',
          2: '#161618',
          elevated: '#1E1E20',
          muted: '#1A1A1C',
          highlight: '#262629',
        },
        border: {
          subtle: '#242427',
          strong: '#2E2E32',
          focus: '#4E4E54',
        },
        accent: {
          blue: '#8AB4F8',
          buttonStart: '#262629',
          buttonEnd: '#2E2E32',
          purple: '#C084FC',
          coral: '#F87171',
          cyan: '#38BDF8',
          amber: '#FBBF24',
          emerald: '#34D399',
          rose: '#FB7185',
        },
        text: {
          primary: '#E3E3E3',
          secondary: '#9A9A9E',
          muted: '#6E6E73',
        },
      },
      fontFamily: {
        sans: [
          '"Google Sans"',
          '"Google Sans Text"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Inter"',
          'Roboto',
          '"Segoe UI"',
          'sans-serif',
        ],
        mono: [
          '"Roboto Mono"',
          '"SF Mono"',
          '"JetBrains Mono"',
          '"Fira Code"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
