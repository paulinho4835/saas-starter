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
        // Color de marca. Igual al azul primario del legacy "Venta Retenes"
        // (#3472F7, hover #1D62F0) — cambia estos valores para re-tematizar
        // todo el starter.
        brand: {
          DEFAULT: "#3472F7",
          fg: "#1D62F0",
          50: "#f4f8ff",
          100: "#e9f0ff",
          200: "#d6e4fe",
          300: "#b6d0fd",
          400: "#8ab0fb",
          500: "#5f8ff9",
          600: "#3472F7",
          700: "#1D62F0",
          800: "#1650c4",
          900: "#113f96",
        },
        // Degradado del sidebar legacy ("Light Bootstrap Dashboard", data-color="red").
        sidebar: {
          from: "#FB404B",
          to: "#bb0502",
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
