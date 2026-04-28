"use client";

import { useEffect, useState } from "react";
import { formatValue, formatChange, getChangeColorClass } from "@/lib/format";
import type { SectorETFItem, SectorETFsResponse } from "@/app/api/sector-etfs/route";

// 1분마다 자동 새로고침 (LiveCardSection과 동일)
const REFRESH_INTERVAL = 60 * 1000;

export function SectorETFSection() {
  const [items, setItems] = useState<SectorETFItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const res = await fetch("/api/sector-etfs");
        if (!res.ok) throw new Error("섹터 ETF 조회 실패");

        const data: SectorETFsResponse = await res.json();
        if (cancelled) return;

        setItems(data.items);
      } catch (err) {
        console.error("섹터 ETF 조회 실패:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // 등락률 내림차순 정렬 (강한 섹터가 위로)
  // error 있는 항목은 정렬에서 제외하지 않고 0으로 처리됨 — 자연스럽게 중간/하단 배치
  const sorted = [...items].sort((a, b) => b.change - a.change);

  return (
    <section className="mb-6">
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        🏢 SPDR 섹터 ETF
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {loading && items.length === 0
          ? // 로딩 중: 11개 자리 placeholder
            Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="bg-navy rounded-lg p-3">
                <div className="text-base font-medium text-fg mb-1.5 truncate">
                  —<span className="text-fg-muted"> · </span>
                  <span className="text-[11px] text-fg-muted">로딩 중</span>
                </div>
                <div className="text-base font-medium text-fg-muted">—</div>
                <div className="text-[11px] text-fg-subtle mt-0.5">—</div>
              </div>
            ))
          : sorted.map((item) => <SectorCard key={item.symbol} item={item} />)}
      </div>
    </section>
  );
}

function SectorCard({ item }: { item: SectorETFItem }) {
  const changeColor = getChangeColorClass(item.change, item.changeType);

  if (item.error) {
    return (
      <div className="bg-navy rounded-lg p-3 transition-colors hover:bg-navy-light">
        <div className="text-base font-medium text-fg mb-1.5 truncate">
          {item.symbol}
          <span className="text-fg-muted"> · </span>
          <span className="text-[11px] text-fg-muted">{item.name}</span>
        </div>
        <div className="text-base font-medium text-fg-muted">—</div>
        <div className="text-[11px] text-fg-subtle mt-0.5">조회 실패</div>
      </div>
    );
  }

  return (
    <div className="bg-navy rounded-lg p-3 transition-colors hover:bg-navy-light">
      <div className="text-base font-medium text-fg mb-1.5 truncate">
        {item.symbol}
        <span className="text-fg-muted"> · </span>
        <span className="text-[11px] text-fg-muted">{item.name}</span>
      </div>
      <div className={`text-base font-medium ${changeColor}`}>
        {formatChange(item.change, item.changeType)}
      </div>
      <div className="text-[11px] text-fg-subtle mt-0.5 tabular-nums">
        ${formatValue(item.value, 2)}
      </div>
    </div>
  );
}
