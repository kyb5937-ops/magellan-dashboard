"use client";

import { useEffect, useState } from "react";
import { CardSection } from "./CardSection";
import type { IndicatorMeta } from "@/lib/data/indicators";
import type { IndicatorValue } from "@/lib/data/dummy-values";

// 창구(/api/indicators) 응답 형식
interface IndicatorsResponse {
  updatedAt: string;
  values: Array<{
    id: string;
    value: number | null;
    change: number | null;
    changeType: "pct" | "bp" | "won";
    error?: string;
  }>;
}

interface LiveCardSectionProps {
  label: string;
  indicators: IndicatorMeta[];
}

// 1분마다 자동 새로고침 (60,000 밀리초)
const REFRESH_INTERVAL = 60 * 1000;

export function LiveCardSection({ label, indicators }: LiveCardSectionProps) {
  const [values, setValues] = useState<IndicatorValue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const res = await fetch("/api/indicators");
        if (!res.ok) throw new Error("데이터 조회 실패");

        const data: IndicatorsResponse = await res.json();
        if (cancelled) return;

        // 창구 응답을 카드 컴포넌트가 기대하는 형식으로 변환
        const mapped: IndicatorValue[] = data.values
          .filter(v => v.value !== null && v.change !== null)
          .map(v => ({
            id: v.id,
            value: v.value!,
            change: v.change!,
            changeType: v.changeType,
            updatedAt: data.updatedAt,
          }));

        setValues(mapped);
      } catch (err) {
        console.error("지표 조회 실패:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // 최초 호출
    fetchData();

    // 1분마다 반복
    const interval = setInterval(fetchData, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <CardSection
      label={label}
      indicators={indicators}
      values={values}
    />
  );
}
