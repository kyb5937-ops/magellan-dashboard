"""
미국 시총 100 종목의 다음 2주 실적 발표 일정 + 컨센서스 자동 수집

[입력]
- public/data/stock-symbols-100-us.json (universe)

[출력]
- public/data/earnings-calendar-us.json

[의존]
- yfinance, pandas

[실행]
- 로컬: python .github/scripts/fetch_earnings_us.py
- GitHub Actions: workflow에서 동일하게 호출

[필터링 범위]
- 오늘 ~ 14일 후 (이번 주 + 다음 주 일부)
- 컴포넌트가 알아서 표시함
"""

import os
import sys
import json
import time
from datetime import datetime, timedelta, date, timezone

import pandas as pd
import yfinance as yf

# Windows 콘솔(cp949)에서도 이모지/한글 출력 가능하도록 강제 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.getcwd()
UNIVERSE_PATH = os.path.join(ROOT, "public", "data", "stock-symbols-100-us.json")
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "earnings-calendar-us.json")

DAY_OF_WEEK_KR = ["월", "화", "수", "목", "금", "토", "일"]


def classify_time(ts: pd.Timestamp) -> str:
    """발표 시각 → 'BMO' (장 전) / 'AMC' (장 후) / 'HH:MM'

    yfinance earnings_dates의 인덱스 타임스탬프는 미국 동부시간(EDT/EST) 기준.
    - 9시 이전 → BMO
    - 16시 이후 → AMC
    - 그 사이 → HH:MM 표기 (드물지만 장중 발표하는 경우)
    """
    try:
        if ts.tzinfo is not None:
            ts_et = ts.tz_convert("America/New_York")
        else:
            ts_et = ts.tz_localize("America/New_York")
        hour = ts_et.hour
        if hour < 9:
            return "BMO"
        if hour >= 16:
            return "AMC"
        return f"{ts_et.hour:02d}:{ts_et.minute:02d}"
    except Exception:
        return "AMC"


def infer_quarter(announcement_date: date) -> str:
    """발표일 → 'YYQX' 형식 (해당 분기는 발표 시점 직전 분기)

    예:
    - 2026-04-25 발표 → 26Q1 (1분기 결산을 4월 말에 발표)
    - 2026-01-30 발표 → 25Q4
    - 2026-07-25 발표 → 26Q2
    """
    m = announcement_date.month
    y = announcement_date.year
    if 1 <= m <= 3:
        return f"{(y - 1) % 100:02d}Q4"
    if 4 <= m <= 6:
        return f"{y % 100:02d}Q1"
    if 7 <= m <= 9:
        return f"{y % 100:02d}Q2"
    return f"{y % 100:02d}Q3"


def format_eps(value) -> str:
    if value is None or pd.isna(value):
        return None
    try:
        return f"${float(value):.2f}"
    except (TypeError, ValueError):
        return None


def format_revenue(value) -> str:
    """매출 → '$XX.XB' 또는 '$XXM' 형식"""
    if value is None or pd.isna(value):
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v >= 1_000_000_000:
        return f"${v / 1_000_000_000:.2f}B"
    if v >= 1_000_000:
        return f"${v / 1_000_000:.0f}M"
    return f"${v:,.0f}"


def fetch_for_symbol(symbol: str, start: date, end: date):
    """단일 종목의 [start, end] 범위 내 실적 발표 정보 리스트 반환.

    범위 밖이면 빈 리스트.
    """
    try:
        ticker = yf.Ticker(symbol)
    except Exception as e:
        print(f"  ⚠️ {symbol} Ticker 생성 실패: {e}", file=sys.stderr)
        return []

    try:
        edf = ticker.earnings_dates
    except Exception as e:
        print(f"  ⚠️ {symbol} earnings_dates 조회 실패: {e}", file=sys.stderr)
        return []

    if edf is None or edf.empty:
        return []

    # 범위 필터 (인덱스가 timezone-aware Timestamp)
    try:
        mask = (edf.index.date >= start) & (edf.index.date <= end)
        edf = edf[mask]
    except Exception:
        return []

    if edf.empty:
        return []

    # 매출 컨센서스는 calendar에서 시도
    revenue_est = None
    try:
        cal = ticker.calendar
        if isinstance(cal, dict):
            revenue_est = cal.get("Revenue Average") or cal.get("Revenue Estimate Avg")
        elif cal is not None and not (hasattr(cal, "empty") and cal.empty):
            # DataFrame 형태일 경우
            for key in ("Revenue Average", "Revenue Estimate Avg", "Revenue Estimate"):
                if key in cal.index:
                    try:
                        revenue_est = cal.loc[key].iloc[0]
                        break
                    except Exception:
                        pass
    except Exception:
        revenue_est = None

    results = []
    for ts, row in edf.iterrows():
        ev_date = ts.date() if hasattr(ts, "date") else ts
        eps_est = row.get("EPS Estimate")
        eps_actual = row.get("Reported EPS")
        results.append({
            "date": ev_date.isoformat(),
            "dayOfWeek": DAY_OF_WEEK_KR[ev_date.weekday()],
            "time": classify_time(ts),
            "quarter": infer_quarter(ev_date),
            "epsForecast": format_eps(eps_est),
            "epsPrevious": format_eps(eps_actual) if eps_actual is not None and not pd.isna(eps_actual) else None,
            "revenueForecast": format_revenue(revenue_est),
        })
    return results


def main():
    today = datetime.now(timezone.utc).astimezone().date()
    start = today
    end = today + timedelta(days=14)

    print(f"▶ 미국 실적 캘린더 수집: {start} ~ {end}")

    with open(UNIVERSE_PATH, "r", encoding="utf-8") as f:
        universe = json.load(f)

    stocks = universe["stocks"]
    print(f"  Universe: {len(stocks)} 종목")

    events = []
    for i, s in enumerate(stocks, 1):
        sym = s["symbol"]
        rank = s["rank"]
        kr_name = s["name"]

        # yfinance는 BRK.B를 BRK-B로 받음
        yf_sym = sym.replace(".", "-")

        try:
            partials = fetch_for_symbol(yf_sym, start, end)
        except Exception as e:
            print(f"  ⚠️ {sym} 실패: {e}", file=sys.stderr)
            partials = []

        for p in partials:
            events.append({
                "date": p["date"],
                "dayOfWeek": p["dayOfWeek"],
                "time": p["time"],
                "country": "US",
                "symbol": sym,
                "name": kr_name,
                "marketCapRank": rank,
                "quarter": p["quarter"],
                "epsForecast": p["epsForecast"],
                "epsPrevious": p["epsPrevious"],
                "revenueForecast": p["revenueForecast"],
            })

        if i % 10 == 0:
            print(f"  진행: {i}/{len(stocks)} (이벤트 {len(events)}건 누적)")

        # rate limit 보호
        time.sleep(0.3)

    # 정렬: 날짜 → 시점 (BMO < HH:MM < AMC) → 시총 랭크
    def time_key(t: str) -> int:
        if t == "BMO":
            return 0
        if t == "AMC":
            return 9999
        try:
            return int(t.replace(":", ""))
        except ValueError:
            return 5000

    events.sort(key=lambda e: (e["date"], time_key(e["time"]), e["marketCapRank"]))

    output = {
        "weekStart": start.isoformat(),
        "weekEnd": end.isoformat(),
        "lastUpdated": today.isoformat(),
        "events": events,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 저장: {OUTPUT_PATH}")
    print(f"   총 이벤트: {len(events)}건")
    print(f"   범위: {start} ~ {end}")


if __name__ == "__main__":
    main()
