"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { FC, ReactNode } from "react";

/**
 * The server sends the theme script as JavaScript, so it runs before the page paints. React then
 * renders it again in the browser, where it never runs, and in development warns about any script
 * that is not a data block. So there it is declared as one.
 */
const SCRIPT_PROPS = { type: typeof window === "undefined" ? undefined : "application/json" };

/**
 * Light and dark modes. Follows the system until the visitor chooses, then remembers the choice in
 * this browser. next-themes sets the `dark` class before the page paints, so there is no flash of
 * the wrong theme.
 */
export const ThemeProvider: FC<{ children: ReactNode }> = ({ children }) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
    scriptProps={SCRIPT_PROPS}
  >
    {children}
  </NextThemesProvider>
);
