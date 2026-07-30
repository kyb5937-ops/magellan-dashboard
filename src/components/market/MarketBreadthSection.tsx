"use client";

import { useEffect, useState } from "react";

// index-kr.json (이브닝 배치가 생성) 중 이 컴포넌트가 쓰는 부분만 정의.
// tradingValue: 코스피·코스닥 당일 거래대금(조원) + 전일 대비.
interface TradingValueMarket {
  value: number;            // 조원 (예: 38.32)
  raw: number;              // 원 단위 원본
  change_pct: number | null; // 전일 대비 %, 없으면 null
  prevRaw: number | null;
}
interface TradingValue {
  tradeDate: string;
  kospi?: TradingValueMarket;
  kosdaq?: TradingValueMarket;
}

// breadth: 상승/하락/보합 종목 수.
interface BreadthMarket {
  up: number;
  down: number;
  flat: number;
  total: number;
}
interface Breadth {
  tradeDate: string;
  kospi?: BreadthMarket;
  kosdaq?: BreadthMarket;
}

interface IndexKrData {
  tradingValue?: TradingValue;
  breadth?: Breadth;
}

export function MarketBreadthSection() {
  const [data, setData] = useState<IndexKrData | null>(null);

  useEffect(() => {
    // MarketFlowSection 과 동일하게 정적 JSON 을 클라이언트에서 fetch (라이브 API 아님).
    fetch("/data/index-kr.json", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("index-kr.json 로드 실패");
        return res.json();
      })
      .then((json: IndexKrData) => setData(json))
      // fetch/파싱 실패는 조용히 숨김 (콘솔 에러만) — 섹션 자체를 렌더하지 않음.
      .catch((err) => console.error("거래대금/상승하락 데이터 로드 실패:", err));
  }, []);

  const tv = data?.tradingValue;
  const br = data?.breadth;

  // 방어: 키가 없거나(예전 파일·배치 실패) 시장 데이터가 없으면 숨긴다.
  const hasTv = !!(tv && (tv.kospi || tv.kosdaq));
  const hasBr = !!(br && (br.kospi || br.kosdaq));

  // 둘 다 없으면 섹션 전체를 렌더하지 않음.
  if (!hasTv && !hasBr) return null;

  return (
    <section className="mb-6">
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        📊 거래대금 · 상승/하락
      </div>

      {/* (1) 거래대금 카드 2개 — kr KOREA 카드와 동일 모양 */}
      {hasTv && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          {tv?.kospi && (
            <TradingValueCard label="코스피 거래대금" m={tv.kospi} />
          )}
          {tv?.kosdaq && (
            <TradingValueCard label="코스닥 거래대금" m={tv.kosdaq} />
          )}
        </div>
      )}

      {/* (2) 상승/하락 비율 바 (코스피·코스닥 세로 배치) */}
      {hasBr && br && <BreadthCard br={br} />}
    </section>
  );
}

// ───────────────────────────────────────────
// 거래대금 카드 (IndicatorCard 와 동일한 카드 모양)
// ───────────────────────────────────────────

function TradingValueCard({ label, m }: { label: string; m: TradingValueMarket }) {
  const cp = m.change_pct;
  const changeColor =
    cp == null ? "" : cp > 0 ? "text-up" : cp < 0 ? "text-down" : "text-fg-muted";
  // format.ts 의 change 표기와 동일하게 부호 + 절댓값(음수는 U+2212).
  const changeText =
    cp == null
      ? null
      : `${cp > 0 ? "+" : cp < 0 ? "−" : ""}${Math.abs(cp).toFixed(1)}%`;

  return (
    <div className="bg-navy rounded-lg p-3">
      <div className="text-[11px] text-fg-muted mb-1.5">{label}</div>
      <div className="text-base font-medium text-fg truncate">{m.value}조원</div>
      {changeText && (
        <div className={`text-[11px] mt-0.5 ${changeColor}`}>{changeText}</div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// 상승/하락 비율 바 카드 (한 카드 안에 두 시장 세로 배치)
// ───────────────────────────────────────────

function BreadthCard({ br }: { br: Breadth }) {
  const rows: Array<{ label: string; m: BreadthMarket }> = [];
  if (br.kospi) rows.push({ label: "코스피", m: br.kospi });
  if (br.kosdaq) rows.push({ label: "코스닥", m: br.kosdaq });
  if (rows.length === 0) return null;

  return (
    <div className="bg-navy rounded-lg p-4 space-y-4">
      {rows.map(({ label, m }) => (
        <BreadthRow key={label} label={label} m={m} />
      ))}
    </div>
  );
}

function BreadthRow({ label, m }: { label: string; m: BreadthMarket }) {
  // total 이 0/누락이면 바를 그리지 않음 (0 나눗셈 방지).
  const total = m.total || m.up + m.down + m.flat;

  return (
    <div>
      {/* 시장명 + 상승/하락/보합 수치 */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-fg font-medium">{label}</span>
        <span className="text-xs tabular-nums">
          <span className="text-up">상승 {m.up.toLocaleString()}</span>
          <span className="text-fg-subtle"> · </span>
          <span className="text-down">하락 {m.down.toLocaleString()}</span>
          <span className="text-fg-subtle"> · 보합 {m.flat.toLocaleString()}</span>
        </span>
      </div>

      {/* 가로 비율 바: 상승(상승색) · 보합(중립) · 하락(하락색), 좌우 끝 라운드 */}
      {total > 0 && (
        <div className="flex h-2 w-full overflow-hidden rounded-full">
          <div className="bg-up h-full" style={{ width: `${(m.up / total) * 100}%` }} />
          <div
            className="bg-fg-subtle h-full"
            style={{ width: `${(m.flat / total) * 100}%` }}
          />
          <div
            className="bg-down h-full"
            style={{ width: `${(m.down / total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
