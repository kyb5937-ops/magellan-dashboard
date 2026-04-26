import { NextRequest, NextResponse } from "next/server";
import { fetchChart } from "@/lib/api/yahoo";
import { fetchFredSeries } from "@/lib/api/fred";
import { fetchEcosSeries } from "@/lib/api/ecos";

type RangeKey = "1mo" | "3mo" | "6mo" | "1y" | "3y";
const VALID_RANGES: RangeKey[] = ["1mo", "3mo", "6mo", "1y", "3y"];

// range → 일수 매핑
const RANGE_DAYS: Record<RangeKey, number> = {
  "1mo": 31,
  "3mo": 93,
  "6mo": 186,
  "1y": 365,
  "3y": 1095,
};

/**
 * 두 시계열을 날짜 기준으로 매칭하여 차감
 * (날짜가 다르면 가장 가까운 날짜의 값 사용)
 */
function subtractSeries(
  a: { timestamps: number[]; values: number[] },
  b: { timestamps: number[]; values: number[] }
): { timestamps: number[]; prices: number[] } {
  // b 의 날짜를 (날짜 -> 값) 맵으로 변환
  const bMap = new Map<number, number>();
  b.timestamps.forEach((t, i) => {
    // 날짜만 일치시키기 위해 시간 부분 제거 (UTC 자정으로 정규화)
    const day = Math.floor(t / 86400) * 86400;
    bMap.set(day, b.values[i]);
  });

  const result = { timestamps: [] as number[], prices: [] as number[] };

  for (let i = 0; i < a.timestamps.length; i++) {
    const day = Math.floor(a.timestamps[i] / 86400) * 86400;
    const bValue = bMap.get(day);
    if (bValue !== undefined) {
      result.timestamps.push(a.timestamps[i]);
      result.prices.push(a.values[i] - bValue);
    }
  }

  return result;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const range = req.nextUrl.searchParams.get("range") as RangeKey;

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol 파라미터가 필요합니다" },
      { status: 400 }
    );
  }

  if (!range || !VALID_RANGES.includes(range)) {
    return NextResponse.json(
      { error: "range는 1mo, 3mo, 6mo, 1y, 3y 중 하나여야 합니다" },
      { status: 400 }
    );
  }

  try {
    const days = RANGE_DAYS[range];

    // ── 가상 심볼: 미국 10Y-2Y 스프레드 ──
    // FRED 의 T10Y2Y 시계열을 직접 사용 (이미 차감된 값)
    if (symbol === "SPREAD_US_10Y2Y") {
      const series = await fetchFredSeries("T10Y2Y", days);
      return NextResponse.json({
        timestamps: series.timestamps,
        prices: series.values,
      });
    }

    // ── 가상 심볼: 한국 10Y-3Y 스프레드 ──
    // ECOS 에서 두 시계열을 받아 차감
    if (symbol === "SPREAD_KR_10Y3Y") {
      const [series10y, series3y] = await Promise.all([
        fetchEcosSeries("010210000", days), // 국고채 10년
        fetchEcosSeries("010200000", days), // 국고채 3년
      ]);
      const spread = subtractSeries(series10y, series3y);
      return NextResponse.json(spread);
    }

    // ── 기본: 야후 ──
    const chart = await fetchChart(symbol, range);
    return NextResponse.json(chart);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "조회 실패" },
      { status: 500 }
    );
  }
}
