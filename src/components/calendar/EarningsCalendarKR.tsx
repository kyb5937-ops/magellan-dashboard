"use client";

import { useEffect, useState } from "react";

/**
 * EarningsCalendarKR
 *
 * 한국 시총 100 종목의 이번 주 실적 발표 캘린더.
 * 데이터: public/data/earnings-calendar-kr.json (네이버금융 + DART)
 * 컬럼: 시점 / 종목 / 분기 / 매출 / 영업이익
 *
 * 영업이익/매출 surprise/YoY는 Step 2~4에서 채워질 데이터.
 * 값 없으면 "—" 표기.
 */

interface EarningsEvent {
  date: string;
  dayOfWeek: string;
  time: string;
  country: "KR";
  symbol: string;
  name: string;
  marketCapRank: number;
  quarter: string;
  // 매출
  revenueForecast: string | null;
  revenueActual: string | null;
  revenueSurprise: string | null;       // Step 4
  revenuePreviousYoY: string | null;    // Step 2
  // 영업이익 (Step 2~4)
  operatingIncomeForecast: string | null;
  operatingIncomeActual: string | null;
  operatingIncomeSurprise: string | null;
  operatingIncomePreviousYoY: string | null;
}

interface EarningsCalendarData {
  weekStart?: string;
  weekEnd?: string;
  lastUpdated?: string;
  events: EarningsEvent[];
}

const TIME_LABEL: Record<string, string> = {
  BMO: "장 전",
  AMC: "장 후",
};

function formatTime(time: string): string {
  return TIME_LABEL[time] || time;
}

const GRID_COLS = "grid-cols-[80px_1fr_70px_140px_140px]";

function surpriseColor(surprise: string | null): string {
  if (!surprise) return "text-fg-subtle";
  if (surprise.startsWith("-")) return "text-down";
  return "text-up";
}

function MetricCell({
  forecast,
  actual,
  surprise,
  previousYoY,
}: {
  forecast: string | null;
  actual: string | null;
  surprise: string | null;
  previousYoY: string | null;
}) {
  const reported = actual !== null;
  if (reported) {
    return (
      <div className="text-right whitespace-nowrap">
        <div className="text-fg text-[13px] flex items-baseline justify-end gap-1.5">
          <span>{actual}</span>
          {surprise && (
            <span className={`text-[11px] font-medium ${surpriseColor(surprise)}`}>
              {surprise}
            </span>
          )}
        </div>
        <div className="text-[10px] text-fg-subtle">
          예상 {forecast ?? "—"}
          {previousYoY && <> · YoY {previousYoY}</>}
        </div>
      </div>
    );
  }
  return (
    <div className="text-right whitespace-nowrap">
      <div className="text-fg-muted text-[13px] flex items-baseline justify-end gap-1.5">
        <span>{forecast ?? "—"}</span>
        {forecast && (
          <span className="text-[10px] text-fg-subtle font-normal">(E)</span>
        )}
      </div>
      {previousYoY && (
        <div className="text-[10px] text-fg-subtle">YoY {previousYoY}</div>
      )}
    </div>
  );
}

export function EarningsCalendarKR() {
  const [events, setEvents] = useState<EarningsEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/earnings-calendar-kr.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data: EarningsCalendarData) => {
        const list = [...(data.events || [])];
        list.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          const order = (t: string) => {
            const tt = formatTime(t);
            if (tt === "장 전") return 0;
            if (tt === "장 후") return 9999;
            return parseInt(tt.replace(":", "")) || 5000;
          };
          return order(a.time) - order(b.time);
        });
        setEvents(list);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const groups: { key: string; date: string; dow: string; events: EarningsEvent[] }[] = [];
  if (events) {
    const seen = new Map<string, number>();
    events.forEach((e) => {
      const key = `${e.date}|${e.dayOfWeek}`;
      if (seen.has(key)) {
        groups[seen.get(key)!].events.push(e);
      } else {
        seen.set(key, groups.length);
        groups.push({ key, date: e.date, dow: e.dayOfWeek, events: [e] });
      }
    });
  }

  const isEmpty = !loading && !error && (!events || events.length === 0);

  return (
    <section className="mb-6">
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        🇰🇷 이번 주 한국 실적 캘린더
      </div>

      <div className="bg-navy rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-[11px] text-fg-subtle border-b border-navy-light`}>
              <div>시점</div>
              <div>종목</div>
              <div>분기</div>
              <div className="text-right">매출</div>
              <div className="text-right">영업이익</div>
            </div>

            {loading && (
              <div className="px-5 py-10 text-sm text-fg-muted text-center">
                실적 캘린더 불러오는 중…
              </div>
            )}
            {error && (
              <div className="px-5 py-10 text-sm text-down text-center">
                데이터를 가져오지 못했어요. ({error})
              </div>
            )}
            {isEmpty && (
              <div className="px-5 py-12 text-center">
                <div className="text-sm text-fg-muted mb-1.5">
                  이번 주 발표 예정 종목 없음
                </div>
                <div className="text-[11px] text-fg-subtle">
                  매주 갱신 (자동)
                </div>
              </div>
            )}
            {events && events.length > 0 &&
              groups.map(({ key, date, dow, events: dayEvents }) => {
                const [, m, d] = date.split("-");
                return (
                  <div key={key}>
                    <div className="px-5 py-2 bg-navy-light text-xs font-medium text-fg-muted">
                      {dow}요일 · {parseInt(m)}월 {parseInt(d)}일
                    </div>
                    {dayEvents.map((event, idx) => {
                      const isMega = event.marketCapRank <= 10;
                      return (
                        <div
                          key={`${key}-${idx}`}
                          className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-sm items-center border-b border-navy-light/30 ${
                            isMega ? "bg-amber-950/20" : ""
                          }`}
                        >
                          <div className="text-fg-muted text-[13px] whitespace-nowrap">
                            {formatTime(event.time)}
                          </div>
                          <div className="min-w-0">
                            <div className={`truncate ${isMega ? "font-semibold text-fg" : "text-fg"}`}>
                              {event.name}
                            </div>
                            <div className="text-[11px] text-fg-subtle truncate font-mono">
                              {event.symbol} · 시총 KR #{event.marketCapRank}
                            </div>
                          </div>
                          <div className="text-fg-muted text-[13px] font-mono">
                            {event.quarter}
                          </div>
                          <MetricCell
                            forecast={event.revenueForecast}
                            actual={event.revenueActual}
                            surprise={event.revenueSurprise ?? null}
                            previousYoY={event.revenuePreviousYoY ?? null}
                          />
                          <MetricCell
                            forecast={event.operatingIncomeForecast ?? null}
                            actual={event.operatingIncomeActual ?? null}
                            surprise={event.operatingIncomeSurprise ?? null}
                            previousYoY={event.operatingIncomePreviousYoY ?? null}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </div>

        <div className="px-5 py-3 text-[11px] text-fg-subtle flex items-center justify-between flex-wrap gap-2 border-t border-navy-light">
          <div>
            시총 <span className="text-amber-400">Top 10</span> 강조 · 발표 후{" "}
            <span className="text-up">+</span>/<span className="text-down">−</span> 서프라이즈 ·
            YoY = 전년 동기
          </div>
          <div className="text-fg-subtle/70">
            출처: 네이버금융 · DART
          </div>
        </div>
      </div>
    </section>
  );
}
