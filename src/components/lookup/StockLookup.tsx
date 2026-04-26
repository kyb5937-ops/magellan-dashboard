"use client";

import { useState } from "react";
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
