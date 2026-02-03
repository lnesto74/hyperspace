/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'app-bg': '#0f0f14',
        'card-bg': '#1a1a24',
        'panel-bg': '#12121a',
        'border-dark': '#2a2a3a',
        'highlight': '#3b82f6',
        'highlight-hover': '#2563eb',
        'success': '#22c55e',
        'warning': '#f59e0b',
        'danger': '#ef4444',
        'lidar-online': '#22c55e',
        'lidar-offline': '#6b7280',
        'lidar-connecting': '#f59e0b',
        'track-person': '#3b82f6',
        'track-cart': '#f59e0b',
        'track-unknown': '#8b5cf6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
    },
  },
  plugins: [],
}
