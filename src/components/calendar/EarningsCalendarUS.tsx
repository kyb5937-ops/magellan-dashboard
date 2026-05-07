"use client";

import { useEffect, useState } from "react";

/**
 * EarningsCalendarUS
 *
 * 미국 시총 100 종목의 이번 주 실적 발표 캘린더.
 * 데이터: public/data/earnings-calendar-us.json (yfinance)
 * 컬럼: 시점 / 종목 / 분기 / EPS / 매출
 */

interface EarningsEvent {
  date: string;
  dayOfWeek: string;
  time: string;
  country: "US";
  symbol: string;
  name: string;
  marketCapRank: number;
  quarter: string;
  epsForecast: string | null;
  epsActual: string | null;
  epsPreviousYoY: string | null;
  revenueForecast: string | null;
  revenueActual: string | null;
  surprise: string | null;
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

function EpsCell({ event }: { event: EarningsEvent }) {
  const reported = event.epsActual !== null;
  if (reported) {
    return (
      <div className="text-right whitespace-nowrap">
        <div className="text-fg text-[13px] flex items-baseline justify-end gap-1.5">
          <span>{event.epsActual}</span>
          {event.surprise && (
            <span className={`text-[11px] font-medium ${surpriseColor(event.surprise)}`}>
              {event.surprise}
            </span>
          )}
        </div>
        <div className="text-[10px] text-fg-subtle">
          예상 {event.epsForecast ?? "—"}
          {event.epsPreviousYoY && <> · YoY {event.epsPreviousYoY}</>}
        </div>
      </div>
    );
  }
  return (
    <div className="text-right whitespace-nowrap">
      <div className="text-fg-muted text-[13px] flex items-baseline justify-end gap-1.5">
        <span>{event.epsForecast ?? "—"}</span>
        {event.epsForecast && (
          <span className="text-[10px] text-fg-subtle font-normal">(E)</span>
        )}
      </div>
      {event.epsPreviousYoY && (
        <div className="text-[10px] text-fg-subtle">YoY {event.epsPreviousYoY}</div>
      )}
    </div>
  );
}

function RevenueCell({ event }: { event: EarningsEvent }) {
  const reported = event.revenueActual !== null;
  if (reported) {
    return (
      <div className="text-right whitespace-nowrap">
        <div className="text-fg text-[13px]">{event.revenueActual}</div>
        <div className="text-[10px] text-fg-subtle">
          예상 {event.revenueForecast ?? "—"}
        </div>
      </div>
    );
  }
  return (
    <div className="text-right whitespace-nowrap">
      <div className="text-fg-muted text-[13px] flex items-baseline justify-end gap-1.5">
        <span>{event.revenueForecast ?? "—"}</span>
        {event.revenueForecast && (
          <span className="text-[10px] text-fg-subtle font-normal">(E)</span>
        )}
      </div>
    </div>
  );
}

export function EarningsCalendarUS() {
  const [events, setEvents] = useState<EarningsEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/earnings-calendar-us.json", { cache: "no-store" })
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
        🇺🇸 이번 주 미국 실적 캘린더
      </div>

      <div className="bg-navy rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-[11px] text-fg-subtle border-b border-navy-light`}>
              <div>시점</div>
              <div>종목</div>
              <div>분기</div>
              <div className="text-right">EPS</div>
              <div className="text-right">매출</div>
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
                          className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-sm items-center border-b border-navy-light/30 border-l-4 ${
                            isMega
                              ? "bg-amber-500/10 border-l-amber-400"
                              : "border-l-transparent"
                          }`}
                        >
                          <div className="text-fg-muted text-[13px] whitespace-nowrap">
                            {formatTime(event.time)}
                          </div>
                          <div className="min-w-0">
                            <div className={`truncate ${isMega ? "font-semibold text-amber-300" : "text-fg"}`}>
                              {event.name}
                            </div>
                            <div className="text-[11px] text-fg-subtle truncate font-mono">
                              {event.symbol} · 시총 US #{event.marketCapRank}
                            </div>
                          </div>
                          <div className="text-fg-muted text-[13px] font-mono">
                            {event.quarter}
                          </div>
                          <EpsCell event={event} />
                          <RevenueCell event={event} />
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
            출처: Yahoo Finance
          </div>
        </div>
      </div>
    </section>
  );
}
