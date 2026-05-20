"use client";

import { useTheme } from "./ThemeProvider";
import { SunIcon, MoonIcon } from "@/app/components/Icons";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={`border-border text-text-secondary hover:border-gold-bright) hover:text-gold-bright) flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border bg-transparent transition-all duration-200 ${className}`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
