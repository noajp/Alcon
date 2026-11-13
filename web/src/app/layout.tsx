import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import "./globals.css";
import { AppDialogHost } from "@/Function/shared/AppDialogHost";
import { Toaster } from "@/Function/shared/Toaster";
import { I18nProvider } from "@/Function/i18n/I18nProvider";

// Primary sans-serif - Inter for clean UI typography
// Inter as a variable font (no discrete weights) so the 510 / 590 UI weights
// render precisely; this also drops the off-spec 700+ static instances.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  // Inter has no Japanese: "Clayware JP" (globals.css) takes those glyphs, at
  // weights matched to Inter's, before the system's own Japanese font.
  fallback: ["Clayware JP", "system-ui", "sans-serif"],
});

// Monospace for code/data
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Clayware",
  description: "Organizational activity support for people and AI.",
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
        {/* Preferences this browser saved under the earlier key names move to
            the current ones, once, before anything reads them. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var L=localStorage;if(!L.getItem('clayware:storage-renamed')){for(var i=L.length-1;i>=0;i--){var k=L.key(i);if(k&&k.indexOf('alcon')===0){var n='clayware'+k.slice(5);if(L.getItem(n)===null)L.setItem(n,L.getItem(k));L.removeItem(k)}}L.setItem('clayware:storage-renamed','1')}}catch(e){}",
          }}
        />
        {/* Set the document language before paint. The provider uses the same
            resolution order and translates visible copy after hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var s=['en','ja','ko','fr','es'];var n=function(x){var l=(x||'').trim().toLowerCase().split(/[-_]/)[0];return s.includes(l)?l:null};var v=null;try{v=localStorage.getItem('clayware:locale')}catch(e){}var l=n(v);if(!l){var a=navigator.languages||[navigator.language];for(var i=0;i<a.length&&!l;i++)l=n(a[i])}document.documentElement.lang=l||'en'}catch(e){}",
          }}
        />
        {/* Apply the Font size (text scale --fs) before first paint. Default is
            the slightly-large baseline (1.075) when nothing is saved. Keep the
            map in sync with FONT_SIZES in Function/settings/appearanceOptions. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var k=localStorage.getItem('clayware.fontsize');var m={smaller:'0.925',small:'1',default:'1.075',large:'1.15',larger:'1.25'};document.documentElement.style.setProperty('--fs',m[k]||'1.075');}catch(e){}",
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <I18nProvider>
          <ThemeProvider>
            <QueryProvider>
              <AuthProvider>
                {children}
                <AppDialogHost />
                <Toaster />
              </AuthProvider>
            </QueryProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
