import type { Config } from "tailwindcss";

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: rgb("--bg"),
        surface: rgb("--surface"),
        border: rgb("--border"),
        fg: rgb("--fg"),
        muted: rgb("--muted"),
        accent: rgb("--accent"),
        "accent-fg": rgb("--accent-fg"),
        "st-running": rgb("--status-running"),
        "st-running-soft": rgb("--status-running-soft"),
        "st-ok": rgb("--status-ok"),
        "st-ok-soft": rgb("--status-ok-soft"),
        "st-error": rgb("--status-error"),
        "st-error-soft": rgb("--status-error-soft"),
        "st-cancelled": rgb("--status-cancelled"),
        "st-cancelled-soft": rgb("--status-cancelled-soft"),
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
