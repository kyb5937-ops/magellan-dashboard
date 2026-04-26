import { NextRequest, NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";
import { fetchFredYield } from "@/lib/api/fred";
import { fetchEcosYield } from "@/lib/api/ecos";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol 파라미터가 필요합니다" },
      { status: 400 }
    );
  }

  try {
    // ── 가상 심볼: 미국 10Y-2Y 스프레드 ──
    if (symbol === "SPREAD_US_10Y2Y") {
      const [us10y, us2y] = await Promise.all([
        fetchFredYield("DGS10"),
        fetchFredYield("DGS2"),
      ]);
      const value = us10y.value - us2y.value;
      const previousValue = us10y.previousValue - us2y.previousValue;
      const change = value - previousValue;
      return NextResponse.json({
        symbol: "SPREAD_US_10Y2Y",
        originalInput: "SPREAD_US_10Y2Y",
        name: "미국 10Y-2Y 스프레드",
        exchange: "FRED",
        currency: "%",
        price: value,
        previousClose: previousValue,
        change,
        changePercent: (change / Math.abs(previousValue)) * 100,
        dayHigh: value,
        dayLow: value,
        dayOpen: previousValue,
        volume: 0,
      });
    }

    // ── 가상 심볼: 한국 10Y-3Y 스프레드 ──
    if (symbol === "SPREAD_KR_10Y3Y") {
      const [kr10y, kr3y] = await Promise.all([
        fetchEcosYield("010210000"),
        fetchEcosYield("010200000"),
      ]);
      const value = kr10y.value - kr3y.value;
      const previousValue = kr10y.previousValue - kr3y.previousValue;
      const change = value - previousValue;
      return NextResponse.json({
        symbol: "SPREAD_KR_10Y3Y",
        originalInput: "SPREAD_KR_10Y3Y",
        name: "한국 10Y-3Y 스프레드",
        exchange: "ECOS",
        currency: "%",
        price: value,
        previousClose: previousValue,
        change,
        changePercent: (change / Math.abs(previousValue)) * 100,
        dayHigh: value,
        dayLow: value,
        dayOpen: previousValue,
        volume: 0,
      });
    }

    // ── 기본: 야후 ──
    const quote = await fetchQuote(symbol);
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "조회 실패" },
      { status: 500 }
    );
  }
}
