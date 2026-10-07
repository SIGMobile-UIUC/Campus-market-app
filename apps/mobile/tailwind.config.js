/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Set at runtime by ThemeProvider: neutrals follow light or dark mode, campus colors follow the campus.
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        line: "var(--color-line)",
        primary: "var(--color-primary)",
        "on-primary": "var(--color-on-primary)",
        accent: "var(--color-accent)",
        "on-accent": "var(--color-on-accent)",
      },
    },
  },
  plugins: [],
};
