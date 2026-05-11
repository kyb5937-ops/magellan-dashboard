// 야후 파이낸스에서 종목 데이터 가져오는 기능
// 비공식 엔드포인트 사용 — API 키 불필요, 무료, 15분 지연
//
// 사용자 입력 처리:
//   "005930"       → "005930.KS"  (6자리 숫자 = 한국 코스피)
//   "247540"       → "247540.KQ"  (일부 코스닥 종목)
//   "NVDA"         → "NVDA"       (영문 = 미국)
//   "005930.KS"    → "005930.KS"  (이미 접미사 있으면 그대로)

export interface QuoteData {
  symbol: string;           // 실제 야후에 요청한 티커 (예: "005930.KS")
  originalInput: string;    // 사용자가 입력한 원본 (예: "005930")
  name: string;             // 종목명
  exchange: string;         // 거래소 (KSE, KOE, NMS 등)
  currency: string;         // 통화 (KRW, USD)
  price: number;            // 현재가
  previousClose: number;    // 전일 종가
  change: number;           // 변동폭
  changePercent: number;    // 등락률 %
  dayHigh: number;          // 장중 고가
  dayLow: number;           // 장중 저가
  dayOpen: number;          // 시가
  volume: number;           // 거래량
  /**
   * 가격 데이터의 시점 (ISO 8601 UTC).
   * - 장중·프리·포스트 마켓: 야후가 알려준 regularMarketTime (실시간성 우선)
   * - 마감 상태(시장 종료 6시간 경과 후): closes 배열의 마지막 timestamp (정확성 우선)
   * 사용자/AI가 데이터 신선도를 검증할 수 있도록 노출.
   */
  dataTimestamp: string | null;
}

export interface ChartData {
  timestamps: number[];     // Unix 초 단위
  prices: number[];         // 종가 배열
}

// 사용자 입력을 야후 티커로 변환
function normalizeSymbol(input: string): string {
  const trimmed = input.trim().toUpperCase();

  // 이미 접미사가 있으면 그대로
  if (trimmed.includes(".")) return trimmed;

  // 6자리 숫자인 경우 = 한국 종목 → .KS (코스피) 접미사 기본 사용
  // (코스닥 .KQ 는 야후가 자동으로 redirect 처리하는 경우가 많음)
  if (/^\d{6}$/.test(trimmed)) {
    return `${trimmed}.KS`;
  }

  // 그 외 = 미국 티커로 가정
  return trimmed;
}

// 현재가·요약 정보 가져오기
export async function fetchQuote(input: string): Promise<QuoteData> {
  const symbol = normalizeSymbol(input);
  // range=1mo 로 넓게 가져와서 최근 거래일 여러 개를 확보 (공휴일·연휴 대응)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    // 15분 지연 데이터이므로 1분 캐시만 해도 충분
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`야후 요청 실패: ${res.status}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];

  if (!result) {
    // 한국 종목인데 .KS 에서 실패한 경우 .KQ(코스닥)로 재시도
    if (symbol.endsWith(".KS")) {
      return fetchQuote(symbol.replace(".KS", ".KQ"));
    }
    throw new Error(`종목을 찾을 수 없습니다: ${input}`);
  }

  const meta = result.meta;

  /**
   * 가격 결정 로직 — 장 상태에 따라 다른 소스 사용
   *
   * Why: 야후 chart endpoint의 meta.regularMarketPrice는 chart 부수정보라
   * stale될 수 있음. 특히 주말·연휴 동안 며칠 묵은 데이터가 나오는 사고가
   * 보고됨 (2026-05-11 AMD/TSLA 등 5/7 마감가 노출 사례). chart의 closes
   * 배열은 실제 historical 데이터라 정확하지만 장중엔 마지막이 전날 종가라
   * 실시간성 손실 위험. 따라서 시점에 따라 분기:
   *
   *   - 마감 상태 (regularMarketTime이 6시간 이상 전): closes 배열 마지막
   *     유효 값 사용 (정확성 우선, stale 방지)
   *   - 장중·프리·포스트 마켓 (6시간 이내): regularMarketPrice 사용
   *     (15분 지연 실시간성 유지)
   *
   * 6시간 기준: 일반 거래 6.5시간 + 프리/포스트 마켓 시간을 고려한 안전 마진.
   */
  const timestamps: number[] = result.timestamp ?? [];
  const closesRaw: (number | null | undefined)[] =
    result.indicators?.quote?.[0]?.close ?? [];

  const validCloses = timestamps
    .map((t, i) => ({ t, c: closesRaw[i] }))
    .filter((d): d is { t: number; c: number } =>
      d.c !== null && d.c !== undefined
    );

  // 시점 기반 마감/장중 판단
  const nowSec = Math.floor(Date.now() / 1000);
  const marketTime: number | undefined = meta.regularMarketTime;
  const SIX_HOURS_SEC = 6 * 3600;
  const isMarketClosed =
    typeof marketTime === "number" &&
    nowSec - marketTime > SIX_HOURS_SEC;

  let price: number;
  let dataTimestamp: string | null = null;

  if (isMarketClosed && validCloses.length > 0) {
    // 마감 상태: closes 배열 마지막 유효 값 사용 (정확)
    const last = validCloses[validCloses.length - 1];
    price = last.c;
    dataTimestamp = new Date(last.t * 1000).toISOString();
  } else {
    // 장중·프리·포스트 또는 closes 없음: regularMarketPrice 사용 (실시간성)
    price = meta.regularMarketPrice;
    dataTimestamp = marketTime
      ? new Date(marketTime * 1000).toISOString()
      : null;
  }

  // 전일 종가 찾기 — 2단계 전략
  //
  // 1순위: meta.previousClose (야후가 자체 계산한 진짜 전일 종가)
  //   - 야후 화면에 표시되는 등락률의 기준 값
  //   - 시계열 데이터가 일부 누락되어도 영향 적음
  //
  // 2순위: 시계열 역스캔 (meta.previousClose가 없을 때만)
  //   - timestamp 배열에서 마지막보다 앞선 값 중 가장 최근
  //
  // chartPreviousClose는 쓰지 않음. range 파라미터에 따라
  // "범위 시작점 직전값" (= 며칠 전) 이 들어오는 경우가 있어 등락률이 튐.

  let previousClose: number | undefined;

  // 1순위: meta.previousClose (야후 자체 값)
  if (
    typeof meta.previousClose === "number" &&
    meta.previousClose > 0
  ) {
    previousClose = meta.previousClose;
  }

  // 2순위: 시계열 역스캔
  if (previousClose === undefined) {
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null | undefined)[] =
      result.indicators?.quote?.[0]?.close ?? [];

    const series = timestamps
      .map((t, i) => ({ t, c: closes[i] }))
      .filter((d): d is { t: number; c: number } =>
        d.c !== null && d.c !== undefined
      );

    if (series.length >= 2) {
      const lastT = series[series.length - 1].t;
      const lastClose = series[series.length - 1].c;
      const priorDays = series.filter(d => d.t < lastT);

      if (priorDays.length > 0) {
        // 마지막 시계열 값이 "오늘 거래"인지 "어제 거래"인지 판단:
        //
        //  A. 마지막 timestamp 의 날짜 == regularMarketTime 의 날짜
        //     → 마지막 값은 오늘 종가 → priorDays 의 마지막이 전일
        //
        //  B. 마지막 timestamp 의 날짜 != regularMarketTime 의 날짜
        //     → 마지막 값이 바로 전일 종가 (지수·환율 등에서 야후가
        //       시간대 처리로 오늘 종가를 시계열에 안 넣는 케이스)
        const marketTime = meta.regularMarketTime;
        const lastDate = new Date(lastT * 1000).toISOString().slice(0, 10);
        const marketDate = marketTime
          ? new Date(marketTime * 1000).toISOString().slice(0, 10)
          : lastDate;

        previousClose =
          lastDate === marketDate
            ? priorDays[priorDays.length - 1].c  // 오늘 자리 = 오늘 종가
            : lastClose;                          // 오늘 자리 = 전일 종가
      }
    }
  }

  // 최종 fallback
  if (previousClose === undefined || previousClose <= 0) {
    previousClose = meta.chartPreviousClose ?? price;
  }

  // 이 시점에서 previousClose 는 반드시 number
  const prevCloseNum = previousClose as number;
  const change = price - prevCloseNum;
  const changePercent = (change / prevCloseNum) * 100;

  return {
    symbol,
    originalInput: input,
    name: meta.longName || meta.shortName || symbol,
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    currency: meta.currency || "USD",
    price,
    previousClose: prevCloseNum,
    change,
    changePercent,
    dayHigh: meta.regularMarketDayHigh ?? price,
    dayLow: meta.regularMarketDayLow ?? price,
    dayOpen: meta.regularMarketOpen ?? price,
    volume: meta.regularMarketVolume ?? 0,
    dataTimestamp,
  };
}

// 차트 데이터 가져오기 (기간 지정)
export async function fetchChart(
  input: string,
  range: "1mo" | "3mo" | "6mo" | "1y" | "3y"
): Promise<ChartData> {
  const symbol = normalizeSymbol(input);
  // 모든 기간에서 일봉(1d) 사용 — 가장 정확하고 보정 로직 불필요
  // 3Y 도 약 750 개 점이라 차트 성능에 무리 없음
  const interval = "1d";

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 300 }, // 차트는 5분 캐시
  });

  if (!res.ok) throw new Error(`차트 요청 실패: ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];

  if (!result) {
    if (symbol.endsWith(".KS")) {
      return fetchChart(symbol.replace(".KS", ".KQ"), range);
    }
    throw new Error(`차트 데이터 없음: ${input}`);
  }

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

  // null 값 제거 (거래 없는 날)
  const filtered = timestamps
    .map((t, i) => ({ t, p: closes[i] }))
    .filter((d) => d.p !== null && d.p !== undefined);

  return {
    timestamps: filtered.map((d) => d.t),
    prices: filtered.map((d) => d.p),
  };
}
