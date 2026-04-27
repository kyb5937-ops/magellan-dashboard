"use client";

/**
 * EconomicCalendarSection
 *
 * Investing.com 경제 캘린더 위젯 임베드.
 * - 한국(37), 미국(5), 중국(72), 일본(17), 유로존(14) 5개국 필터
 * - 중요도 ★★, ★★★ 만 표시 (importance=2,3)
 * - 카테고리: 고용/경제활동/인플레이션/신용/중앙은행/심리지수/무역수지/채권
 * - 시간대: 서울(GMT+9, code 88)
 * - 언어: 한국어 (lang 29)
 *
 * 위젯 옵션 변경하고 싶으면 아래 sslecal2.investing.com URL의 query string 수정.
 */
export function EconomicCalendarSection() {
  const widgetSrc =
    "https://sslecal2.investing.com" +
    "?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous" +
    "&category=_employment,_economicActivity,_inflation,_credit,_centralBanks,_confidenceIndex,_balance,_Bonds" +
    "&importance=2,3" +
    "&features=datepicker,timezone" +
    "&countries=37,5,72,17,14" +
    "&calType=week" +
    "&timeZone=88" +
    "&lang=29";

  return (
    <section className="my-8">
      <h2 className="text-xl font-bold mb-2">📅 이번 주 경제 캘린더</h2>
      <p className="text-sm text-gray-500 mb-3">
        한국·미국·중국·유럽·일본 주요 매크로 이벤트 (FOMC, CPI, GDP, 고용지표, 한은 금통위 등) — 중요도 ★★ 이상
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <iframe
          src={widgetSrc}
          width="100%"
          height="500"
          frameBorder="0"
          allowTransparency
          marginWidth={0}
          marginHeight={0}
          title="Economic Calendar"
        />
      </div>
      <div className="text-xs text-gray-400 mt-2 text-right">
        실시간 경제 캘린더 출처:{" "}
        <a
          href="https://kr.investing.com/economic-calendar/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          Investing.com
        </a>
      </div>
    </section>
  );
}
