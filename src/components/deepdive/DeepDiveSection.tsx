"use client";

import { useState } from "react";
import { DeepDiveChart } from "./DeepDiveChart";

// 14개 지수 정의 — 탭 순서대로 (1행 주가지수 7개, 2행 자산·매크로 7개)
const DEEPDIVE_TABS = [
  // 1행: 주요 주가지수
  { id: "sp500", symbol: "^GSPC", label: "S&P 500" },
  { id: "nasdaq", symbol: "^IXIC", label: "NASDAQ" },
  { id: "dow", symbol: "^DJI", label: "Dow Jones" },
  { id: "sox", symbol: "^SOX", label: "SOX" },
  { id: "russell", symbol: "^RUT", label: "Russell 2000" },
  { id: "kospi", symbol: "^KS11", label: "코스피" },
  { id: "kosdaq", symbol: "^KQ11", label: "코스닥" },
  // 2행: 자산·매크로
  { id: "btc", symbol: "BTC-USD", label: "비트코인" },
  { id: "wti", symbol: "CL=F", label: "WTI" },
  { id: "vix", symbol: "^VIX", label: "VIX" },
  { id: "dxy", symbol: "DX-Y.NYB", label: "DXY" },
  { id: "usdkrw", symbol: "KRW=X", label: "원/달러" },
  { id: "us_spread", symbol: "SPREAD_US_10Y2Y", label: "미 10Y-2Y" },
  { id: "kr_spread", symbol: "SPREAD_KR_10Y3Y", label: "국고채 10Y-3Y" },
] as const;

type TabId = typeof DEEPDIVE_TABS[number]["id"];

export function DeepDiveSection() {
  const [activeTab, setActiveTab] = useState<TabId>("sp500");

  const activeTabData = DEEPDIVE_TABS.find(t => t.id === activeTab)!;

  return (
    <section className="mb-6">
      {/* 섹션 라벨 */}
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        📊 DEEP DIVE
      </div>

      {/* 탭 버튼 — 2행 grid 배치, 각 행 양측 정렬 (균등 폭) */}
      <div className="grid grid-cols-7 gap-1 mb-3">
        {DEEPDIVE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? "bg-navy-light text-fg"
                : "bg-navy text-fg-muted hover:bg-navy-light hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 활성 탭 내용 */}
      {/* key 를 줘서 탭 변경 시 컴포넌트 새로 마운트 → 깨끗한 로딩 상태 */}
      <DeepDiveChart
        key={activeTabData.id}
        symbol={activeTabData.symbol}
        displayName={activeTabData.label}
      />
    </section>
  );
}
