import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";

// 매 요청마다 실행 — 정적 prerender 방지.
// 야후 호출 자체는 fetchQuote 안에서 60초 캐시되므로 트래픽 부담 없음.
export const dynamic = "force-dynamic";

// SPDR 섹터 ETF 11개 — 야후 한 번 호출로 묶어서 반환
// 두 보고서(ChatGPT/Gemini)가 같은 1차 데이터를 쓰도록 통합

const SPDR_SECTORS: Array<{ symbol: string; name: string }> = [
  { symbol: "XLK",  name: "기술" },
  { symbol: "XLC",  name: "커뮤니케이션" },
  { symbol: "XLY",  name: "경기소비재" },
  { symbol: "XLF",  name: "금융" },
  { symbol: "XLI",  name: "산업재" },
  { symbol: "XLE",  name: "에너지" },
  { symbol: "XLV",  name: "헬스케어" },
  { symbol: "XLP",  name: "필수소비재" },
  { symbol: "XLU",  name: "유틸리티" },
  { symbol: "XLRE", name: "부동산" },
  { symbol: "XLB",  name: "소재" },
];

export interface SectorETFItem {
  symbol: string;
  name: string;            // 한글 섹터명
  value: number;           // 현재가(종가)
  change: number;          // 등락률(%)
  changeType: "pct";
  previousClose: number;
  error?: string;
}

export interface SectorETFsResponse {
  updatedAt: string;
  items: SectorETFItem[];
}

export async function GET() {
  const results = await Promise.all(
    SPDR_SECTORS.map(async ({ symbol, name }): Promise<SectorETFItem> => {
      try {
        const q = await fetchQuote(symbol);
        return {
          symbol,
          name,
          value: q.price,
          change: q.changePercent,
          changeType: "pct",
          previousClose: q.previousClose,
        };
      } catch (err) {
        return {
          symbol,
          name,
          value: 0,
          change: 0,
          changeType: "pct",
          previousClose: 0,
          error: err instanceof Error ? err.message : "조회 실패",
        };
      }
    })
  );

  const body: SectorETFsResponse = {
    updatedAt: new Date().toISOString(),
    items: results,
  };

  return NextResponse.json(body);
}
