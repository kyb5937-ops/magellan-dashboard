// 더미 데이터 — 2단계 UI 검증용
// 3단계 이후 실제 API 응답으로 교체됨. 필드 구조는 그대로 유지.
//
// change_type
//   - pct : 등락률 % (지수·주가·원자재·BTC)
//   - bp  : bp (금리)
//   - won : 원 (원/달러)

export type ChangeType = "pct" | "bp" | "won";

export interface IndicatorValue {
  id: string;
  value: number;           // 현재값 (종가 or 최신가)
  change: number;          // 전일 대비 변화량
  changeType: ChangeType;  // 변화량 단위
  updatedAt: string;       // ISO timestamp
}

export const DUMMY_VALUES: IndicatorValue[] = [
  // 🇺🇸 MARKETS
  { id: "sp500",  value: 5872.34,  change: 0.45,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "nasdaq", value: 18502.12, change: 0.62,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "dow",    value: 43210.55, change: 0.12,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "sox",    value: 5140.28,  change: 1.12,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "us2y",   value: 3.812,    change: -1.4,  changeType: "bp",  updatedAt: "2026-04-25T04:00:00Z" },
  { id: "us10y",  value: 4.235,    change: -2.1,  changeType: "bp",  updatedAt: "2026-04-25T04:00:00Z" },
  { id: "wti",    value: 78.34,    change: -1.20, changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "vix",    value: 17.42,    change: 2.10,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "dxy",    value: 104.82,   change: 0.23,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },
  { id: "btc",    value: 67420,    change: 1.43,  changeType: "pct", updatedAt: "2026-04-25T04:00:00Z" },

  // 🇰🇷 KOREA
  { id: "kospi",  value: 2612.43,  change: 0.84,  changeType: "pct", updatedAt: "2026-04-25T06:30:00Z" },
  { id: "kosdaq", value: 745.12,   change: -0.32, changeType: "pct", updatedAt: "2026-04-25T06:30:00Z" },
  { id: "usdkrw", value: 1386.5,   change: 2.30,  changeType: "won", updatedAt: "2026-04-25T06:30:00Z" },
  { id: "kr3y",   value: 3.124,    change: 1.2,   changeType: "bp",  updatedAt: "2026-04-25T06:30:00Z" },
  { id: "kr10y",  value: 3.342,    change: 0.8,   changeType: "bp",  updatedAt: "2026-04-25T06:30:00Z" },
];

export const getDummyValue = (id: string) =>
  DUMMY_VALUES.find(v => v.id === id);
