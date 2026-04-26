// 마젤란 대시보드 지표 정의
// 카드 15개 (US 10 + KR 5) + 딥다이브 6개 (S&P·나스닥·다우·SOX·KOSPI·KOSDAQ)
//
// dataSource
//   - yahoo  : Yahoo Finance 비공식 API (15분 지연, 무료)
//   - fred   : FRED API (일봉, 무료, 키 필요)
//   - ecos   : 한국은행 ECOS API (일봉, 무료, 키 필요)
//
// valueType
//   - price   : 종가 (등락률 %로 표시)
//   - yield   : 금리 % (변동폭 bp로 표시)
//   - fx      : 환율 (변동폭 원)

export type DataSource = "yahoo" | "fred" | "ecos";
export type ValueType = "price" | "yield" | "fx";
export type Region = "US" | "KR";

export interface IndicatorMeta {
  id: string;
  name: string;
  region: Region;
  dataSource: DataSource;
  symbol: string;       // Yahoo 티커, FRED 시리즈 ID, ECOS 코드
  valueType: ValueType;
  decimals: number;     // 표시 소수점 자릿수
  deepDive: boolean;    // 딥다이브 상세 섹션에 포함 여부
}

export const INDICATORS: IndicatorMeta[] = [
  // ===== 🇺🇸 MARKETS (10개) =====
  { id: "sp500",   name: "S&P 500",       region: "US", dataSource: "yahoo", symbol: "^GSPC",  valueType: "price", decimals: 2, deepDive: true  },
  { id: "nasdaq",  name: "NASDAQ",        region: "US", dataSource: "yahoo", symbol: "^IXIC",  valueType: "price", decimals: 2, deepDive: true  },
  { id: "dow",     name: "Dow Jones",     region: "US", dataSource: "yahoo", symbol: "^DJI",   valueType: "price", decimals: 2, deepDive: true  },
  { id: "sox",     name: "SOX 반도체",    region: "US", dataSource: "yahoo", symbol: "^SOX",   valueType: "price", decimals: 2, deepDive: true  },
  { id: "btc",     name: "비트코인",      region: "US", dataSource: "yahoo", symbol: "BTC-USD", valueType: "price", decimals: 0, deepDive: false },
  { id: "us2y",    name: "미 2Y",         region: "US", dataSource: "fred",  symbol: "DGS2",   valueType: "yield", decimals: 3, deepDive: false },
  { id: "us10y",   name: "미 10Y",        region: "US", dataSource: "fred",  symbol: "DGS10",  valueType: "yield", decimals: 3, deepDive: false },
  { id: "wti",     name: "WTI",           region: "US", dataSource: "yahoo", symbol: "CL=F",   valueType: "price", decimals: 2, deepDive: false },
  { id: "vix",     name: "VIX",           region: "US", dataSource: "yahoo", symbol: "^VIX",   valueType: "price", decimals: 2, deepDive: false },
  { id: "dxy",     name: "달러인덱스",    region: "US", dataSource: "yahoo", symbol: "DX-Y.NYB", valueType: "price", decimals: 2, deepDive: false },

  // ===== 🇰🇷 KOREA (5개) =====
  { id: "kospi",   name: "코스피",        region: "KR", dataSource: "yahoo", symbol: "^KS11",  valueType: "price", decimals: 2, deepDive: true  },
  { id: "kosdaq",  name: "코스닥",        region: "KR", dataSource: "yahoo", symbol: "^KQ11",  valueType: "price", decimals: 2, deepDive: true  },
  { id: "usdkrw",  name: "원/달러",       region: "KR", dataSource: "yahoo", symbol: "KRW=X",  valueType: "fx",    decimals: 1, deepDive: false },
  { id: "kr3y",    name: "국고채 3Y",     region: "KR", dataSource: "ecos",  symbol: "010200000", valueType: "yield", decimals: 3, deepDive: false },
  { id: "kr10y",   name: "국고채 10Y",    region: "KR", dataSource: "ecos",  symbol: "010210000", valueType: "yield", decimals: 3, deepDive: false },
];

// 편의 헬퍼
export const US_INDICATORS = INDICATORS.filter(i => i.region === "US");
export const KR_INDICATORS = INDICATORS.filter(i => i.region === "KR");
export const DEEP_DIVE_INDICATORS = INDICATORS.filter(i => i.deepDive);
export const getIndicator = (id: string) => INDICATORS.find(i => i.id === id);
