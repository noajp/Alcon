import type { Metadata } from "next";
import { Syne, JetBrains_Mono, Comfortaa } from "next/font/google";
import "./globals.css";

// Primary sans-serif - distinctive geometric with personality
const syne = Syne({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
    <html lang="en">
      <body
        className={`${syne.variable} ${jetbrainsMono.variable} ${comfortaa.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
