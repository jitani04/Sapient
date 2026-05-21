import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { applyTheme, getStoredTheme, toggleTheme, type ThemeMode } from "../theme";

interface Props {
  variant?: "sidebar" | "icon";
  className?: string;
}

export function ThemeToggle({ variant = "sidebar", className }: Props) {
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const icon = isDark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />;

  if (variant === "icon") {
    return (
      <button
        aria-label={label}
        className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--panel-border,rgba(115,147,179,0.25))] bg-transparent text-[var(--text-soft,#4c6583)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-dim)] hover:text-[var(--accent)] ${className ?? ""}`}
        onClick={() => setTheme((current) => toggleTheme(current))}
        title={label}
        type="button"
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      aria-label={label}
      className={`sidebar-item w-full ${className ?? ""}`}
      onClick={() => setTheme((current) => toggleTheme(current))}
      title={label}
      type="button"
    >
      <span className="sidebar-item-icon">{icon}</span>
      <span className="sidebar-item-label">{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
