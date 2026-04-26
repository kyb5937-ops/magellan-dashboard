import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마젤란의 항해노트 · 모니터링 대시보드",
  description: "한국 투자자를 위한 IB 관점 시장 모니터. 미국·한국 주요 지수, 금리, 환율을 한눈에.",
  openGraph: {
    title: "마젤란의 항해노트 · 모니터링 대시보드",
    description: "한국 투자자를 위한 IB 관점 시장 모니터",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="bg-navy-darkest text-fg font-sans">
        {children}
      </body>
    </html>
  );
}
