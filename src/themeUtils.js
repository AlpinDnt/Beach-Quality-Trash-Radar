// Theme management: light | dark.
// Disimpan di localStorage (key rpb-theme) + class "dark" di <html>.
// Tailwind v4 memakai @custom-variant dark di index.css agar dark:
// merespons class tersebut (bukan prefers-color-scheme).

const THEME_KEY = "rpb-theme";

export function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Mode privat: localStorage tidak tersedia, pakai default.
  }
  // Default: light mode (per spec).
  return "light";
}

export function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else {
    html.classList.remove("dark");
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Mode privat: abaikan, hanya atur DOM.
  }
}

export function toggleTheme(current) {
  return current === "light" ? "dark" : "light";
}
