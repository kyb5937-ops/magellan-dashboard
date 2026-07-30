import { NextResponse } from "next/server";
import { GET as indicatorsGET } from "@/app/api/indicators/route";
import { buildBundle, routeSource, staticJsonSource } from "@/lib/api/bundle";

// 한국장 마감 보고서용 묶음 엔드포인트.
// 매 요청마다 실행 — Vercel 캐시로 전날 데이터가 나가면 안 된다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 포함 소스:
//   indicators   — /api/indicators (KR·US 카드 전체)
//   market-flow  — public/data/market-flow.json (투자자별 수급·TOP10·업종)
//   index-kr     — public/data/index-kr.json (코스피·코스닥·국고채·원달러·거래대금·상승하락)
export async function GET() {
  const body = await buildBundle("kr", [
    ["indicators", routeSource("/api/indicators", indicatorsGET)],
    ["market-flow", staticJsonSource("market-flow.json")],
    ["index-kr", staticJsonSource("index-kr.json")],
  ]);

  // 소스가 하나 죽어도 200 유지 — 나머지는 받을 수 있어야 한다.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
