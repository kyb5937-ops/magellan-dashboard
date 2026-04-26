import { NextRequest, NextResponse } from "next/server";
import { fetchNaverNews } from "@/lib/api/naver";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const display = parseInt(
    req.nextUrl.searchParams.get("display") || "20",
    10
  );

  if (!query) {
    return NextResponse.json(
      { error: "query 파라미터가 필요합니다" },
      { status: 400 }
    );
  }

  try {
    const news = await fetchNaverNews(query, Math.min(display, 100));
    return NextResponse.json({ items: news });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "뉴스 조회 실패" },
      { status: 500 }
    );
  }
}
