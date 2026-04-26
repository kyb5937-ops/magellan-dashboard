// 값 포맷팅 유틸
// 카드·딥다이브·IB 관점 박스 어디서든 동일한 규칙으로 숫자 표시

import type { IndicatorMeta } from "@/lib/data/indicators";
import type { ChangeType } from "@/lib/data/dummy-values";

/**
 * 본값 포맷: 소수점 자릿수 + 천 단위 콤마
 *   5872.34 → "5,872.34"
 *   3.124   → "3.124"
 *   67420   → "67,420"
 */
export function formatValue(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 변화량 포맷: 부호 + 단위
 *   pct: +0.45% / -1.20%
 *   bp : +1.2bp / -2.1bp
 *   won: +2.3원 / -5.0원
 */
export function formatChange(change: number, changeType: ChangeType): string {
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  const abs = Math.abs(change);

  switch (changeType) {
    case "pct":
      return `${sign}${abs.toFixed(2)}%`;
    case "bp":
      return `${sign}${abs.toFixed(1)}bp`;
    case "won":
      return `${sign}${abs.toFixed(1)}원`;
  }
}

/**
 * 변화량 방향 → 색상 클래스
 *   양수: 상승(녹색 #10B981)
 *   음수: 하락(빨강 #EF4444)
 *   0 / bp: 중립(muted)
 *
 * 금리(bp)는 관례상 색 대신 muted 로 표시. 금리 상승/하락의 "좋음/나쁨"은
 * 문맥 의존적이라 녹/빨 강제 표시가 오독을 유발함.
 */
export function getChangeColorClass(
  change: number,
  changeType: ChangeType
): string {
  if (changeType === "bp") return "text-fg-muted";
  if (change > 0) return "text-up";
  if (change < 0) return "text-down";
  return "text-fg-muted";
}

/**
 * 값에 어울리는 자릿수 체크 — 디버깅용
 */
export function inspectValue(meta: IndicatorMeta, value: number): string {
  return `[${meta.id}] ${formatValue(value, meta.decimals)}`;
}
