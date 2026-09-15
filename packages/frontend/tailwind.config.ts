import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Chrono" palette: deep space background with cyan/violet accents.
        ink: {
          900: "#05070f",
          800: "#0a0f1d",
          700: "#111827",
          600: "#1b2437",
          500: "#2a3550",
        },
        chrono: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
        violet: {
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
        },
        amber: {
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
        },
        emerald: {
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
        },
        rose: {
          300: "#fda4af",
          400: "#fb7185",
          500: "#f43f5e",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.18), 0 18px 50px -20px rgba(34,211,238,0.35)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -30px rgba(2,6,23,0.9)",
      },
      keyframes: {
        "pulse-bar": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "pulse-bar": "pulse-bar 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
