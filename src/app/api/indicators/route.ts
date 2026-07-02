import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";
import { fetchFredYield, fetchFredIndex } from "@/lib/api/fred";
import { fetchEcosYield, fetchEcosFxRate } from "@/lib/api/ecos";
import { loadKrxIndexFile } from "@/lib/api/krxIndex";
import { loadUsIndexFile } from "@/lib/api/usIndexFile";
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

// fetchIndicator 가 만든 공통 메타 필드 묶음 (각 어댑터가 spread 로 합침)
type BaseResult = Pick<
  IndicatorResult,
  "id" | "name" | "region" | "valueType" | "symbol" | "decimals"
>;

// ── 국고채 폴백: ECOS 일별 금리 (kr3y/kr10y 공통) ──
// 기존 case "ecos" 가 하던 로직 그대로. krxFile 분기와 ecos 케이스가 함께 호출.
async function ecosYieldResult(
  meta: IndicatorMeta,
  base: BaseResult
): Promise<IndicatorResult> {
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

// ── 원/달러 폴백: Yahoo 현재가 + ECOS 매매기준율로 변동폭 재계산 ──
// 기존 case "yahoo" 의 usdkrw 분기 로직 그대로. krxFile 분기와 yahoo 케이스가 함께 호출.
async function yahooUsdkrwResult(
  meta: IndicatorMeta,
  base: BaseResult
): Promise<IndicatorResult> {
  const quote = await fetchQuote(meta.symbol);

  // usdkrw는 Yahoo previousClose(OTC 24시간) 대신 ECOS 매매기준율로 변동폭 재계산.
  // 실패 시 Yahoo previousClose fallback (기존 동작 유지).
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

  return {
    ...base,
    value: quote.price,
    change: quote.change,
    changeType: "won",
    dataTimestamp: quote.dataTimestamp,
  };
}

// ── 지수 폴백: FRED 가격 지수 → 실패 시 Yahoo (sp500/nasdaq/dow 공통) ──
// 기존 case "fredIndex" 가 하던 로직 그대로. fredIndex 케이스와 usFile 분기가 함께 호출.
async function fredIndexResult(
  meta: IndicatorMeta,
  base: BaseResult
): Promise<IndicatorResult> {
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

// ── 금리 폴백: FRED 일별 금리 (us2y/us10y 공통) ──
// 기존 case "fred" 가 하던 로직 그대로. fred 케이스와 usFile 분기가 함께 호출.
async function fredYieldResult(
  meta: IndicatorMeta,
  base: BaseResult
): Promise<IndicatorResult> {
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

// ── 지수 폴백: Yahoo 현재가 (SOX 등 가격/% 카드) ──
// 기존 case "yahoo" 의 비-fx 분기 로직 그대로. yahoo 케이스와 usFile 분기가 함께 호출.
async function yahooPriceResult(
  meta: IndicatorMeta,
  base: BaseResult
): Promise<IndicatorResult> {
  const quote = await fetchQuote(meta.symbol);
  return {
    ...base,
    value: quote.price,
    change: quote.changePercent,
    changeType: "pct",
    dataTimestamp: quote.dataTimestamp,
  };
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
        // usdkrw는 Yahoo 현재가 + ECOS 매매기준율 재계산 경로 (헬퍼 공용).
        if (meta.id === "usdkrw") {
          return await yahooUsdkrwResult(meta, base);
        }

        const quote = await fetchQuote(meta.symbol);
        const isWon = meta.valueType === "fx";
        return {
          ...base,
          value: quote.price,
          change: isWon ? quote.change : quote.changePercent,
          changeType: isWon ? "won" : "pct",
          dataTimestamp: quote.dataTimestamp,
        };
      }

      case "fredIndex": {
        return await fredIndexResult(meta, base);
      }

      case "fred": {
        return await fredYieldResult(meta, base);
      }

      case "usFile": {
        // 미국 지수·금리를 index-us.json(모닝 배치 미국 종가)에서 읽는다.
        // 파일/항목이 없으면 기존 FRED/Yahoo 경로로 폴백.
        const file = await loadUsIndexFile();

        // 지수: S&P 500·NASDAQ·Dow·SOX
        if (
          meta.id === "sp500" ||
          meta.id === "nasdaq" ||
          meta.id === "dow" ||
          meta.id === "sox"
        ) {
          const entry =
            meta.id === "sp500"
              ? file?.sp500
              : meta.id === "nasdaq"
                ? file?.nasdaq
                : meta.id === "dow"
                  ? file?.dow
                  : file?.sox;

          // 지수 폴백(sp500/nasdaq/dow → FRED→Yahoo, sox → Yahoo).
          const indexFallback = () =>
            meta.id === "sox"
              ? yahooPriceResult(meta, base)
              : fredIndexResult(meta, base);

          // value 가 유효하면 파일 값을 쓴다. 등락(change_pct)이 null 이면
          // 그 부분만 폴백에서 보충하고 value/dataDate 는 파일 값 유지.
          if (entry && typeof entry.value === "number") {
            const fileFields = {
              value: entry.value,
              dataDate: entry.tradeDate,
              dataTimestamp: file?.updatedAt ?? null,
            };
            if (typeof entry.change_pct === "number") {
              return { ...base, ...fileFields, change: entry.change_pct, changeType: "pct" };
            }
            const fb = await indexFallback();
            return {
              ...base,
              ...fileFields,
              change: fb.change,
              changeType: "pct",
              warning: "등락 index-us.json 누락 — 등락만 폴백 보충",
            };
          }

          // 파일/항목 없거나 value 무효 → 전체 폴백
          const r = await indexFallback();
          return {
            ...r,
            warning:
              r.warning ??
              (meta.id === "sox"
                ? "index-us.json 없음 — Yahoo 폴백"
                : "index-us.json 없음 — FRED 폴백"),
          };
        }

        // 금리: 미 2Y·10Y
        const entry = meta.id === "us2y" ? file?.us2y : file?.us10y;
        // value 가 유효하면 파일 값을 쓴다. 등락(change_bp)이 null 이면
        // 그 부분만 FRED 에서 보충하고 value/dataDate 는 파일 값 유지.
        if (entry && typeof entry.value === "number") {
          const fileFields = {
            value: entry.value,
            dataDate: entry.tradeDate,
            dataTimestamp: file?.updatedAt ?? null,
          };
          if (typeof entry.change_bp === "number") {
            return { ...base, ...fileFields, change: entry.change_bp, changeType: "bp" };
          }
          const fb = await fredYieldResult(meta, base);
          return {
            ...base,
            ...fileFields,
            change: fb.change,
            changeType: "bp",
            warning: "등락 index-us.json 누락 — 등락만 폴백 보충",
          };
        }
        // 파일/항목 없거나 value 무효 → 전체 폴백: FRED 일별 금리
        const r = await fredYieldResult(meta, base);
        return { ...r, warning: r.warning ?? "index-us.json 없음 — FRED 폴백" };
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
        return await ecosYieldResult(meta, base);
      }

      case "krxFile": {
        // 국고채 3·10년·원/달러를 index-kr.json(이브닝 배치 당일치)에서 읽는다.
        // 파일/항목이 없으면 기존 ECOS(국고채)·Yahoo(원달러) 경로로 폴백.
        const file = await loadKrxIndexFile();

        if (meta.id === "kr3y" || meta.id === "kr10y") {
          const entry = meta.id === "kr3y" ? file?.kr3y : file?.kr10y;
          if (
            entry &&
            typeof entry.value === "number" &&
            typeof entry.change_bp === "number"
          ) {
            return {
              ...base,
              value: entry.value,
              change: entry.change_bp,
              changeType: "bp",
              dataDate: entry.tradeDate,
              dataTimestamp: file?.updatedAt ?? null,
            };
          }
          // 폴백: ECOS 일별 금리
          const r = await ecosYieldResult(meta, base);
          return { ...r, warning: r.warning ?? "KRX 파일 없음 — ECOS 폴백" };
        }

        // usdkrw
        const entry = file?.usdkrw;
        if (
          entry &&
          typeof entry.value === "number" &&
          typeof entry.change === "number"
        ) {
          return {
            ...base,
            value: entry.value,
            change: entry.change,
            changeType: "won",
            dataDate: file?.date,
            dataTimestamp: file?.updatedAt ?? null,
          };
        }
        // 폴백: Yahoo + ECOS 매매기준율
        const r = await yahooUsdkrwResult(meta, base);
        return { ...r, warning: r.warning ?? "KRX 파일 없음 — Yahoo 폴백" };
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
