/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#6023d5',
          700: '#4f22c6',
          800: '#3b16a2',
          900: '#241f48',
        },
        navy: {
          800: '#192038',
          850: '#141a2d',
          900: '#0f1322',
          950: '#0a0d18',
        }
      }
    },
  },
  plugins: [],
}


