import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { LangProvider } from "@/lib/i18n";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/top-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BPM — Business Process Management",
  description: "계층형 프로세스맵 작성·편집 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-screen flex flex-col">
        <LangProvider>
          <TopNav />
          <main className="flex flex-1 flex-col min-h-0">
            <Providers>{children}</Providers>
          </main>
        </LangProvider>
      </body>
    </html>
  );
}
