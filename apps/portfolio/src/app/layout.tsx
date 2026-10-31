import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Promptfolio",
  description: "A conversational professional portfolio.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the theme class on this element before React hydrates it.
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
