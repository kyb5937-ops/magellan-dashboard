import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";
import { fetchFredYield } from "@/lib/api/fred";
import { fetchEcosYield } from "@/lib/api/ecos";
import { INDICATORS, IndicatorMeta } from "@/lib/data/indicators";

// 매번 새로 실행 — 캐시는 각 어댑터 내부에서 관리
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface IndicatorResult {
  id: string;
  value: number | null;
  change: number | null;
  changeType: "pct" | "bp" | "won";
  error?: string;
}

// 각 소스별 어댑터를 호출해서 공통 형식으로 변환
async function fetchIndicator(meta: IndicatorMeta): Promise<IndicatorResult> {
  try {
    switch (meta.dataSource) {
      case "yahoo": {
        const quote = await fetchQuote(meta.symbol);
        const isWon = meta.valueType === "fx";
        return {
          id: meta.id,
          value: quote.price,
          change: isWon ? quote.change : quote.changePercent,
          changeType: isWon ? "won" : "pct",
        };
      }

      case "fred": {
        const yieldData = await fetchFredYield(meta.symbol);
        return {
          id: meta.id,
          value: yieldData.value,
          change: yieldData.changeBps,
          changeType: "bp",
        };
      }

      case "ecos": {
        const yieldData = await fetchEcosYield(meta.symbol);
        return {
          id: meta.id,
          value: yieldData.value,
          change: yieldData.changeBps,
          changeType: "bp",
        };
      }
    }
  } catch (err) {
    return {
      id: meta.id,
      value: null,
      change: null,
      changeType: "pct",
      error: err instanceof Error ? err.message : "조회 실패",
    };
  }
}

export async function GET() {
  // 15개를 동시에 병렬 조회
  const results = await Promise.all(INDICATORS.map(fetchIndicator));

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    values: results,
  });
}
