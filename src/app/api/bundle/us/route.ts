import { NextResponse } from "next/server";
import { GET as indicatorsGET } from "@/app/api/indicators/route";
import { GET as sectorEtfsGET } from "@/app/api/sector-etfs/route";
import { GET as keyStocksGET } from "@/app/api/key-stocks/route";
import { buildBundle, routeSource, staticJsonSource } from "@/lib/api/bundle";

// 미국장 마감 보고서용 묶음 엔드포인트.
// 매 요청마다 실행 — Vercel 캐시로 전날 데이터가 나가면 안 된다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 포함 소스:
//   indicators   — /api/indicators (KR·US 카드 전체)
//   sector-etfs  — /api/sector-etfs (SPDR 섹터 ETF 11개)
//   index-us     — public/data/index-us.json (미국 지수·SOX·미금리)
//   key-stocks   — /api/key-stocks (빅테크 7 + 반도체 체인 6 + 벤치마크 2)
export async function GET() {
  const body = await buildBundle("us", [
    ["indicators", routeSource("/api/indicators", indicatorsGET)],
    ["sector-etfs", routeSource("/api/sector-etfs", sectorEtfsGET)],
    ["index-us", staticJsonSource("index-us.json")],
    ["key-stocks", routeSource("/api/key-stocks", keyStocksGET)],
  ]);

  // 소스가 하나 죽어도 200 유지 — 나머지는 받을 수 있어야 한다.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
