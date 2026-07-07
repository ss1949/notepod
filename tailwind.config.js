/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--color-bg-primary)",
          secondary: "var(--color-bg-secondary)",
          tertiary: "var(--color-bg-tertiary)",
          sidebar: "var(--color-bg-sidebar)",
          "sidebar-hover": "var(--color-bg-sidebar-hover)",
          "sidebar-active": "var(--color-bg-sidebar-active)",
          "card-hover": "var(--color-bg-card-hover)",
          "card-active": "var(--color-bg-card-active)",
          input: "var(--color-bg-input)",
          toolbar: "var(--color-bg-toolbar)",
          modal: "var(--color-bg-modal)",
          empty: "var(--color-bg-empty)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          "on-accent": "var(--color-text-on-accent)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover: "var(--color-danger-hover)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};
