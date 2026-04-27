"use client";

import { useEffect, useState } from "react";

/**
 * EconomicCalendarSection v2.0
 *
 * 경제 캘린더 섹션 - public/data/economic-calendar.json을 fetch해서 렌더링.
 * 매주 일요일(또는 금요일 마감 후) economic-calendar.json만 갱신하면 됨.
 *
 * 디자인:
 * - 다크 톤 카드 (warm dark, #1c1815 베이스)
 * - 7컬럼 그리드: 시간(KST) · 국가 · 중요도 · 이벤트 · 실제 · 예상 · 이전
 * - 국가별 색상 라벨 (한국 핑크 / 미국 파랑 / 중국 앰버 / 일본 그린 / 유럽 보라)
 * - 중요도 ★★★ ~ ★★★★★ (앰버), ★★★★★ 행은 배경 강조
 * - 모바일에서는 가로 스크롤
 *
 * 시간 처리:
 * - 모든 시간은 KST
 * - 그룹(date 필드)은 현지 발표일 기준
 *   예: FOMC 미국 동부 4/29 14:00 발표 → 한국 4/30 03:00
 *       → date: "2026-04-29", time: "03:00", timeNote: "(목)"
 */

type Importance = 3 | 4 | 5;
type CountryCode = "KR" | "US" | "CN" | "JP" | "EU";

interface EconomicEvent {
  date: string;          // YYYY-MM-DD (그룹용, 현지 발표일 기준)
  dayOfWeek: string;     // "월" | "화" | "수" | "목" | "금"
  time: string;          // "HH:MM" (KST)
  timeNote?: string;     // "(목)" 같은 한국 요일 보조 표기 (옵션)
  country: CountryCode;
  importance: Importance;
  name: string;          // 한국어 이벤트명
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
  KR: "bg-pink-950/60 text-pink-300 border-pink-900/60",
  US: "bg-blue-950/60 text-blue-300 border-blue-900/60",
  CN: "bg-amber-950/60 text-amber-300 border-amber-900/60",
  JP: "bg-emerald-950/60 text-emerald-300 border-emerald-900/60",
  EU: "bg-violet-950/60 text-violet-300 border-violet-900/60",
};

function StarRating({ count }: { count: Importance }) {
  return (
    <span className="text-[13px] tracking-tight whitespace-nowrap">
      <span className="text-amber-400">{"★".repeat(count)}</span>
      <span className="text-zinc-700">{"★".repeat(5 - count)}</span>
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

  // 같은 (date, dow) 묶음으로 그룹핑 (events 배열 내 등장 순서 유지)
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
    <section className="my-8">
      <div className="rounded-xl border border-[#2e2a26] bg-[#1c1815] overflow-hidden">
        {/* 헤더 */}
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-xl font-bold text-zinc-100 mb-1.5 flex items-center gap-2">
            <span>📅</span>
            <span>이번 주 경제 캘린더</span>
          </h2>
          <p className="text-sm text-zinc-500">
            한국·미국·중국·일본·유럽 주요 매크로 이벤트 — 중요도 ★★★ 이상
          </p>
        </div>

        {/* 가로 스크롤 wrapper (모바일 대응) */}
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            {/* 컬럼 헤더 */}
            <div className="grid grid-cols-[80px_60px_90px_1fr_70px_70px_70px] gap-3 px-5 py-2.5 text-[11px] text-zinc-500 border-y border-[#2e2a26]">
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
              <div className="px-5 py-10 text-sm text-zinc-500 text-center">
                캘린더 불러오는 중…
              </div>
            )}
            {error && (
              <div className="px-5 py-10 text-sm text-red-400 text-center">
                데이터를 가져오지 못했어요. ({error})
              </div>
            )}
            {data &&
              groups.map(({ key, date, dow, events }) => {
                const [, m, d] = date.split("-");
                return (
                  <div key={key}>
                    {/* 요일 구분선 */}
                    <div className="px-5 py-2 bg-[#262220] text-xs font-medium text-zinc-300 border-y border-[#2e2a26]">
                      {dow}요일 · {parseInt(m)}월 {parseInt(d)}일
                    </div>
                    {/* 이벤트 행 */}
                    {events.map((event, idx) => {
                      const isMega = event.importance === 5;
                      return (
                        <div
                          key={`${key}-${idx}`}
                          className={`grid grid-cols-[80px_60px_90px_1fr_70px_70px_70px] gap-3 px-5 py-2.5 text-sm items-center border-b border-[#2a2724]/60 ${
                            isMega ? "bg-[#2a1a18]" : ""
                          }`}
                        >
                          <div className="font-mono text-zinc-400 text-[13px]">
                            {event.time}
                            {event.timeNote && (
                              <span className="text-zinc-600 ml-0.5">{event.timeNote}</span>
                            )}
                          </div>
                          <div>
                            <CountryBadge country={event.country} />
                          </div>
                          <div>
                            <StarRating count={event.importance} />
                          </div>
                          <div
                            className={
                              isMega
                                ? "font-semibold text-zinc-50"
                                : "text-zinc-200"
                            }
                          >
                            {event.name}
                          </div>
                          <div className="text-right text-zinc-500 text-[13px]">
                            {event.actual ?? "—"}
                          </div>
                          <div className="text-right text-zinc-200 text-[13px]">
                            {event.forecast ?? "—"}
                          </div>
                          <div className="text-right text-zinc-200 text-[13px]">
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
        <div className="px-5 py-3 text-[11px] text-zinc-500 flex items-center justify-between flex-wrap gap-2 border-t border-[#2e2a26]">
          <div>
            중요도 <span className="text-amber-400">★★★</span>(중간) ·{" "}
            <span className="text-amber-400">★★★★</span>(높음) ·{" "}
            <span className="text-amber-400">★★★★★</span>(최고) · 시간 KST 기준
          </div>
          <div className="text-zinc-600">
            출처: Investing.com · 한국은행 · 통계청 · BLS · BEA
          </div>
        </div>
      </div>
    </section>
  );
}
