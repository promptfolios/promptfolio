"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import type { FC } from "react";
import { Button } from "@/components/ui/button";

/**
 * Switches between light and dark. The server does not know the visitor's theme, so the icons are
 * chosen by CSS, which keeps the server's markup and the first render in the browser the same.
 */
export const ThemeToggle: FC = () => {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Switch between light and dark mode"
      title="Switch between light and dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <MoonIcon className="dark:hidden" />
      <SunIcon className="hidden dark:block" />
    </Button>
  );
};
