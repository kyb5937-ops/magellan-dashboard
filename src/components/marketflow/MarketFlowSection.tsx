"use client";

import { useEffect, useState } from "react";

// 스크립트가 만들어주는 JSON 형식
interface InvestorFlow {
  sell: number;
  buy: number;
  net: number;
}

// 종목별 TOP10 항목
interface TopStock {
  code: string;       // 종목코드 (예: "005930")
  name: string;       // 종목명 (예: "삼성전자")
  change_pct: number; // 등락률 (%)
  amount: number;     // 순매수 금액 (억원, 음수면 순매도)
}

interface TopByInvestor {
  buy: TopStock[];   // 순매수 TOP10
  sell: TopStock[];  // 순매도 TOP10
}

interface TopByMarket {
  외국인: TopByInvestor;
  기관: TopByInvestor;
  개인: TopByInvestor;
}

interface MarketFlowData {
  date: string;
  unit: string;
  kospi: Record<string, InvestorFlow>;
  kosdaq: Record<string, InvestorFlow>;
  top?: {
    kospi: TopByMarket;
    kosdaq: TopByMarket;
  };
  sectors?: {
    kospi: SectorChange[];
    kosdaq: SectorChange[];
  };
}

// 업종별 등락률
interface SectorChange {
  code: string;       // "1005"
  name: string;       // "음식료·담배"
  change_pct: number; // 등락률 (%)
}

// 핵심 3주체 (이 순서대로 표시)
const KEY_INVESTORS = ["외국인", "기관합계", "개인"] as const;
type Investor = typeof KEY_INVESTORS[number];

// 화면 표시명 (기관합계 → 기관계로 짧게)
const INVESTOR_LABEL: Record<Investor, string> = {
  외국인: "외국인",
  기관합계: "기관계",
  개인: "개인",
};

// 11개 주체 전체 (펼치기 시 표시) — KRX 컬럼명 기준
const ALL_INVESTORS = [
  "외국인",
  "기관합계",
  "금융투자",
  "투신",
  "연기금",
  "사모",
  "보험",
  "은행",
  "기타금융",
  "기타법인",
  "개인",
];

// YYYYMMDD → YYYY-MM-DD
function formatDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// 숫자 → "+1,140" 또는 "-4,473" 형식 (억원, 천 단위 콤마)
function formatNet(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "" : "";
  return `${sign}${rounded.toLocaleString()}`;
}

export function MarketFlowSection() {
  const [data, setData] = useState<MarketFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/data/market-flow.json")
      .then((res) => {
        if (!res.ok) throw new Error("수급 데이터를 불러올 수 없습니다");
        return res.json();
      })
      .then((json: MarketFlowData) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="mb-6">
        <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
          💹 MARKET FLOW
        </div>
        <div className="bg-navy rounded-xl p-5 text-fg-muted text-sm">
          로딩 중...
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="mb-6">
        <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
          💹 MARKET FLOW
        </div>
        <div className="bg-navy rounded-xl p-5 text-fg-muted text-sm">
          수급 데이터 없음 — 스크립트로 업데이트가 필요합니다
        </div>
      </section>
    );
  }

  // 표시할 주체 목록 (펼침 여부에 따라)
  const investors = expanded ? ALL_INVESTORS : KEY_INVESTORS;

  return (
    <section className="mb-6">
      {/* 라벨 (날짜·단위는 표 안으로 이동) */}
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        💹 MARKET FLOW
      </div>

      <div className="bg-navy rounded-xl p-5 overflow-x-auto">
        {/* 표 */}
        <table className="w-full text-sm">
          <thead>
            {/* 1행: (날짜·단위) | 코스피 | 코스닥 */}
            <tr className="text-fg-muted text-xs">
              <th className="pb-1 font-normal w-20 text-left text-fg-subtle">
                {formatDate(data.date)}
                <br />
                단위: {data.unit}
              </th>
              <th
                className="text-center pb-1 font-normal border-b border-l border-navy-light"
                colSpan={2}
              >
                코스피
              </th>
              <th
                className="text-center pb-1 font-normal border-b border-l border-navy-light"
                colSpan={2}
              >
                코스닥
              </th>
            </tr>
            {/* 2행: 구분 + 순매수/매수매도 */}
            <tr className="text-fg-muted text-xs border-b border-navy-light">
              <th className="text-left pb-2 pt-1 font-normal">구분</th>
              <th className="text-center pb-2 pt-1 pr-3 pl-3 font-normal border-l border-navy-light">
                순매수
              </th>
              <th className="text-center pb-2 pt-1 font-normal">매수/매도</th>
              <th className="text-center pb-2 pt-1 pr-3 pl-3 font-normal border-l border-navy-light">
                순매수
              </th>
              <th className="text-center pb-2 pt-1 font-normal">매수/매도</th>
            </tr>
          </thead>
          <tbody>
            {investors.map((inv) => {
              const k = data.kospi[inv];
              const q = data.kosdaq[inv];
              if (!k || !q) return null;

              // 핵심 3주체는 배경색으로 강조
              const isKey = (KEY_INVESTORS as readonly string[]).includes(inv);
              const rowBg = isKey ? "bg-navy-light/40" : "";
              const textSize = isKey ? "text-sm" : "text-xs";

              return (
                <tr
                  key={inv}
                  className={`border-b border-navy-darkest ${rowBg}`}
                >
                  <td className={`py-2 pl-2 text-fg ${textSize}`}>
                    {(INVESTOR_LABEL as Record<string, string>)[inv] || inv}
                  </td>
                  {/* 코스피 순매수 (왼쪽 세로선) */}
                  <td
                    className={`text-center py-2 pr-3 pl-3 font-medium border-l border-navy-light ${textSize} ${
                      k.net > 0 ? "text-up" : k.net < 0 ? "text-down" : "text-fg-muted"
                    }`}
                  >
                    {formatNet(k.net)}
                  </td>
                  {/* 코스피 매수/매도 */}
                  <td
                    className={`text-center py-2 text-fg-muted ${
                      isKey ? "text-xs" : "text-[10px]"
                    }`}
                  >
                    {Math.round(k.buy).toLocaleString()} /{" "}
                    {Math.round(k.sell).toLocaleString()}
                  </td>
                  {/* 코스닥 순매수 (왼쪽 세로선) */}
                  <td
                    className={`text-center py-2 pr-3 pl-3 font-medium border-l border-navy-light ${textSize} ${
                      q.net > 0 ? "text-up" : q.net < 0 ? "text-down" : "text-fg-muted"
                    }`}
                  >
                    {formatNet(q.net)}
                  </td>
                  {/* 코스닥 매수/매도 */}
                  <td
                    className={`text-center py-2 text-fg-muted ${
                      isKey ? "text-xs" : "text-[10px]"
                    }`}
                  >
                    {Math.round(q.buy).toLocaleString()} /{" "}
                    {Math.round(q.sell).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 펼치기/접기 토글 */}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 text-xs text-fg-muted hover:text-fg transition-colors"
        >
          {expanded ? "▲ 핵심 3주체만 보기" : "▼ 기관 내역 자세히 보기 (11개)"}
        </button>
      </div>

      {/* 종목별 TOP10 (외국인/기관/개인 × 순매수/순매도) */}
      {data.top && <TopStocksSection top={data.top} />}

      {/* 업종별 등락률 (상위 5 + 하위 5) */}
      {data.sectors && <SectorSection sectors={data.sectors} />}
    </section>
  );
}

// ───────────────────────────────────────────
// TOP10 종목 섹션 (KOSPI/KOSDAQ 탭 전환)
// ───────────────────────────────────────────

interface TopStocksSectionProps {
  top: {
    kospi: TopByMarket;
    kosdaq: TopByMarket;
  };
}

function TopStocksSection({ top }: TopStocksSectionProps) {
  const [market, setMarket] = useState<"kospi" | "kosdaq">("kospi");
  const data = top[market];

  return (
    <div className="mt-6">
      {/* 라벨 + 시장 탭 */}
      <div className="flex justify-between items-center mb-2">
        <div className="text-xs font-medium text-fg-muted tracking-wider">
          🏆 TOP 10 종목
        </div>
        <div className="flex gap-1">
          {(["kospi", "kosdaq"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                market === m
                  ? "bg-navy-light text-fg"
                  : "bg-navy text-fg-muted hover:bg-navy-light hover:text-fg"
              }`}
            >
              {m === "kospi" ? "코스피" : "코스닥"}
            </button>
          ))}
        </div>
      </div>

      {/* 3주체 표 (가로 3개 그리드) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TopInvestorBox label="외국인" data={data.외국인} />
        <TopInvestorBox label="기관" data={data.기관} />
        <TopInvestorBox label="개인" data={data.개인} />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 한 주체의 순매수/순매도 TOP10 박스
// ───────────────────────────────────────────

function TopInvestorBox({
  label,
  data,
}: {
  label: string;
  data: TopByInvestor;
}) {
  return (
    <div className="bg-navy rounded-xl p-4">
      <div className="text-sm text-fg font-medium mb-3">{label}</div>

      {/* 순매수 TOP10 */}
      <div className="mb-4">
        <div className="text-[10px] text-up font-medium mb-1.5">▲ 순매수</div>
        <TopList items={data.buy} sign="up" />
      </div>

      {/* 순매도 TOP10 */}
      <div>
        <div className="text-[10px] text-down font-medium mb-1.5">▼ 순매도</div>
        <TopList items={data.sell} sign="down" />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 종목 리스트 (각 행: 순위·종목명·등락률·금액)
// ───────────────────────────────────────────

function TopList({
  items,
  sign,
}: {
  items: TopStock[];
  sign: "up" | "down";
}) {
  if (!items || items.length === 0) {
    return <div className="text-xs text-fg-subtle py-2">데이터 없음</div>;
  }

  return (
    <div className="space-y-1">
      {items.map((item, idx) => (
        <div
          key={item.code}
          className="flex items-center justify-between text-xs gap-2"
        >
          {/* 순위 + 종목명 */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-fg-subtle w-4 text-right">{idx + 1}</span>
            <span className="text-fg truncate">{item.name}</span>
          </div>

          {/* 등락률 */}
          <span
            className={`text-[10px] tabular-nums ${
              item.change_pct > 0
                ? "text-up"
                : item.change_pct < 0
                ? "text-down"
                : "text-fg-muted"
            }`}
          >
            {item.change_pct > 0 ? "+" : ""}
            {item.change_pct.toFixed(2)}%
          </span>

          {/* 금액 */}
          <span
            className={`tabular-nums font-medium w-14 text-right ${
              sign === "up" ? "text-up" : "text-down"
            }`}
          >
            {sign === "up" ? "+" : ""}
            {Math.round(item.amount).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────
// 업종별 등락률 섹션 (KOSPI/KOSDAQ 탭, 상위 5 + 하위 5)
// ───────────────────────────────────────────

interface SectorSectionProps {
  sectors: {
    kospi: SectorChange[];
    kosdaq: SectorChange[];
  };
}

function SectorSection({ sectors }: SectorSectionProps) {
  const [market, setMarket] = useState<"kospi" | "kosdaq">("kospi");
  const data = sectors[market];

  // 상위 5 (등락률 내림차순 정렬되어 있음 — 스크립트에서 처리)
  const top5 = data.slice(0, 5);
  // 하위 5 (배열 끝 5개를 다시 뒤집어서 가장 약한 것이 위로 오게)
  const bottom5 = data.slice(-5).reverse();

  return (
    <div className="mt-6">
      {/* 라벨 + 시장 탭 */}
      <div className="flex justify-between items-center mb-2">
        <div className="text-xs font-medium text-fg-muted tracking-wider">
          🏭 업종별 등락률
        </div>
        <div className="flex gap-1">
          {(["kospi", "kosdaq"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                market === m
                  ? "bg-navy-light text-fg"
                  : "bg-navy text-fg-muted hover:bg-navy-light hover:text-fg"
              }`}
            >
              {m === "kospi" ? "코스피" : "코스닥"}
            </button>
          ))}
        </div>
      </div>

      {/* 상승/하락 2개 박스 가로 배치 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 상위 5 (상승) */}
        <div className="bg-navy rounded-xl p-4">
          <div className="text-xs text-up font-medium mb-3">▲ 상승 TOP 5</div>
          <SectorList items={top5} />
        </div>

        {/* 하위 5 (하락) */}
        <div className="bg-navy rounded-xl p-4">
          <div className="text-xs text-down font-medium mb-3">▼ 하락 TOP 5</div>
          <SectorList items={bottom5} />
        </div>
      </div>
    </div>
  );
}

function SectorList({ items }: { items: SectorChange[] }) {
  if (!items || items.length === 0) {
    return <div className="text-xs text-fg-subtle py-2">데이터 없음</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div
          key={item.code}
          className="flex items-center justify-between text-sm"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-fg-subtle text-xs w-4 text-right">
              {idx + 1}
            </span>
            <span className="text-fg truncate">{item.name}</span>
          </div>
          <span
            className={`tabular-nums font-medium ${
              item.change_pct > 0
                ? "text-up"
                : item.change_pct < 0
                ? "text-down"
                : "text-fg-muted"
            }`}
          >
            {item.change_pct > 0 ? "+" : ""}
            {item.change_pct.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}
