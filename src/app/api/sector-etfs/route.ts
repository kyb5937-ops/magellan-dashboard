import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";
import { fetchFinnhubQuote } from "@/lib/api/finnhub";

// 매 요청마다 실행 — 정적 prerender 방지.
// 1차 소스는 Finnhub(어댑터 내부 5분 메모리 캐시), 실패 시 Yahoo 폴백.
export const dynamic = "force-dynamic";

// SPDR 섹터 ETF 11개 — Finnhub 한 번 호출로 묶어서 반환.
// Why Finnhub: Yahoo가 ETF 등락률을 0.00% 로 잠그는 사고가 반복됨.

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
  source?: "finnhub" | "yahoo";
  warning?: string;        // Yahoo 폴백 등 안내
  error?: string;
}

export interface SectorETFsResponse {
  updatedAt: string;
  items: SectorETFItem[];
}

export async function GET() {
  const results = await Promise.all(
    SPDR_SECTORS.map(async ({ symbol, name }): Promise<SectorETFItem> => {
      // 1차: Finnhub
      try {
        const q = await fetchFinnhubQuote(symbol);
        return {
          symbol,
          name,
          value: q.value,
          change: q.changePercent,
          changeType: "pct",
          previousClose: q.previousClose,
          source: "finnhub",
        };
      } catch (finnhubErr) {
        // 2차: Yahoo 폴백
        try {
          const q = await fetchQuote(symbol);
          return {
            symbol,
            name,
            value: q.price,
            change: q.changePercent,
            changeType: "pct",
            previousClose: q.previousClose,
            source: "yahoo",
            warning: `Finnhub 실패 — Yahoo 폴백 (${
              finnhubErr instanceof Error ? finnhubErr.message : "unknown"
            })`,
          };
        } catch (yahooErr) {
          return {
            symbol,
            name,
            value: 0,
            change: 0,
            changeType: "pct",
            previousClose: 0,
            error: yahooErr instanceof Error ? yahooErr.message : "조회 실패",
          };
        }
      }
    })
  );

  const body: SectorETFsResponse = {
    updatedAt: new Date().toISOString(),
    items: results,
  };

  return NextResponse.json(body);
}
