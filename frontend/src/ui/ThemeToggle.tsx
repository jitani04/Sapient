import { useEffect, useState } from "react";

import { applyTheme, getStoredTheme, toggleTheme, type ThemeMode } from "../theme";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <button
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={`theme-toggle ${compact ? "theme-toggle-compact" : ""}`}
      onClick={() => setTheme((current) => toggleTheme(current))}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      type="button"
    >
      <span className="theme-toggle-icon">{theme === "dark" ? "☼" : "◐"}</span>
      {!compact ? <span>{theme === "dark" ? "Light" : "Dark"}</span> : null}
    </button>
  );
}
