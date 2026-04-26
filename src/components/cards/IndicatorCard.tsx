import type { IndicatorMeta } from "@/lib/data/indicators";
import type { IndicatorValue } from "@/lib/data/dummy-values";
import { formatValue, formatChange, getChangeColorClass } from "@/lib/format";

interface IndicatorCardProps {
  meta: IndicatorMeta;
  value: IndicatorValue | undefined;
}

export function IndicatorCard({ meta, value }: IndicatorCardProps) {
  // 데이터 없을 때 — 값 자리를 "—"로 표시 (자산제곱과 동일 관례)
  if (!value) {
    return (
      <div className="bg-navy rounded-lg p-3">
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
    <div className="bg-navy rounded-lg p-3">
      <div className="text-[11px] text-fg-muted mb-1.5">{meta.name}</div>
      <div className="text-base font-medium text-fg">{displayText}</div>
      <div className={`text-[11px] mt-0.5 ${changeColor}`}>
        {changeText}
      </div>
    </div>
  );
}
