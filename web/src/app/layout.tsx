import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import "./globals.css";

// Primary sans-serif - Inter for clean UI typography
// Inter as a variable font (no discrete weights) so the 510 / 590 UI weights
// render precisely; this also drops the off-spec 700+ static instances.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Monospace for code/data
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Alcon — 組織活動支援",
  description: "Strategy・Execution・Sustainmentで、人間とAIによる組織活動を支援する。",
};

// Mobile rendering: without this, mobile Safari lays the page out at ~980px and
// scales it down (everything tiny). `width=device-width, initial-scale=1` makes
// the layout viewport match the device so the responsive shell (sidebar drawer
// under 1024px) actually engages. `viewport-fit=cover` lets us pad against the
// notch/home-indicator via env(safe-area-inset-*). User scaling is left on
// (no maximum-scale / user-scalable=no) for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8f8" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the Font size (text scale --fs) before first paint. Default is
            the slightly-large baseline (1.075) when nothing is saved. Keep the
            map in sync with FONT_SIZES in alcon/settings/appearanceOptions. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var k=localStorage.getItem('alcon.fontsize');var m={smaller:'0.925',small:'1',default:'1.075',large:'1.15',larger:'1.25'};document.documentElement.style.setProperty('--fs',m[k]||'1.075');}catch(e){}",
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              {children}
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
