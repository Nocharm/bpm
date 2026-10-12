import type { Metadata } from "next";
import "./globals.css";

import { GLASS_INIT_SCRIPT } from "@/lib/glass-pref";
import { LangProvider } from "@/lib/i18n";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Business Process Map",
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
      className="h-full antialiased"
      // 유리 끔 스크립트가 하이드레이션 전에 data-glass를 붙인다
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: GLASS_INIT_SCRIPT }} />
      </head>
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
