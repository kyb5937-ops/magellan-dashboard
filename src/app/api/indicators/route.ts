import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";
import { fetchFredYield } from "@/lib/api/fred";
import { fetchEcosYield } from "@/lib/api/ecos";
import { INDICATORS, IndicatorMeta, Region, ValueType } from "@/lib/data/indicators";

// 매번 새로 실행 — 캐시는 각 어댑터 내부에서 관리
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface IndicatorResult {
  id: string;
  name: string;
  region: Region;
  value: number | null;
  change: number | null;
  changeType: "pct" | "bp" | "won";
  valueType: ValueType;
  symbol: string;
  decimals: number;
  error?: string;
  // 4/30 사고 처방 — 시점 검증 메타데이터
  dataDate?: string;
  staleness?: number;
  warning?: string;
}

// 각 소스별 어댑터를 호출해서 공통 형식으로 변환
async function fetchIndicator(meta: IndicatorMeta): Promise<IndicatorResult> {
  // 모든 응답에 메타데이터 포함 (AI/외부 클라이언트가 활용하기 좋게)
  const base = {
    id: meta.id,
    name: meta.name,
    region: meta.region,
    valueType: meta.valueType,
    symbol: meta.symbol,
    decimals: meta.decimals,
  };

  try {
    switch (meta.dataSource) {
      case "yahoo": {
        const quote = await fetchQuote(meta.symbol);
        const isWon = meta.valueType === "fx";
        return {
          ...base,
          value: quote.price,
          change: isWon ? quote.change : quote.changePercent,
          changeType: isWon ? "won" : "pct",
        };
      }

      case "fred": {
        const yieldData = await fetchFredYield(meta.symbol);
        return {
          ...base,
          value: yieldData.value,
          change: yieldData.changeBps,
          changeType: "bp",
          dataDate: yieldData.date,
          ...(yieldData.staleness !== undefined && { staleness: yieldData.staleness }),
          ...(yieldData.stalenessWarning && { warning: yieldData.stalenessWarning }),
        };
      }

      case "ecos": {
        const yieldData = await fetchEcosYield(meta.symbol);
        return {
          ...base,
          value: yieldData.value,
          change: yieldData.changeBps,
          changeType: "bp",
          dataDate: yieldData.date,
          ...(yieldData.staleness !== undefined && { staleness: yieldData.staleness }),
          ...(yieldData.stalenessWarning && { warning: yieldData.stalenessWarning }),
        };
      }
    }
  } catch (err) {
    return {
      ...base,
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

  // US/KR 지역별 그룹화 (AI/외부 클라이언트가 활용하기 좋게)
  const us = results.filter((r) => r.region === "US");
  const kr = results.filter((r) => r.region === "KR");

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    description: "마젤란 대시보드 시장 지표 (15개 카드 통합 응답)",
    summary: {
      total: results.length,
      us: us.length,
      kr: kr.length,
      successCount: results.filter((r) => r.value !== null).length,
      errorCount: results.filter((r) => r.error).length,
    },
    us,
    kr,
    // 호환성을 위해 평탄화 배열도 함께 제공 (기존 클라이언트용)
    values: results,
  });
}
