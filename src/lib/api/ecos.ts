// ECOS API 어댑터 (한국은행 경제통계시스템)
// 국고채 3Y / 10Y 일별 금리 조회
//
// 요청 URL 형식:
//   https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json/kr/1/10/817Y002/D/{시작일}/{종료일}/{항목코드}
//
// 통계표 817Y002: 시장금리(일별)
// 항목코드 010200000: 국고채(3년)
// 항목코드 010210000: 국고채(10년)
//
// 응답:
//   {
//     "StatisticSearch": {
//       "list_total_count": N,
//       "row": [ { TIME: "20260424", DATA_VALUE: "3.124", ... }, ... ]
//     }
//   }

import type { YieldQuote } from "./fred";

interface EcosRow {
  TIME: string;
  DATA_VALUE: string;
  ITEM_NAME1?: string;
}

interface EcosResponse {
  StatisticSearch?: {
    list_total_count?: number;
    row?: EcosRow[];
  };
  // 오류 시 다른 키로 응답이 오는 경우가 있어 대응
  RESULT?: {
    CODE: string;
    MESSAGE: string;
  };
}

export async function fetchEcosYield(itemCode: string): Promise<YieldQuote> {
  const apiKey = process.env.ECOS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ECOS_API_KEY 환경변수가 설정되지 않았습니다. .env.local 을 확인하세요."
    );
  }

  // 최근 30일 범위로 조회 (주말·공휴일 감안해 여유 있게)
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  const startDate = fmt(start);
  const endDate = fmt(today);

  const url =
    `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/50/817Y002/D/${startDate}/${endDate}/${itemCode}`;

  const res = await fetch(url, {
    // ECOS 갱신 지연으로 인한 stale 응답 차단 (4/30 사고)
    // 한국 채권시장 마감 후 ECOS 데이터 반영 시점이 불확정이라
    // 1시간 캐시는 이전 영업일 값을 잠그는 위험. no-store로 항상 최신.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ECOS 요청 실패: HTTP ${res.status}`);
  }

  const json: EcosResponse = await res.json();

  // 오류 응답 체크
  if (json.RESULT) {
    throw new Error(`ECOS 오류: ${json.RESULT.MESSAGE}`);
  }

  const rows = json.StatisticSearch?.row;
  if (!rows || rows.length < 2) {
    throw new Error(`ECOS ${itemCode}: 데이터 부족`);
  }

  // 날짜 내림차순 정렬 (ECOS는 기본적으로 오름차순이므로 뒤집기)
  const sorted = [...rows]
    .map(r => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE) }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length < 2) {
    throw new Error(`ECOS ${itemCode}: 유효 데이터 부족`);
  }

  const latest = sorted[0];
  const previous = sorted[1];
  const changeBps = (latest.value - previous.value) * 100;

  // 날짜 포맷 변환: YYYYMMDD → YYYY-MM-DD
  const dateFormatted = `${latest.date.slice(0, 4)}-${latest.date.slice(4, 6)}-${latest.date.slice(6, 8)}`;

  // ─────────────────────────────────────────────
  // 시점 검증 (4/30 사고 처방 — 2차 안전장치)
  //
  // ECOS 원본 갱신이 한국 채권시장 마감(15:30) 후 언제 반영되는지 불확정.
  // KST 17시 이후 호출인데 latest.date가 오늘이 아니면 갱신 지연 의심.
  // 휴일·주말은 false positive 회피 (KST 17시 분기 + 당일 비교).
  // ─────────────────────────────────────────────

  const nowUtc = new Date();
  const kst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  const kstY = kst.getUTCFullYear();
  const kstM = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const kstD = String(kst.getUTCDate()).padStart(2, "0");
  const todayKstYmd = `${kstY}${kstM}${kstD}`;
  const kstHour = kst.getUTCHours();

  const latestDateMs = Date.UTC(
    parseInt(latest.date.slice(0, 4)),
    parseInt(latest.date.slice(4, 6)) - 1,
    parseInt(latest.date.slice(6, 8))
  );
  const todayKstMs = Date.UTC(kstY, parseInt(kstM) - 1, parseInt(kstD));
  const dayDiff = Math.floor((todayKstMs - latestDateMs) / (1000 * 60 * 60 * 24));

  let stalenessWarning: string | undefined;
  const isAfterMarketClose = kstHour >= 17;
  const isLatestNotToday = latest.date !== todayKstYmd;

  if (dayDiff >= 1 && isAfterMarketClose && isLatestNotToday) {
    stalenessWarning =
      `ECOS 데이터 시점이 ${dayDiff}일 전입니다 (${dateFormatted}). ` +
      `KST 17시 이후인데 당일 데이터 미반영. 한국 채권시장 마감(15:30) 후 ` +
      `ECOS 갱신 지연 가능성. 외부 출처 검증 권장.`;
  } else if (dayDiff >= 5) {
    stalenessWarning =
      `ECOS 데이터 시점이 ${dayDiff}일 전입니다 (${dateFormatted}). ` +
      `갱신 지연 또는 시스템 오류 가능성.`;
  }

  return {
    symbol: itemCode,
    value: latest.value,
    previousValue: previous.value,
    changeBps,
    date: dateFormatted,
    staleness: dayDiff,
    ...(stalenessWarning && { stalenessWarning }),
  };
}

// ───────────────────────────────────────────
// ECOS 환율 (한국 외환시장 공식 매매기준율)
// ───────────────────────────────────────────
//
// 통계표 731Y001: 주요 환율 (일별)
// 항목코드 0000001: 원/미달러 매매기준율
//
// Yahoo previousClose는 OTC 24시간 시장 기준이라 한국 외환시장 공식 종가와
// 다르고, 그 결과 토스증권 등 국내 금융앱과 변동폭이 10원 이상 어긋난다.
// usdkrw 변동폭 재계산용으로 전일 매매기준율을 가져온다.

export async function fetchEcosFxRate(): Promise<{
  previousClose: number;
  date: string;
  staleness: number;
  stalenessWarning?: string;
}> {
  const apiKey = process.env.ECOS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ECOS_API_KEY 환경변수가 설정되지 않았습니다. .env.local 을 확인하세요."
    );
  }

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  const startDate = fmt(start);
  const endDate = fmt(today);

  const url =
    `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/50/731Y001/D/${startDate}/${endDate}/0000001`;

  const res = await fetch(url, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ECOS FX 요청 실패: HTTP ${res.status}`);
  }

  const json: EcosResponse = await res.json();

  if (json.RESULT) {
    throw new Error(`ECOS FX 오류: ${json.RESULT.MESSAGE}`);
  }

  const rows = json.StatisticSearch?.row;
  if (!rows || rows.length < 1) {
    throw new Error("ECOS FX (731Y001/0000001): 데이터 부족");
  }

  const sorted = [...rows]
    .map(r => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE) }))
    .filter(r => !isNaN(r.value))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length < 1) {
    throw new Error("ECOS FX (731Y001/0000001): 유효 데이터 부족");
  }

  const latest = sorted[0];
  const dateFormatted = `${latest.date.slice(0, 4)}-${latest.date.slice(4, 6)}-${latest.date.slice(6, 8)}`;

  // 시점 검증 (fetchEcosYield와 동일 패턴)
  const nowUtc = new Date();
  const kst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  const kstY = kst.getUTCFullYear();
  const kstM = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const kstD = String(kst.getUTCDate()).padStart(2, "0");
  const todayKstYmd = `${kstY}${kstM}${kstD}`;
  const kstHour = kst.getUTCHours();

  const latestDateMs = Date.UTC(
    parseInt(latest.date.slice(0, 4)),
    parseInt(latest.date.slice(4, 6)) - 1,
    parseInt(latest.date.slice(6, 8))
  );
  const todayKstMs = Date.UTC(kstY, parseInt(kstM) - 1, parseInt(kstD));
  const dayDiff = Math.floor((todayKstMs - latestDateMs) / (1000 * 60 * 60 * 24));

  let stalenessWarning: string | undefined;
  const isAfterMarketClose = kstHour >= 17;
  const isLatestNotToday = latest.date !== todayKstYmd;

  if (dayDiff >= 1 && isAfterMarketClose && isLatestNotToday) {
    stalenessWarning =
      `ECOS FX 데이터 시점이 ${dayDiff}일 전입니다 (${dateFormatted}). ` +
      `KST 17시 이후인데 당일 매매기준율 미반영. 한국 외환시장 마감 후 ` +
      `ECOS 갱신 지연 가능성.`;
  } else if (dayDiff >= 5) {
    stalenessWarning =
      `ECOS FX 데이터 시점이 ${dayDiff}일 전입니다 (${dateFormatted}). ` +
      `갱신 지연 또는 시스템 오류 가능성.`;
  }

  return {
    previousClose: latest.value,
    date: dateFormatted,
    staleness: dayDiff,
    ...(stalenessWarning && { stalenessWarning }),
  };
}

// ───────────────────────────────────────────
// ECOS 시계열 (차트용)
// ───────────────────────────────────────────

export interface EcosSeries {
  timestamps: number[];  // unix sec
  values: number[];      // % 단위
}

/**
 * ECOS 시계열 데이터를 일정 기간만큼 가져옴
 *
 * @param itemCode  ECOS 항목 코드 (예: "010200000" 국고채3Y)
 * @param days      며칠치 받을지
 */
export async function fetchEcosSeries(
  itemCode: string,
  days: number
): Promise<EcosSeries> {
  const apiKey = process.env.ECOS_API_KEY;

  if (!apiKey) {
    throw new Error("ECOS_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  const startDate = fmt(start);
  const endDate = fmt(today);

  // 최대 1095일 = 약 3년 (영업일 기준 750일 정도)
  // ECOS 한 페이지 최대 10000행 — 충분
  const url =
    `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/10000/817Y002/D/${startDate}/${endDate}/${itemCode}`;

  const res = await fetch(url, {
    // ECOS 갱신 지연으로 인한 stale 응답 차단 (4/30 사고)
    // 한국 채권시장 마감 후 ECOS 데이터 반영 시점이 불확정이라
    // 1시간 캐시는 이전 영업일 값을 잠그는 위험. no-store로 항상 최신.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ECOS 시계열 요청 실패: HTTP ${res.status}`);
  }

  const json: EcosResponse = await res.json();

  if (json.RESULT) {
    throw new Error(`ECOS 오류: ${json.RESULT.MESSAGE}`);
  }

  const rows = json.StatisticSearch?.row || [];

  // 오름차순 정렬, 유효 데이터만
  const valid = rows
    .map((r) => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE) }))
    .filter((r) => !isNaN(r.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    timestamps: valid.map((r) => {
      // YYYYMMDD → unix
      const y = parseInt(r.date.slice(0, 4));
      const m = parseInt(r.date.slice(4, 6)) - 1;
      const d = parseInt(r.date.slice(6, 8));
      return Math.floor(new Date(y, m, d).getTime() / 1000);
    }),
    values: valid.map((r) => r.value),
  };
}
