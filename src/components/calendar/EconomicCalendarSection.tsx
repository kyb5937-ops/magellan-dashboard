"use client";

import { useEffect, useState } from "react";

/**
 * EconomicCalendarSection v2.3
 *
 * 변경점 (vs v2.2):
 * - 우측 셀 (실제·예상·이전) 폭을 확실하게 늘림
 *   기존 [80, 60, 90, 1fr, 60, 110, 100] (우측 합 270)
 *   →     [80, 60, 90, 1fr, 70, 160, 140] (우측 합 370)
 * - min-width 720 → 800
 *
 * 이유: v2.2의 whitespace-nowrap만으로는 부족.
 *   Grid 셀 폭이 컨텐츠보다 작으면 nowrap 적용돼도 옆 셀 영역으로
 *   시각적 침범이 일어남. 컬럼 폭 자체를 충분히 키워서 근본 해결.
 *   "동결(3.50%~3.75%)" 같은 14자 텍스트도 여유 있게 한 줄에 표시.
 */

type Importance = 3 | 4 | 5;
type CountryCode = "KR" | "US" | "CN" | "JP" | "EU";

interface EconomicEvent {
  date: string;
  dayOfWeek: string;
  time: string;
  timeNote?: string;
  country: CountryCode;
  importance: Importance;
  name: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

interface CalendarData {
  weekStart: string;
  weekEnd: string;
  lastUpdated: string;
  events: EconomicEvent[];
}

const COUNTRY_LABEL: Record<CountryCode, string> = {
  KR: "한국",
  US: "미국",
  CN: "중국",
  JP: "일본",
  EU: "유럽",
};

const COUNTRY_STYLE: Record<CountryCode, string> = {
  KR: "bg-pink-950/50 text-pink-300 border-pink-900/40",
  US: "bg-blue-950/50 text-blue-300 border-blue-900/40",
  CN: "bg-amber-950/50 text-amber-300 border-amber-900/40",
  JP: "bg-emerald-950/50 text-emerald-300 border-emerald-900/40",
  EU: "bg-violet-950/50 text-violet-300 border-violet-900/40",
};

// 그리드 컬럼 정의 (헤더와 행에서 동일하게 사용)
// 우측 셀(실제·예상·이전)을 여유 있게 잡아서 긴 텍스트(예: "동결(3.50%~3.75%)")도 한 줄로 표시
const GRID_COLS =
  "grid-cols-[80px_60px_90px_1fr_70px_160px_140px]";

function StarRating({ count }: { count: Importance }) {
  return (
    <span className="text-[13px] tracking-tight whitespace-nowrap">
      <span className="text-amber-400">{"★".repeat(count)}</span>
      <span className="text-fg-subtle/40">{"★".repeat(5 - count)}</span>
    </span>
  );
}

function CountryBadge({ country }: { country: CountryCode }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${COUNTRY_STYLE[country]}`}
    >
      {COUNTRY_LABEL[country]}
    </span>
  );
}

export function EconomicCalendarSection() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/economic-calendar.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: CalendarData) => {
        setData(json);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // 같은 (date, dow) 묶음으로 그룹핑 (events 배열 등장 순서 유지)
  const groups: { key: string; date: string; dow: string; events: EconomicEvent[] }[] = [];
  if (data) {
    const seen = new Map<string, number>();
    data.events.forEach((e) => {
      const key = `${e.date}|${e.dayOfWeek}`;
      if (seen.has(key)) {
        groups[seen.get(key)!].events.push(e);
      } else {
        seen.set(key, groups.length);
        groups.push({ key, date: e.date, dow: e.dayOfWeek, events: [e] });
      }
    });
  }

  return (
    <section className="mb-6">
      {/* 섹션 라벨 - 다른 섹션(LiveCardSection, StockLookup)과 동일 */}
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        📅 이번 주 경제 캘린더
      </div>

      <div className="bg-navy rounded-xl overflow-hidden">
        {/* 가로 스크롤 wrapper (모바일 + 긴 텍스트 대응) */}
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* 컬럼 헤더 */}
            <div className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-[11px] text-fg-subtle border-b border-navy-light`}>
              <div>시간(KST)</div>
              <div>국가</div>
              <div>중요도</div>
              <div>이벤트</div>
              <div className="text-right">실제</div>
              <div className="text-right">예상</div>
              <div className="text-right">이전</div>
            </div>

            {/* 본문 */}
            {loading && (
              <div className="px-5 py-10 text-sm text-fg-muted text-center">
                캘린더 불러오는 중…
              </div>
            )}
            {error && (
              <div className="px-5 py-10 text-sm text-down text-center">
                데이터를 가져오지 못했어요. ({error})
              </div>
            )}
            {data &&
              groups.map(({ key, date, dow, events }) => {
                const [, m, d] = date.split("-");
                return (
                  <div key={key}>
                    {/* 요일 구분선 */}
                    <div className="px-5 py-2 bg-navy-light text-xs font-medium text-fg-muted">
                      {dow}요일 · {parseInt(m)}월 {parseInt(d)}일
                    </div>
                    {/* 이벤트 행 */}
                    {events.map((event, idx) => {
                      const isMega = event.importance === 5;
                      return (
                        <div
                          key={`${key}-${idx}`}
                          className={`grid ${GRID_COLS} gap-3 px-5 py-2.5 text-sm items-center border-b border-navy-light/30 ${
                            isMega ? "bg-red-950/30" : ""
                          }`}
                        >
                          <div className="font-mono text-fg-muted text-[13px] whitespace-nowrap">
                            {event.time}
                            {event.timeNote && (
                              <span className="text-fg-subtle ml-0.5">{event.timeNote}</span>
                            )}
                          </div>
                          <div>
                            <CountryBadge country={event.country} />
                          </div>
                          <div>
                            <StarRating count={event.importance} />
                          </div>
                          <div className={isMega ? "font-semibold text-fg" : "text-fg"}>
                            {event.name}
                          </div>
                          <div className="text-right text-fg-subtle text-[13px] whitespace-nowrap">
                            {event.actual ?? "—"}
                          </div>
                          <div className="text-right text-fg text-[13px] whitespace-nowrap">
                            {event.forecast ?? "—"}
                          </div>
                          <div className="text-right text-fg text-[13px] whitespace-nowrap">
                            {event.previous ?? "—"}
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
            중요도 <span className="text-amber-400">★★★</span>(중간) ·{" "}
            <span className="text-amber-400">★★★★</span>(높음) ·{" "}
            <span className="text-amber-400">★★★★★</span>(최고) · 시간 KST 기준
          </div>
          <div className="text-fg-subtle/70">
            출처: Investing.com · 한국은행 · 통계청 · BLS · BEA
          </div>
        </div>
      </div>
    </section>
  );
}
