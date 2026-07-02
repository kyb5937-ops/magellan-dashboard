// 마젤란 대시보드 지표 정의
// 카드 15개 (US 10 + KR 5) + 딥다이브 6개 (S&P·나스닥·다우·SOX·KOSPI·KOSDAQ)
//
// dataSource
//   - yahoo     : Yahoo Finance 비공식 API (15분 지연, 무료)
//   - fred      : FRED 금리 시리즈 (DGS2/DGS10 등, bp 변동)
//   - fredIndex : FRED 가격 지수 (SP500/DJIA/NASDAQCOM, % 등락).
//                 Yahoo가 거래일 일봉을 누락해 등락률이 0.00%로 잠기는 문제 해결용.
//                 실패 시 meta.symbol(Yahoo 티커)로 폴백.
//   - ecos      : 한국은행 ECOS API (일봉, 무료, 키 필요)
//   - krxIndex  : public/data/index-kr.json (GH Actions가 KRX 공식 종가를 매일 커밋).
//                 Yahoo가 거래일을 누락해 등락률이 튀는 문제 해결용. 실패 시 Yahoo 폴백.
//   - krxFile   : 동일한 index-kr.json 의 kr3y/kr10y/usdkrw 당일치(이브닝 배치 기록).
//                 실패 시 국고채는 ECOS, 원/달러는 Yahoo+ECOSfx 로 폴백.
//   - usFile    : public/data/index-us.json (모닝 배치가 미국 종가를 매일 커밋).
//                 S&P·나스닥·다우·SOX 지수와 미2Y·미10Y 금리. 실패 시
//                 지수는 FRED(→Yahoo), SOX는 Yahoo, 금리는 FRED 로 폴백.
//
// valueType
//   - price   : 종가 (등락률 %로 표시)
//   - yield   : 금리 % (변동폭 bp로 표시)
//   - fx      : 환율 (변동폭 원)

export type DataSource = "yahoo" | "fred" | "fredIndex" | "ecos" | "krxIndex" | "krxFile" | "usFile";
export type ValueType = "price" | "yield" | "fx";
export type Region = "US" | "KR";

export interface IndicatorMeta {
  id: string;
  name: string;
  region: Region;
  dataSource: DataSource;
  symbol: string;       // 기본 티커 — yahoo/fred/ecos/krxIndex 는 곧 1차 소스 ID,
                        // fredIndex 는 Yahoo 폴백용 티커(예: ^GSPC)
  valueType: ValueType;
  decimals: number;     // 표시 소수점 자릿수
  deepDive: boolean;    // 딥다이브 상세 섹션에 포함 여부
  // fredIndex 카드만 사용 — FRED 가격 시리즈 ID(SP500/DJIA/NASDAQCOM)
  fredSymbol?: string;
}

export const INDICATORS: IndicatorMeta[] = [
  // ===== 🇺🇸 MARKETS (10개) =====
  { id: "sp500",   name: "S&P 500",       region: "US", dataSource: "usFile", symbol: "^GSPC", fredSymbol: "SP500",     valueType: "price", decimals: 2, deepDive: true  },
  { id: "nasdaq",  name: "NASDAQ",        region: "US", dataSource: "usFile", symbol: "^IXIC", fredSymbol: "NASDAQCOM", valueType: "price", decimals: 2, deepDive: true  },
  { id: "dow",     name: "Dow Jones",     region: "US", dataSource: "usFile", symbol: "^DJI",  fredSymbol: "DJIA",      valueType: "price", decimals: 2, deepDive: true  },
  { id: "sox",     name: "SOX 반도체",    region: "US", dataSource: "usFile", symbol: "^SOX",   valueType: "price", decimals: 2, deepDive: true  },
  { id: "btc",     name: "비트코인",      region: "US", dataSource: "yahoo", symbol: "BTC-USD", valueType: "price", decimals: 0, deepDive: false },
  { id: "us2y",    name: "미 2Y",         region: "US", dataSource: "usFile", symbol: "DGS2",   valueType: "yield", decimals: 3, deepDive: false },
  { id: "us10y",   name: "미 10Y",        region: "US", dataSource: "usFile", symbol: "DGS10",  valueType: "yield", decimals: 3, deepDive: false },
  { id: "wti",     name: "WTI",           region: "US", dataSource: "yahoo", symbol: "CL=F",   valueType: "price", decimals: 2, deepDive: false },
  { id: "vix",     name: "VIX",           region: "US", dataSource: "yahoo", symbol: "^VIX",   valueType: "price", decimals: 2, deepDive: false },
  { id: "dxy",     name: "달러인덱스",    region: "US", dataSource: "yahoo", symbol: "DX-Y.NYB", valueType: "price", decimals: 2, deepDive: false },

  // ===== 🇰🇷 KOREA (5개) =====
  { id: "kospi",   name: "코스피",        region: "KR", dataSource: "krxIndex", symbol: "^KS11",  valueType: "price", decimals: 2, deepDive: true  },
  { id: "kosdaq",  name: "코스닥",        region: "KR", dataSource: "krxIndex", symbol: "^KQ11",  valueType: "price", decimals: 2, deepDive: true  },
  { id: "usdkrw",  name: "원/달러",       region: "KR", dataSource: "krxFile", symbol: "KRW=X",  valueType: "fx",    decimals: 1, deepDive: false },
  { id: "kr3y",    name: "국고채 3Y",     region: "KR", dataSource: "krxFile", symbol: "010200000", valueType: "yield", decimals: 3, deepDive: false },
  { id: "kr10y",   name: "국고채 10Y",    region: "KR", dataSource: "krxFile", symbol: "010210000", valueType: "yield", decimals: 3, deepDive: false },
];

// 편의 헬퍼
export const US_INDICATORS = INDICATORS.filter(i => i.region === "US");
export const KR_INDICATORS = INDICATORS.filter(i => i.region === "KR");
export const DEEP_DIVE_INDICATORS = INDICATORS.filter(i => i.deepDive);
export const getIndicator = (id: string) => INDICATORS.find(i => i.id === id);
