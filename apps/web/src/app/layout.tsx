import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_COLOR, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vistoo", template: "%s · Vistoo" },
  description: "Internes Projektmanagement von Vistoo",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Initial value per system setting; applyTheme() updates it for an explicit choice.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
  width: "device-width",
  initialScale: 1,
  // Android: shrink the layout when the on-screen keyboard opens (chat composer stays visible).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script sets `dark`/`light` on <html> before hydration (stored choice or system).
    <html lang="de" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">
        <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
