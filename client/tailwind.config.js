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
        canvas: '#101012',
        surface: {
          DEFAULT: '#19191d',
          muted: '#222228',
          highlight: '#2c2c34',
        },
        border: {
          subtle: '#2e2e36',
          strong: '#454552',
        },
        accent: {
          blue: '#3b82f6',
          cyan: '#06b6d4',
          amber: '#f59e0b',
          emerald: '#10b981',
          rose: '#f43f5e',
        },
        text: {
          primary: '#ffffff',
          secondary: '#d4d4d8',   // Zinc-300: crisp, easily readable in dark mode
          muted: '#a1a1aa',       // Zinc-400: clear secondary text, not disappearing
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
