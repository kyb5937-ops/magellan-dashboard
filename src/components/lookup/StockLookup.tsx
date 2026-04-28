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

// 자동완성 검색 인덱스 항목
type StockSuggestion = {
  ticker: string;       // 선택 시 input에 들어갈 값 (KR 6자리 코드 / US 영문 티커)
  name: string;         // 한국어 종목명
  market: string;       // KOSPI / KOSDAQ / 한국증시 / 미국증시
  rank: number | null;  // 시총 100위 안이면 rank, 밖이면 null
  region: "KR" | "US";
};

const MAX_SUGGESTIONS = 8;

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
  // 미국 티커 → 한국어 회사명 매핑
  const [usStockNames, setUsStockNames] = useState<Record<string, string>>({});
  // 자동완성용 통합 인덱스 (KR 2,770 + US 100여)
  const [searchIndex, setSearchIndex] = useState<StockSuggestion[]>([]);
  // 현재 매칭된 자동완성 결과
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  // 드롭다운 표시 여부
  const [showDropdown, setShowDropdown] = useState(false);
  // 키보드 네비게이션 선택 인덱스 (-1 = 미선택)
  const [selectedIdx, setSelectedIdx] = useState(-1);

  // 매핑 데이터 로드 + 자동완성 인덱스 구성 (페이지 진입 시 한 번)
  useEffect(() => {
    Promise.all([
      fetch("/data/stock-names.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
      fetch("/data/us-stock-names.json")
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
      fetch("/data/stock-symbols-100-kr.json")
        .then((r) => (r.ok ? r.json() : { stocks: [] }))
        .catch(() => ({ stocks: [] })),
      fetch("/data/stock-symbols-100-us.json")
        .then((r) => (r.ok ? r.json() : { stocks: [] }))
        .catch(() => ({ stocks: [] })),
    ]).then((results) => {
      const krNames = results[0] as Record<string, string>;
      const usNames = results[1] as Record<string, unknown>;
      const krTop = results[2] as {
        stocks?: { symbol: string; name: string; rank: number; market: string }[];
      };
      const usTop = results[3] as {
        stocks?: { symbol: string; name: string; rank: number }[];
      };

      // _comment, _etfs 같은 메타 필드 제거
      const usFiltered: Record<string, string> = {};
      for (const [k, v] of Object.entries(usNames)) {
        if (!k.startsWith("_") && typeof v === "string") {
          usFiltered[k] = v;
        }
      }

      setStockNames(krNames);
      setUsStockNames(usFiltered);

      // 시총 100 lookup 테이블
      const krTopMap = new Map<string, { rank: number; market: string }>();
      for (const s of krTop.stocks || []) {
        krTopMap.set(s.symbol, { rank: s.rank, market: s.market });
      }
      const usTopMap = new Map<string, number>();
      for (const s of usTop.stocks || []) {
        usTopMap.set(s.symbol, s.rank);
      }

      // 통합 인덱스 구성
      const idx: StockSuggestion[] = [];
      for (const [code, name] of Object.entries(krNames)) {
        const top = krTopMap.get(code);
        idx.push({
          ticker: code,
          name,
          market: top?.market || "한국증시",
          rank: top?.rank ?? null,
          region: "KR",
        });
      }
      for (const [ticker, name] of Object.entries(usFiltered)) {
        idx.push({
          ticker,
          name,
          market: "미국증시",
          rank: usTopMap.get(ticker) ?? null,
          region: "US",
        });
      }
      setSearchIndex(idx);
    });
  }, []);

  // 입력 변경 → 디바운스 → 자동완성 매칭
  useEffect(() => {
    const q = input.trim();
    if (!q || searchIndex.length === 0) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      setSuggestions(searchSuggestions(q, searchIndex));
      setSelectedIdx(-1);
    }, 150);
    return () => clearTimeout(t);
  }, [input, searchIndex]);

  // 조회 실행 (overrideSymbol — 자동완성에서 즉시 조회 시 사용)
  async function handleLookup(newRange?: RangeKey, overrideSymbol?: string) {
    const targetRange = newRange || range;
    const symbol = (overrideSymbol ?? input).trim();
    if (!symbol) {
      setError("종목코드를 입력해 주세요");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 서버 사이드 API 라우트 통해 데이터 요청
      const [quoteRes, chartRes] = await Promise.all([
        fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
        fetch(
          `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${targetRange}`
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

  // 자동완성 항목 선택 → 티커로 즉시 조회
  function selectSuggestion(s: StockSuggestion) {
    setInput(s.ticker);
    setShowDropdown(false);
    setSelectedIdx(-1);
    handleLookup(undefined, s.ticker);
  }

  // 키보드 처리: 드롭다운 활성 시 ↑↓ Enter ESC, 아니면 Enter로 조회
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) =>
          i <= 0 ? suggestions.length - 1 : i - 1
        );
        return;
      }
      if (e.key === "Enter") {
        if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
          e.preventDefault();
          selectSuggestion(suggestions[selectedIdx]);
          return;
        }
        // 키보드 선택 없이 Enter → 입력값 그대로 조회
        setShowDropdown(false);
        handleLookup();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
        return;
      }
    }
    if (e.key === "Enter") {
      handleLookup();
    }
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
        {/* 검색창 + 자동완성 드롭다운 */}
        <div className="flex gap-2 mb-5">
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowDropdown(true);
              }}
              onKeyDown={handleKeyDown}
              onBlur={() => setShowDropdown(false)}
              placeholder="종목명, 종목코드, 티커 (예: 삼성전자, 005930, NVDA)"
              className="w-full bg-navy-darkest border border-navy-light text-fg px-3.5 py-2.5 rounded-lg text-sm placeholder:text-fg-subtle focus:outline-none focus:border-accent"
            />
            {showDropdown && suggestions.length > 0 && (
              <ul
                className="absolute top-full left-0 right-0 mt-1 bg-navy-darkest border border-navy-light rounded-lg overflow-hidden z-20 shadow-lg max-h-80 overflow-y-auto"
                role="listbox"
              >
                {suggestions.map((s, i) => (
                  <li
                    key={`${s.region}-${s.ticker}`}
                    role="option"
                    aria-selected={i === selectedIdx}
                    // mouseDown.preventDefault — input의 onBlur보다 먼저 발생해 선택을 가로채는 걸 막음
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(s);
                    }}
                    onMouseEnter={() => setSelectedIdx(i)}
                    className={`px-3.5 py-2 text-sm cursor-pointer flex justify-between items-center gap-3 ${
                      i === selectedIdx ? "bg-navy-light" : "hover:bg-navy"
                    }`}
                  >
                    <div className="text-fg truncate">{s.name}</div>
                    <div className="text-fg-subtle text-[11px] whitespace-nowrap shrink-0">
                      {s.ticker} · {s.market}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
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

            {/* 관련 뉴스 섹션 — 한국·미국 종목은 한국어 이름으로 검색 (매핑 활용) */}
            <NewsSection
              query={getNewsQuery(quote, input, stockNames, usStockNames)}
            />
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

/**
 * 자동완성 매칭. 4그룹 정렬:
 *  1. 시총 100 + 앞부분 매칭 (rank 순)
 *  2. 시총 100 + 부분 매칭 (rank 순)
 *  3. 시총 100 밖 + 앞부분 매칭 (가나다·알파벳 순)
 *  4. 시총 100 밖 + 부분 매칭 (가나다·알파벳 순)
 * 종목명·티커 모두 매칭 대상, 대소문자 무시. 최대 8개 반환.
 */
function searchSuggestions(
  q: string,
  index: StockSuggestion[]
): StockSuggestion[] {
  const lower = q.toLowerCase();
  const g0: StockSuggestion[] = []; // top100 + startsWith
  const g1: StockSuggestion[] = []; // top100 + includes
  const g2: StockSuggestion[] = []; // rest + startsWith
  const g3: StockSuggestion[] = []; // rest + includes

  for (const e of index) {
    const nameLower = e.name.toLowerCase();
    const tickerLower = e.ticker.toLowerCase();
    const starts =
      nameLower.startsWith(lower) || tickerLower.startsWith(lower);
    const incl =
      !starts && (nameLower.includes(lower) || tickerLower.includes(lower));
    if (!starts && !incl) continue;

    if (e.rank !== null) {
      (starts ? g0 : g1).push(e);
    } else {
      (starts ? g2 : g3).push(e);
    }
  }

  g0.sort((a, b) => (a.rank as number) - (b.rank as number));
  g1.sort((a, b) => (a.rank as number) - (b.rank as number));
  g2.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  g3.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return [...g0, ...g1, ...g2, ...g3].slice(0, MAX_SUGGESTIONS);
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
 * 1. 한국 종목 + 매핑에 있음 → 한국어 회사명 (예: "삼성전자")
 * 2. 한국 종목 + 매핑에 없음 → 종목코드 (예: "005930")
 * 3. 미국 종목 + 매핑에 있음 → 한국어 회사명 (예: "엔비디아")
 * 4. 미국 종목 + 매핑에 없음 → 영문 회사명 fallback
 */
function getNewsQuery(
  quote: QuoteData,
  userInput: string,
  stockNames: Record<string, string>,
  usStockNames: Record<string, string>
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

  // 미국 종목: 매핑에 한국어 이름 있으면 사용
  // 사용자 입력값과 야후 심볼 둘 다 시도 (BRK-B vs BRK.B 같은 표기 차이 대비)
  const upperSymbol = symbol.toUpperCase();
  const upperInput = userInput.trim().toUpperCase();

  if (usStockNames[upperSymbol]) return usStockNames[upperSymbol];
  if (usStockNames[upperInput]) return usStockNames[upperInput];

  // 미국 매핑에 없으면 영문 회사명 fallback
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
