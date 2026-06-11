// Finnhub API 어댑터
// 미국 ETF/주식 실시간 시세 (무료 티어 ≈15분 지연, 60회/분)
// 문서: https://finnhub.io/docs/api/quote
//
// 요청:
//   GET https://finnhub.io/api/v1/quote?symbol=XLK&token={FINNHUB_API_KEY}
// 응답:
//   { c, d, dp, h, l, o, pc, t }
//     c  = current price
//     d  = change (절대값)
//     dp = change percent
//     pc = previous close
//
// 도입 이유: Yahoo가 SPDR 섹터 ETF의 등락률을 0.00% 로 잠그는 사고 처방.

export interface FinnhubQuote {
  symbol: string;
  value: number;          // 현재가(c)
  changePercent: number;  // 등락률(dp, %)
  previousClose: number;  // 전일 종가(pc)
}

interface FinnhubQuoteRaw {
  c?: number;
  d?: number;
  dp?: number;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
  t?: number;
}

// 60회/분 무료 한도 보호용 메모리 캐시.
// 섹터 ETF 11개를 카드 갱신마다 호출하므로 캐시 없으면 곧 막힘.
// 5분 캐시 = ETF는 15분 지연이라 충분히 신선.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: FinnhubQuote; expiresAt: number }>();

export async function fetchFinnhubQuote(symbol: string): Promise<FinnhubQuote> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FINNHUB_API_KEY 환경변수가 설정되지 않았습니다. .env.local 또는 Vercel 환경변수를 확인하세요."
    );
  }

  const sym = symbol.toUpperCase();
  const cached = cache.get(sym);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
  const res = await fetch(url, {
    // Next 캐시도 함께 — 다른 인스턴스/요청 보호
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`Finnhub 요청 실패: HTTP ${res.status}`);
  }

  const raw: FinnhubQuoteRaw = await res.json();

  // c=0 이면 심볼 무효 또는 데이터 없음 (Finnhub의 빈응답 관용 표현).
  // 폴백을 유도하기 위해 에러로 던진다.
  if (
    typeof raw.c !== "number" ||
    raw.c === 0 ||
    typeof raw.dp !== "number" ||
    typeof raw.pc !== "number"
  ) {
    throw new Error(`Finnhub ${sym}: 응답이 비정상 (c=${raw.c}, dp=${raw.dp}, pc=${raw.pc})`);
  }

  const data: FinnhubQuote = {
    symbol: sym,
    value: raw.c,
    changePercent: raw.dp,
    previousClose: raw.pc,
  };

  cache.set(sym, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
