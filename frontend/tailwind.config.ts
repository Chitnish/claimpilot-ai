import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
  ],
  safelist: [
    "bg-red-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-orange-500",
    "bg-gray-200",
    // Status pills + semantic accents are sometimes assembled from helper
    // functions, so guarantee the palette ships even if a class only appears
    // in a returned string.
    {
      pattern:
        /(bg|text|border)-(emerald|amber|orange|red|blue|sky|gray|slate|purple|cyan|teal)-(50|100|200|300|600|700|800)/,
    },
    {
      pattern:
        /border-l-(blue|emerald|amber|orange|red|purple|slate|teal|cyan)-(300|400|500)/,
    },
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Enterprise clinical palette
        clinical: {
          shell: "#0a0f1e", // app shell / deepest
          sidebar: "#0d1426", // sidebar surface
          content: "#f1f5f9", // page content canvas
        },
        brand: {
          DEFAULT: "#0ea5e9", // clinical sky blue (accent)
          dark: "#0369a1", // hover / pressed
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },
      fontFamily: {
        // One font everywhere — Geist (sans). `display` is the same family at
        // heavier weights. Mono (Geist Mono) is reserved for IDs/code only.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        // Depth tuned for the near-black canvas (black-based, not navy).
        card: "0 1px 2px rgba(0,0,0,0.4)",
        "card-hover": "0 8px 24px -12px rgba(0,0,0,0.55)",
        elevated:
          "0 1px 2px rgba(0,0,0,0.4), 0 12px 30px -14px rgba(0,0,0,0.55)",
        float: "0 28px 60px -20px rgba(0,0,0,0.7)",
        "glow-brand":
          "0 0 0 1px rgba(14,165,233,0.22), 0 12px 32px -10px rgba(14,165,233,0.40)",
      },
      borderRadius: {
        "2xl": "1rem",
        xl: "0.875rem",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
  ],
}

export default config
