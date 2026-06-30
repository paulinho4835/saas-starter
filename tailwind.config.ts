import type { Config } from "tailwindcss";

// Helper: color respaldado por variable CSS para que soporte opacidad (`/10`)
// y, sobre todo, para que pueda invertirse en modo oscuro sin tocar las clases.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      colors: {
        // `white` y la escala `slate` se respaldan en variables CSS. En modo
        // claro mantienen sus valores de siempre; en `.dark` se invierten (ver
        // globals.css), así toda la app cambia de tema sin reescribir clases.
        white: v("--white"),
        slate: {
          50: v("--slate-50"),
          100: v("--slate-100"),
          200: v("--slate-200"),
          300: v("--slate-300"),
          400: v("--slate-400"),
          500: v("--slate-500"),
          600: v("--slate-600"),
          700: v("--slate-700"),
          800: v("--slate-800"),
          900: v("--slate-900"),
          950: v("--slate-950"),
        },
        // Superficie oscura fija (no se invierte): botones "dark", toasts info.
        night: {
          DEFAULT: "#0f172a",
          soft: "#1e293b",
        },
        // Color de marca. Cambia estos valores para re-tematizar todo el starter.
        brand: {
          DEFAULT: "#4f46e5",
          fg: "#4338ca",
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
      },
      keyframes: {
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        shake: "shake 0.4s ease-in-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
