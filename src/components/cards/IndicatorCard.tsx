"use client";

import type { IndicatorMeta } from "@/lib/data/indicators";
import type { IndicatorValue } from "@/lib/data/dummy-values";
import { formatValue, formatChange, getChangeColorClass } from "@/lib/format";

interface IndicatorCardProps {
  meta: IndicatorMeta;
  value: IndicatorValue | undefined;
}

// 카드 ID → DEEP DIVE 탭 ID 매핑
// (DEEP DIVE에 1:1로 없는 카드는 가장 관련 깊은 탭으로 매핑)
const CARD_TO_DEEPDIVE_TAB: Record<string, string> = {
  sp500: "sp500",
  nasdaq: "nasdaq",
  dow: "dow",
  sox: "sox",
  btc: "btc",
  us2y: "us_spread", // 미 2Y → 미 10Y-2Y 스프레드
  us10y: "us_spread", // 미 10Y → 미 10Y-2Y 스프레드
  wti: "wti",
  vix: "vix",
  dxy: "dxy",
  kospi: "kospi",
  kosdaq: "kosdaq",
  usdkrw: "usdkrw",
  kr3y: "kr_spread", // 국고채 3Y → 국고채 10Y-3Y 스프레드
  kr10y: "kr_spread", // 국고채 10Y → 국고채 10Y-3Y 스프레드
};

export function IndicatorCard({ meta, value }: IndicatorCardProps) {
  // 클릭 시 DEEP DIVE 섹션의 해당 탭으로 이동
  const handleClick = () => {
    const tabId = CARD_TO_DEEPDIVE_TAB[meta.id];
    if (tabId) {
      window.dispatchEvent(
        new CustomEvent("selectDeepDiveTab", { detail: { tabId } })
      );
    }
  };

  const cardClassName =
    "bg-navy rounded-lg p-3 transition-colors hover:bg-navy-light cursor-pointer";

  // 데이터 없을 때 — 값 자리를 "—"로 표시 (자산제곱과 동일 관례)
  if (!value) {
    return (
      <div className={cardClassName} onClick={handleClick}>
        <div className="text-[11px] text-fg-muted mb-1.5">{meta.name}</div>
        <div className="text-base font-medium text-fg">—</div>
        <div className="text-[11px] text-fg-muted mt-0.5">로딩 중</div>
      </div>
    );
  }

  const mainText = formatValue(value.value, meta.decimals);
  const changeText = formatChange(value.change, value.changeType);
  const changeColor = getChangeColorClass(value.change, value.changeType);

  // WTI·BTC 는 $ 접두어 / 금리는 % 접미어
  const hasDollarPrefix = meta.id === "wti" || meta.id === "btc";
  const hasPercentSuffix = meta.valueType === "yield";

  // 단일 문자열로 결합 — React가 $ 를 $$ 로 이중출력하는 버그 회피
  const displayText =
    (hasDollarPrefix ? "$" : "") + mainText + (hasPercentSuffix ? "%" : "");

  return (
    <div className={cardClassName} onClick={handleClick}>
      <div className="text-[11px] text-fg-muted mb-1.5">{meta.name}</div>
      <div className="text-base font-medium text-fg">{displayText}</div>
      <div className={`text-[11px] mt-0.5 ${changeColor}`}>{changeText}</div>
    </div>
  );
}
