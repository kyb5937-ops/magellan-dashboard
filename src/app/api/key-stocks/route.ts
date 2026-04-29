import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/api/yahoo";

// 매 요청마다 실행 — 정적 prerender 방지.
// 야후 호출 자체는 fetchQuote 안에서 60초 캐시.
export const dynamic = "force-dynamic";

// 마젤란 대시보드 핵심 종목 통합 응답
// 빅테크 7 + 반도체 체인 6 + 벤치마크 2 = 총 15개
//
// 미국 마감 보고서 워크플로우에서 ChatGPT/Gemini가 종목별로 따로 호출하면
// 일부를 누락하거나 환각 데이터를 만드는 사고가 있어, 한 번에 묶어서 응답.
// 동일 시점·동일 1차 데이터를 강제하는 것이 목적.

type Group = "big_tech" | "semi_chain" | "benchmark";

interface KeyStockSpec {
  symbol: string;
  name: string;
  group: Group;
}

const KEY_STOCKS: KeyStockSpec[] = [
  // big_tech (7)
  { symbol: "MSFT",  name: "Microsoft",        group: "big_tech" },
  { symbol: "GOOGL", name: "Alphabet",         group: "big_tech" },
  { symbol: "AAPL",  name: "Apple",            group: "big_tech" },
  { symbol: "AMZN",  name: "Amazon",           group: "big_tech" },
  { symbol: "META",  name: "Meta Platforms",   group: "big_tech" },
  { symbol: "TSLA",  name: "Tesla",            group: "big_tech" },
  { symbol: "ORCL",  name: "Oracle",           group: "big_tech" },

  // semi_chain (6)
  { symbol: "NVDA",  name: "NVIDIA",            group: "semi_chain" },
  { symbol: "TSM",   name: "TSMC ADR",          group: "semi_chain" },
  { symbol: "AMD",   name: "AMD",               group: "semi_chain" },
  { symbol: "MU",    name: "Micron Technology", group: "semi_chain" },
  { symbol: "ASML",  name: "ASML ADR",          group: "semi_chain" },
  { symbol: "AVGO",  name: "Broadcom",          group: "semi_chain" },

  // benchmark (2)
  { symbol: "EWY",   name: "iShares MSCI South Korea", group: "benchmark" },
  { symbol: "^RUT",  name: "Russell 2000",             group: "benchmark" },
];

export interface KeyStockItem {
  symbol: string;
  name: string;
  group: Group;
  price: number;
  change: number;        // 등락률(%)
  changeType: "pct";
  previousClose: number;
  error?: string;
}

export interface KeyStocksResponse {
  updatedAt: string;
  description: string;
  summary: {
    total: number;
    big_tech: number;
    semi_chain: number;
    benchmark: number;
    successCount: number;
    errorCount: number;
  };
  big_tech: KeyStockItem[];
  semi_chain: KeyStockItem[];
  benchmark: KeyStockItem[];
  values: KeyStockItem[];
}

export async function GET() {
  console.log(`[key-stocks] 통합 호출 시작 (총 ${KEY_STOCKS.length}개)`);
  const startedAt = Date.now();

  const items: KeyStockItem[] = await Promise.all(
    KEY_STOCKS.map(async ({ symbol, name, group }): Promise<KeyStockItem> => {
      try {
        const q = await fetchQuote(symbol);
        return {
          symbol,
          name,
          group,
          price: q.price,
          change: q.changePercent,
          changeType: "pct",
          previousClose: q.previousClose,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "조회 실패";
        console.error(`[key-stocks] ${symbol} 호출 실패: ${message}`);
        return {
          symbol,
          name,
          group,
          price: 0,
          change: 0,
          changeType: "pct",
          previousClose: 0,
          error: message,
        };
      }
    })
  );

  const big_tech   = items.filter((i) => i.group === "big_tech");
  const semi_chain = items.filter((i) => i.group === "semi_chain");
  const benchmark  = items.filter((i) => i.group === "benchmark");

  const errorCount   = items.filter((i) => i.error).length;
  const successCount = items.length - errorCount;

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[key-stocks] 통합 호출 완료 (${elapsedMs}ms, 성공 ${successCount}/${items.length}, 실패 ${errorCount})`
  );

  const body: KeyStocksResponse = {
    updatedAt: new Date().toISOString(),
    description:
      "마젤란 대시보드 핵심 종목 통합 응답 (빅테크 7 + 반도체 체인 6 + 벤치마크 2)",
    summary: {
      total: items.length,
      big_tech: big_tech.length,
      semi_chain: semi_chain.length,
      benchmark: benchmark.length,
      successCount,
      errorCount,
    },
    big_tech,
    semi_chain,
    benchmark,
    values: items,
  };

  return NextResponse.json(body);
}
