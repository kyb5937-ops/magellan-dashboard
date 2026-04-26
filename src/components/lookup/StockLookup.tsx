"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  XAxis,
  CartesianGrid,
} from "recharts";
import type { QuoteData, ChartData } from "@/lib/api/yahoo";

type RangeKey = "1mo" | "3mo" | "6mo" | "1y" | "3y";

const RANGE_LABELS: Record<RangeKey, string> = {
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  "1y": "1Y",
  "3y": "3Y",
};

export function StockLookup() {
  // 사용자 입력값
  const [input, setInput] = useState("005930");
  // 조회 결과
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [chart, setChart] = useState<ChartData | null>(null);
  // 현재 선택된 기간
  const [range, setRange] = useState<RangeKey>("1y");
  // 로딩 / 오류 상태
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 한국 종목코드 → 한국어 회사명 매핑 (페이지 로드 시 한 번만)
  const [stockNames, setStockNames] = useState<Record<string, string>>({});

  // 매핑 데이터 로드 (페이지 진입 시 한 번)
  useEffect(() => {
    fetch("/data/stock-names.json")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setStockNames(data))
      .catch(() => setStockNames({}));
  }, []);

  // 조회 실행
  async function handleLookup(newRange?: RangeKey) {
    const targetRange = newRange || range;
    if (!input.trim()) {
      setError("종목코드를 입력해 주세요");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 서버 사이드 API 라우트 통해 데이터 요청
      const [quoteRes, chartRes] = await Promise.all([
        fetch(`/api/quote?symbol=${encodeURIComponent(input)}`),
        fetch(
          `/api/chart?symbol=${encodeURIComponent(input)}&range=${targetRange}`
        ),
      ]);

      if (!quoteRes.ok || !chartRes.ok) {
        throw new Error("데이터 조회 실패");
      }

      const quoteData = await quoteRes.json();
      const chartData = await chartRes.json();

      setQuote(quoteData);
      setChart(chartData);
      if (newRange) setRange(newRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : "조회 실패");
      setQuote(null);
      setChart(null);
    } finally {
      setLoading(false);
    }
  }

  // 기간 버튼 클릭 — 이미 조회된 종목이 있으면 차트만 재조회
  function handleRangeChange(newRange: RangeKey) {
    if (quote) handleLookup(newRange);
  }

  // 엔터키로 조회
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleLookup();
  }

  const isKRW = quote?.currency === "KRW";
  const priceFormatted = quote
    ? isKRW
      ? Math.round(quote.price).toLocaleString()
      : quote.price.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
    : "";

  const changeColor =
    quote && quote.change > 0
      ? "text-up"
      : quote && quote.change < 0
      ? "text-down"
      : "text-fg-muted";

  const changeSign =
    quote && quote.change > 0 ? "+" : quote && quote.change < 0 ? "−" : "";

  const chartData = chart
    ? chart.timestamps.map((t, i) => ({
        t,
        price: chart.prices[i],
      }))
    : [];

  // X축 ticks: 시작 ~ 끝을 5등분한 timestamp 배열
  const xTicks: number[] = [];
  if (chartData.length >= 2) {
    const first = chartData[0].t;
    const last = chartData[chartData.length - 1].t;
    const step = (last - first) / 4;
    for (let i = 0; i < 5; i++) {
      xTicks.push(Math.round(first + step * i));
    }
  }

  return (
    <section className="mb-6">
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        🔍 STOCK LOOKUP
      </div>

      <div className="bg-navy rounded-xl p-5">
        {/* 검색창 */}
        <div className="flex gap-2 mb-5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="종목코드 (예: 005930) 또는 미국 티커 (예: NVDA)"
            className="flex-1 bg-navy-darkest border border-navy-light text-fg px-3.5 py-2.5 rounded-lg text-sm placeholder:text-fg-subtle focus:outline-none focus:border-accent"
          />
          <button
            onClick={() => handleLookup()}
            disabled={loading}
            className="bg-navy-light hover:bg-opacity-80 text-fg px-5 py-2.5 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>

        {/* 오류 메시지 */}
        {error && (
          <div className="text-sm text-down mb-4 px-2">{error}</div>
        )}

        {/* 조회 결과 */}
        {quote && (
          <>
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <div className="text-xl font-medium text-fg">{quote.name}</div>
                <div className="text-[11px] text-fg-subtle mt-0.5">
                  {quote.symbol} · {quote.exchange}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-medium text-fg">
                  {isKRW ? "" : "$"}
                  {priceFormatted}
                </div>
                <div className={`text-sm mt-0.5 ${changeColor}`}>
                  {changeSign}
                  {Math.abs(quote.change).toLocaleString(undefined, {
                    minimumFractionDigits: isKRW ? 0 : 2,
                    maximumFractionDigits: isKRW ? 0 : 2,
                  })}{" "}
                  ({changeSign}
                  {Math.abs(quote.changePercent).toFixed(2)}%)
                </div>
              </div>
            </div>

            {/* 기간 버튼 */}
            <div className="flex gap-1 my-3">
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((r) => (
                <button
                  key={r}
                  onClick={() => handleRangeChange(r)}
                  className={`text-[11px] px-2.5 py-1 rounded ${
                    r === range
                      ? "bg-navy-light text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {RANGE_LABELS[r]}
                </button>
              ))}
            </div>

            {/* 차트 */}
            {chartData.length > 0 && (
              <div className="h-[200px] -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 10, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid
                      stroke="#1E3A5F"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="t"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      ticks={xTicks}
                      tickFormatter={(t: number) => {
                        const d = new Date(t * 1000);
                        const m = d.getMonth() + 1;
                        const day = d.getDate();
                        const y = d.getFullYear();

                        if (range === "1mo" || range === "3mo") {
                          return `${m}/${day}`;
                        } else if (range === "6mo" || range === "1y") {
                          return m === 1 ? `${y}` : `${m}월`;
                        } else {
                          return `${y}.${m}`;
                        }
                      }}
                      tick={{ fill: "#64748B", fontSize: 11 }}
                      axisLine={{ stroke: "#1E3A5F" }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={["dataMin", "dataMax"]}
                      orientation="right"
                      tickFormatter={(v: number) =>
                        isKRW
                          ? Math.round(v).toLocaleString()
                          : v.toLocaleString("en-US", { maximumFractionDigits: 0 })
                      }
                      tick={{ fill: "#64748B", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={isKRW ? 60 : 50}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0B1426",
                        border: "0.5px solid #1E3A5F",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelStyle={{ color: "#94A3B8" }}
                      formatter={(value: number) => [
                        isKRW
                          ? Math.round(value).toLocaleString()
                          : value.toFixed(2),
                        "종가",
                      ]}
                      labelFormatter={(t) =>
                        new Date((t as number) * 1000).toLocaleDateString("ko-KR")
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#3B82F6"
                      strokeWidth={1.8}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 시가·고가·저가·거래량 */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              <StatCell label="시가" value={formatNum(quote.dayOpen, isKRW)} />
              <StatCell label="고가" value={formatNum(quote.dayHigh, isKRW)} />
              <StatCell label="저가" value={formatNum(quote.dayLow, isKRW)} />
              <StatCell label="거래량" value={formatVolume(quote.volume)} />
            </div>

            {/* 관련 뉴스 섹션 — 한국 종목은 한국어 이름으로 검색 (매핑 활용) */}
            <NewsSection query={getNewsQuery(quote, input, stockNames)} />
          </>
        )}

        {/* 초기 안내 */}
        {!quote && !error && !loading && (
          <div className="text-sm text-fg-muted text-center py-8">
            종목코드를 입력하고 조회 버튼을 눌러 주세요
          </div>
        )}
      </div>
    </section>
  );
}

// 숫자 포맷 헬퍼
function formatNum(v: number, isKRW: boolean): string {
  if (isKRW) return Math.round(v).toLocaleString();
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString();
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-fg-subtle mb-0.5">{label}</div>
      <div className="text-[13px] text-fg">{value}</div>
    </div>
  );
}

/**
 * 뉴스 검색에 사용할 쿼리 결정
 *
 * 우선순위:
 * 1. 한국 종목 + 매핑에 있음 → 한국어 회사명 (예: "삼성전자") ★ 최선
 * 2. 한국 종목 + 매핑에 없음 → 종목코드 (예: "005930")
 * 3. 미국·기타 → 영문 회사명 (예: "Apple Inc.")
 */
function getNewsQuery(
  quote: QuoteData,
  userInput: string,
  stockNames: Record<string, string>
): string {
  const symbol = quote.symbol || "";

  // 한국 종목 판별: .KS, .KQ 끝나거나 6자리 숫자
  const isKorean =
    symbol.endsWith(".KS") ||
    symbol.endsWith(".KQ") ||
    /^\d{6}$/.test(userInput.trim());

  if (isKorean) {
    // 종목코드만 추출 (.KS, .KQ 제거)
    const code = symbol.replace(/\.KS$|\.KQ$/, "");

    // 매핑에 한국어 이름 있으면 그걸 사용
    const koreanName = stockNames[code];
    if (koreanName) return koreanName;

    // 없으면 종목코드 fallback
    return code;
  }

  // 미국 등 기타: 회사명 사용
  return quote.name || userInput;
}

// ───────────────────────────────────────────
// 관련 뉴스 섹션
// ───────────────────────────────────────────

interface NewsItem {
  title: string;
  link: string;
  originalLink: string;
  description: string;
  pubDate: string;
  publisher: string;
}

function NewsSection({ query }: { query: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 처음엔 5개만 보이고, 더보기 누르면 전체
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!query) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/news?query=${encodeURIComponent(query)}&display=20`
        );
        if (!res.ok) throw new Error("뉴스 조회 실패");
        const data = await res.json();
        if (!cancelled) {
          setNews(data.items || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "뉴스 조회 실패");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    // 종목 바뀌면 이전 요청 결과 무시
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (loading && news.length === 0) {
    return (
      <div className="mt-4 text-fg-muted text-xs text-center py-4">
        뉴스 로딩 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-4 text-down text-xs">
        뉴스 조회 오류: {error}
      </div>
    );
  }

  if (news.length === 0) {
    return null;
  }

  const visibleNews = expanded ? news : news.slice(0, 5);
  const remaining = news.length - 5;

  return (
    <div className="mt-4 bg-navy-light rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-navy flex justify-between items-center">
        <div className="text-fg text-[13px] font-medium">📰 관련 뉴스</div>
        <div className="text-fg-subtle text-[11px]">
          최신순 · {news.length}건
        </div>
      </div>

      {/* 뉴스 리스트 */}
      {visibleNews.map((item, idx) => (
        <NewsItemCard key={idx} item={item} />
      ))}

      {/* 더보기 */}
      {!expanded && remaining > 0 && (
        <div className="px-4 py-3 border-t border-navy text-center">
          <button
            onClick={() => setExpanded(true)}
            className="text-[12px] text-up hover:underline"
          >
            더 많은 뉴스 보기 ({remaining}개 더) ↓
          </button>
        </div>
      )}
    </div>
  );
}

function NewsItemCard({ item }: { item: NewsItem }) {
  // 원본 매체 URL 우선, 없으면 네이버 URL
  const url = item.originalLink || item.link;
  const timeAgo = formatTimeAgo(item.pubDate);

  return (
    <div className="px-4 py-3 border-b border-navy last:border-b-0">
      {/* 제목 + 시간 */}
      <div className="flex justify-between items-start mb-1.5 gap-3">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg text-[13px] font-medium leading-snug hover:underline flex-1"
        >
          {item.title}
        </a>
        <div className="text-fg-subtle text-[11px] whitespace-nowrap shrink-0">
          {timeAgo}
        </div>
      </div>

      {/* 발췌 */}
      <div className="text-fg-muted text-[12px] leading-relaxed mb-1.5">
        {item.description}
      </div>

      {/* 매체 + 원문 보기 */}
      <div className="flex justify-between items-center">
        <div className="text-fg-subtle text-[11px]">{item.publisher}</div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-up text-[11px] hover:underline"
        >
          원문 보기 ↗
        </a>
      </div>
    </div>
  );
}

/**
 * 발행 시간을 상대 표현으로 변환
 * - 1시간 이내: "X분 전"
 * - 24시간 이내: "X시간 전"
 * - 7일 이내: "X일 전"
 * - 그 이상: "MM/DD"
 */
function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;

  // 7일 넘으면 날짜 표시
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
