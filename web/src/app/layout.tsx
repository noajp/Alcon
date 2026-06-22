import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Comfortaa } from "next/font/google";
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

// Logo font - rounded A with dot-like crossbar
const comfortaa = Comfortaa({
  variable: "--font-logo",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Alcon - AI-Powered Project Management",
  description: "Discover hidden dependencies across your organization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved Font size (UI zoom) before first paint. Keep the
            map in sync with FONT_SIZES in alcon/settings/AppearanceSettings. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var k=localStorage.getItem('alcon.fontsize');var m={xs:'0.85',s:'0.925',m:'1.075',l:'1.15',xl:'1.25'};if(k&&m[k])document.documentElement.style.setProperty('zoom',m[k]);}catch(e){}",
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${comfortaa.variable} antialiased`}
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
