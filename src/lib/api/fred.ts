// FRED API 어댑터
// 미국 2Y/10Y 국채 금리 조회
// 문서: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
//
// 요청 URL 형식:
//   https://api.stlouisfed.org/fred/series/observations
//     ?series_id=DGS10
//     &api_key=KEY
//     &file_type=json
//     &sort_order=desc
//     &limit=10

export interface YieldQuote {
  symbol: string;
  value: number;        // 금리 (%)
  previousValue: number;
  changeBps: number;    // bp 단위 변동폭 (양수/음수)
  date: string;         // YYYY-MM-DD
}

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

export async function fetchFredYield(seriesId: string): Promise<YieldQuote> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FRED_API_KEY 환경변수가 설정되지 않았습니다. .env.local 을 확인하세요."
    );
  }

  // 최근 10개 관측값 내림차순으로 가져오기 (주말·공휴일 대응 위해 여유롭게)
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${apiKey}` +
    `&file_type=json` +
    `&sort_order=desc` +
    `&limit=10`;

  const res = await fetch(url, {
    // 일봉 데이터라 자주 갱신 필요 없음. 1시간 캐시.
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`FRED 요청 실패: HTTP ${res.status}`);
  }

  const json: FredResponse = await res.json();
  const obs = json.observations;

  if (!obs || obs.length < 2) {
    throw new Error(`FRED ${seriesId}: 데이터 부족`);
  }

  // FRED 는 값 없는 날을 "." 로 표시하므로 필터링
  const valid = obs
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => !isNaN(o.value));

  if (valid.length < 2) {
    throw new Error(`FRED ${seriesId}: 유효 데이터 부족`);
  }

  const latest = valid[0];
  const previous = valid[1];
  const changeBps = (latest.value - previous.value) * 100;

  return {
    symbol: seriesId,
    value: latest.value,
    previousValue: previous.value,
    changeBps,
    date: latest.date,
  };
}

// ───────────────────────────────────────────
// FRED 시계열 (차트용)
// ───────────────────────────────────────────

export interface FredSeries {
  timestamps: number[];  // unix sec
  values: number[];      // % 단위 그대로
}

/**
 * FRED 시계열 데이터를 일정 기간만큼 가져옴
 *
 * @param seriesId  FRED 시계열 ID (예: "T10Y2Y", "DGS10")
 * @param days      며칠치 받을지 (1Y = 365, 3Y = 1095 등)
 */
export async function fetchFredSeries(
  seriesId: string,
  days: number
): Promise<FredSeries> {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    throw new Error("FRED_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  // 시작일 계산 (오늘 - days)
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - days);
  const startStr = start.toISOString().slice(0, 10); // YYYY-MM-DD

  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${apiKey}` +
    `&file_type=json` +
    `&observation_start=${startStr}` +
    `&sort_order=asc`;

  const res = await fetch(url, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`FRED 시계열 요청 실패: HTTP ${res.status}`);
  }

  const json: FredResponse = await res.json();
  const obs = json.observations || [];

  // 유효 데이터만 필터링
  const valid = obs
    .map((o) => ({
      date: o.date,
      value: parseFloat(o.value),
    }))
    .filter((o) => !isNaN(o.value));

  return {
    timestamps: valid.map((o) => Math.floor(new Date(o.date).getTime() / 1000)),
    values: valid.map((o) => o.value),
  };
}
