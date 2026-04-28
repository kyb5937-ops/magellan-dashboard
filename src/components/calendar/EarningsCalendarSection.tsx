"use client";

import { useEffect, useState } from "react";

/**
 * EarningsCalendarSection v1.0
 *
 * 한국·미국 시총 100 종목의 이번 주 실적 발표 캘린더.
 *
 * 데이터 소스 (Phase 1, 모두 AI 큐레이션):
 * - public/data/earnings-calendar-kr.json (한국, 매주 일요일 사용자 갱신)
 * - public/data/earnings-calendar-us.json (미국, 매주 일요일 사용자 갱신)
 *
 * Phase 2 (예정): 미국 부분만 GitHub Actions + Yahoo Finance 자동 fetch로 전환
 * → 그때도 컴포넌트 변경 불필요 (JSON 형식 동일).
 *
 * 디자인:
 * - 경제 캘린더와 동일한 카드 스타일 (bg-navy)
 * - 6컬럼: 시점 / 국가 / 종목 / 분기 / EPS 예상 / 매출 예상
 * - 시총 Top 10 종목 amber 배경 강조
 * - 빈 데이터일 때 "이번 주 발표 예정 종목 없음" placeholder
 */

type CountryCode = "KR" | "US";

interface EarningsEvent {
  date: string;          // YYYY-MM-DD (현지 발표일)
  dayOfWeek: string;     // "월" | "화" | ...
  time: string;          // "BMO" | "AMC" | "장 전" | "장 후" | "HH:MM"
  country: CountryCode;
  symbol: string;        // "AAPL" | "005930"
  name: string;          // 한국어 종목명
  marketCapRank: number; // 1~100
  quarter: string;       // "25Q1" | "24Q4"
  epsForecast: string | null;
  epsPrevious: string | null;
  revenueForecast: string | null;
}

interface EarningsCalendarData {
  weekStart?: string;
  weekEnd?: string;
  lastUpdated?: string;
  events: EarningsEvent[];
}

const COUNTRY_LABEL: Record<CountryCode, string> = {
  KR: "한국",
  US: "미국",
};

const COUNTRY_STYLE: Record<CountryCode, string> = {
  KR: "bg-pink-950/50 text-pink-300 border-pink-900/40",
  US: "bg-blue-950/50 text-blue-300 border-blue-900/40",
};

// 시점 라벨 변환: BMO/AMC → 한글
const TIME_LABEL: Record<string, string> = {
  BMO: "장 전",
  AMC: "장 후",
};

function formatTime(time: string): string {
  return TIME_LABEL[time] || time;
}

const GRID_COLS = "grid-cols-[80px_60px_1fr_70px_110px_130px]";

function CountryBadge({ country }: { country: CountryCode }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${COUNTRY_STYLE[country]}`}
    >
      {COUNTRY_LABEL[country]}
    </span>
  );
}

export function EarningsCalendarSection() {
  const [events, setEvents] = useState<EarningsEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/earnings-calendar-kr.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { events: [] }))
        .catch(() => ({ events: [] } as EarningsCalendarData)),
      fetch("/data/earnings-calendar-us.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { events: [] }))
        .catch(() => ({ events: [] } as EarningsCalendarData)),
    ])
      .then(([kr, us]: [EarningsCalendarData, EarningsCalendarData]) => {
        const merged = [...(kr.events || []), ...(us.events || [])];
        // 날짜 → 시간(BMO < AMC < HH:MM 등) 순으로 정렬
        merged.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          // 시점 순서: BMO/장 전 → HH:MM → AMC/장 후
          const order = (t: string) => {
            const tt = formatTime(t);
            if (tt === "장 전") return 0;
            if (tt === "장 후") return 9999;
            return parseInt(tt.replace(":", "")) || 5000;
          };
          return order(a.time) - order(b.time);
        });
        setEvents(merged);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // 그룹핑 (date, dayOfWeek)
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
      {/* 섹션 라벨 - 다른 섹션과 동일 */}
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        💼 이번 주 실적 캘린더
      </div>

      <div className="bg-navy rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* 컬럼 헤더 */}
            <div className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-[11px] text-fg-subtle border-b border-navy-light`}>
              <div>시점</div>
              <div>국가</div>
              <div>종목</div>
              <div>분기</div>
              <div className="text-right">EPS 예상</div>
              <div className="text-right">매출 예상</div>
            </div>

            {/* 본문 */}
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
                  매주 일요일 갱신 — 「실적 캘린더 매주 갱신 프롬프트」 참조
                </div>
              </div>
            )}
            {events && events.length > 0 &&
              groups.map(({ key, date, dow, events: dayEvents }) => {
                const [, m, d] = date.split("-");
                return (
                  <div key={key}>
                    {/* 요일 구분선 */}
                    <div className="px-5 py-2 bg-navy-light text-xs font-medium text-fg-muted">
                      {dow}요일 · {parseInt(m)}월 {parseInt(d)}일
                    </div>
                    {/* 종목 행 */}
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
                          <div>
                            <CountryBadge country={event.country} />
                          </div>
                          <div className="min-w-0">
                            <div className={`truncate ${isMega ? "font-semibold text-fg" : "text-fg"}`}>
                              {event.name}
                            </div>
                            <div className="text-[11px] text-fg-subtle truncate font-mono">
                              {event.symbol} · 시총 {event.country} #{event.marketCapRank}
                            </div>
                          </div>
                          <div className="text-fg-muted text-[13px] font-mono">
                            {event.quarter}
                          </div>
                          <div className="text-right text-fg text-[13px] whitespace-nowrap">
                            {event.epsForecast ?? "—"}
                          </div>
                          <div className="text-right text-fg text-[13px] whitespace-nowrap">
                            {event.revenueForecast ?? "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 text-[11px] text-fg-subtle flex items-center justify-between flex-wrap gap-2 border-t border-navy-light">
          <div>
            시총 <span className="text-amber-400">Top 10</span> 강조 · 시점:{" "}
            <span className="text-fg-muted">장 전</span> /{" "}
            <span className="text-fg-muted">장 후</span> (KST 기준)
          </div>
          <div className="text-fg-subtle/70">
            출처: Yahoo Finance · 네이버금융 · DART
          </div>
        </div>
      </div>
    </section>
  );
}
