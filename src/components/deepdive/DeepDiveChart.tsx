"use client";

import { useEffect, useState } from "react";
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

interface DeepDiveChartProps {
  symbol: string;       // 야후 티커 (예: ^GSPC)
  displayName: string;  // 화면 표시명 (예: S&P 500)
}

export function DeepDiveChart({ symbol, displayName }: DeepDiveChartProps) {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [range, setRange] = useState<RangeKey>("1y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 데이터 조회 (마운트 시 + range 변경 시)
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [quoteRes, chartRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
          fetch(
            `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`
          ),
        ]);

        if (!quoteRes.ok) throw new Error(`Quote 실패: ${quoteRes.status}`);
        if (!chartRes.ok) throw new Error(`Chart 실패: ${chartRes.status}`);

        const quoteData: QuoteData = await quoteRes.json();
        const chartData: ChartData = await chartRes.json();

        if (cancelled) return;
        setQuote(quoteData);
        setChart(chartData);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "조회 실패");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  // 차트 데이터 가공
  const chartData = chart
    ? chart.timestamps.map((t, i) => ({
        t,
        price: chart.prices[i],
      }))
    : [];

  // X축 ticks: 데이터의 시작 ~ 끝을 5등분한 timestamp 배열
  // (균등한 간격으로 5개 라벨)
  const xTicks: number[] = [];
  if (chartData.length >= 2) {
    const first = chartData[0].t;
    const last = chartData[chartData.length - 1].t;
    const step = (last - first) / 4; // 5개 점 = 4개 구간
    for (let i = 0; i < 5; i++) {
      xTicks.push(Math.round(first + step * i));
    }
  }

  const isUp = quote ? quote.changePercent >= 0 : true;

  return (
    <div className="bg-navy rounded-xl p-5">
      {loading && !quote && (
        <div className="text-fg-muted text-sm py-12 text-center">
          데이터 로딩 중...
        </div>
      )}

      {error && (
        <div className="text-down text-sm py-4">
          오류: {error}
        </div>
      )}

      {quote && (
        <>
          {/* 헤더: 이름 + 현재가 */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-fg text-lg font-medium">{displayName}</div>
              <div className="text-fg-subtle text-xs mt-0.5">{symbol}</div>
            </div>
            <div className="text-right">
              <div className="text-fg text-2xl font-light">
                {quote.price.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className={`text-sm mt-0.5 ${isUp ? "text-up" : "text-down"}`}>
                {isUp ? "+" : ""}
                {quote.change.toFixed(2)}{" "}
                ({isUp ? "+" : ""}
                {quote.changePercent.toFixed(2)}%)
              </div>
            </div>
          </div>

          {/* 기간 선택 버튼 */}
          <div className="flex gap-1.5 mb-4">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map(key => (
              <button
                key={key}
                onClick={() => setRange(key)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  range === key
                    ? "bg-navy-light text-fg"
                    : "bg-navy-darkest text-fg-muted hover:bg-navy-light hover:text-fg"
                }`}
              >
                {RANGE_LABELS[key]}
              </button>
            ))}
          </div>

          {/* 차트 */}
          {chart && chartData.length > 0 ? (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 5, right: 10, left: 20, bottom: 5 }}
                >
                  {/* 가로 격자선만 (vertical=false 로 세로 격자 없앰) */}
                  <CartesianGrid
                    stroke="#1E3A5F"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  {/* X축 — 균등 간격 5개 라벨 */}
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
                        // M/D 형식
                        return `${m}/${day}`;
                      } else if (range === "6mo" || range === "1y") {
                        // 월 단위
                        return m === 1 ? `${y}` : `${m}월`;
                      } else {
                        // 3Y: 연.월
                        return `${y}.${m}`;
                      }
                    }}
                    tick={{ fill: "#64748B", fontSize: 11 }}
                    axisLine={{ stroke: "#1E3A5F" }}
                    tickLine={false}
                  />
                  {/* Y축 — 오른쪽에 가격 라벨 (값 크기에 따라 소수점 자동 조정) */}
                  <YAxis
                    domain={["dataMin", "dataMax"]}
                    orientation="right"
                    tickFormatter={(v: number) => {
                      // 절댓값 기준으로 자릿수 결정
                      const abs = Math.abs(v);
                      const digits = abs < 10 ? 2 : abs < 100 ? 1 : 0;
                      return v.toLocaleString("en-US", {
                        minimumFractionDigits: digits,
                        maximumFractionDigits: digits,
                      });
                    }}
                    tick={{ fill: "#64748B", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#162849",
                      border: "1px solid #1E3A5F",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(t: number) =>
                      new Date(t * 1000).toLocaleDateString("ko-KR")
                    }
                    formatter={(v: number) => [
                      v.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                      displayName,
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke={isUp ? "#10B981" : "#EF4444"}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-fg-muted text-sm py-12 text-center">
              {loading ? "차트 로딩 중..." : "차트 데이터 없음"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
