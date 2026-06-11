import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";
import { fetchFredYield, fetchFredIndex } from "@/lib/api/fred";
import { fetchEcosYield, fetchEcosFxRate } from "@/lib/api/ecos";
import { loadKrxIndexFile } from "@/lib/api/krxIndex";
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
  // usdkrw 변동폭 재계산용 ECOS 매매기준율 (디버깅·검증용)
  ecosPreviousClose?: number;
  ecosDate?: string;
  /**
   * 가격·금리 데이터의 시점 (ISO 8601 UTC).
   * - yahoo 소스: fetchQuote가 반환한 dataTimestamp 그대로
   * - fred/ecos 소스: dataDate(YYYY-MM-DD)에서 파생 (시각은 임의 고정)
   * AI 보고서·사용자가 데이터 신선도를 검증할 수 있도록 노출.
   */
  dataTimestamp?: string | null;
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

        // usdkrw는 Yahoo previousClose(OTC 24시간) 대신 ECOS 매매기준율로 변동폭 재계산.
        // 실패 시 Yahoo previousClose fallback (기존 동작 유지).
        if (meta.id === "usdkrw") {
          try {
            const ecosFx = await fetchEcosFxRate();
            return {
              ...base,
              value: quote.price,
              change: quote.price - ecosFx.previousClose,
              changeType: "won",
              dataTimestamp: quote.dataTimestamp,
              ecosPreviousClose: ecosFx.previousClose,
              ecosDate: ecosFx.date,
              staleness: ecosFx.staleness,
              ...(ecosFx.stalenessWarning && { warning: ecosFx.stalenessWarning }),
            };
          } catch (e) {
            console.error("ECOS FX fallback to Yahoo previousClose:", e);
          }
        }

        return {
          ...base,
          value: quote.price,
          change: isWon ? quote.change : quote.changePercent,
          changeType: isWon ? "won" : "pct",
          dataTimestamp: quote.dataTimestamp,
        };
      }

      case "fredIndex": {
        // FRED 가격 지수(S&P 500, Dow, NASDAQ Composite).
        // 실패 시 동일 카드의 Yahoo 폴백 티커(meta.symbol)로 전환.
        try {
          if (!meta.fredSymbol) {
            throw new Error(`fredIndex 카드 ${meta.id} 에 fredSymbol 미지정`);
          }
          const idx = await fetchFredIndex(meta.fredSymbol);
          return {
            ...base,
            value: idx.value,
            change: idx.changePercent,
            changeType: "pct",
            dataDate: idx.date,
            // FRED는 일자만 알려주므로 시각은 미 마감 부근(20:00 UTC)으로 고정
            dataTimestamp: `${idx.date}T20:00:00Z`,
          };
        } catch (e) {
          console.error(`FRED 지수 ${meta.fredSymbol} 실패 — Yahoo 폴백:`, e);
          const quote = await fetchQuote(meta.symbol);
          return {
            ...base,
            value: quote.price,
            change: quote.changePercent,
            changeType: "pct",
            dataTimestamp: quote.dataTimestamp,
            warning: "FRED 지수 조회 실패 — Yahoo 폴백",
          };
        }
      }

      case "fred": {
        const yieldData = await fetchFredYield(meta.symbol);
        return {
          ...base,
          value: yieldData.value,
          change: yieldData.changeBps,
          changeType: "bp",
          dataDate: yieldData.date,
          // FRED는 일자만 알려주므로 ISO 시각은 임의 고정 (20:00 UTC ≈ 미 마감 부근).
          // 정확한 시각은 dataDate 참조.
          dataTimestamp: `${yieldData.date}T20:00:00Z`,
          ...(yieldData.staleness !== undefined && { staleness: yieldData.staleness }),
          ...(yieldData.stalenessWarning && { warning: yieldData.stalenessWarning }),
        };
      }

      case "krxIndex": {
        // KRX 공식 종가(코스피·코스닥). 매 거래일 GH Actions 가 갱신.
        // 파일/항목이 없거나 값이 비정상이면 Yahoo 경로로 폴백.
        const file = await loadKrxIndexFile();
        const entry =
          meta.id === "kospi"
            ? file?.kospi
            : meta.id === "kosdaq"
              ? file?.kosdaq
              : undefined;

        if (
          entry &&
          typeof entry.value === "number" &&
          typeof entry.change_pct === "number"
        ) {
          // dataTimestamp: updatedAt 우선, 없으면 tradeDate 기반(KRX 마감 ≈ 15:30 KST = 06:30 UTC)
          const dataTimestamp =
            file?.updatedAt ??
            (entry.tradeDate ? `${entry.tradeDate}T06:30:00Z` : null);

          return {
            ...base,
            value: entry.value,
            change: entry.change_pct,
            changeType: "pct",
            dataDate: entry.tradeDate,
            dataTimestamp,
          };
        }

        // Fallback: KRX 데이터가 없으면 Yahoo 로
        const quote = await fetchQuote(meta.symbol);
        return {
          ...base,
          value: quote.price,
          change: quote.changePercent,
          changeType: "pct",
          dataTimestamp: quote.dataTimestamp,
          warning: "KRX index-kr.json 사용 불가 — Yahoo 폴백",
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
          // ECOS는 일자만 알려주므로 ISO 시각은 임의 고정 (20:00 UTC).
          // 정확한 시각은 dataDate 참조.
          dataTimestamp: `${yieldData.date}T20:00:00Z`,
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
