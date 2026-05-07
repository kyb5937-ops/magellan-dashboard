"""
경제 캘린더 actual 값 자동 갱신 (Finnhub API 사용)

[입력]
- public/data/economic-calendar.json (ChatGPT 수동 큐레이션)
- 환경변수 FINNHUB_API_KEY

[처리]
- Finnhub /calendar/economic endpoint 호출
- weekStart ~ weekEnd 범위 데이터 받음
- 기존 events 각 항목과 매칭:
    1. 날짜(date) 일치
    2. 국가(country) 일치
    3. 이벤트명 토큰 매칭 (한국어 → 영문 매핑 포함)
- 매칭 성공 + Finnhub actual 존재 시 → events[i].actual 갱신
- 매칭 실패 또는 Finnhub actual 없음 → 기존값(보통 null) 유지

[출력]
- public/data/economic-calendar.json 갱신 (기존 구조 보존)
- lastUpdated 필드만 today로 갱신

[운영 메모]
- Finnhub 무료 플랜 분당 60 호출 제한 — 우리 사용량은 하루 1~2 호출이라 무관
- 매칭 실패는 정상. 무리하게 채우지 말고 비워두는 게 안전
"""
import os
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
CALENDAR_PATH = ROOT / "public" / "data" / "economic-calendar.json"
FINNHUB_BASE = "https://finnhub.io/api/v1"

SUPPORTED_COUNTRIES = {"US", "KR"}

NAME_TOKEN_MAP = {
    "FOMC": ["FOMC", "Federal Funds", "Fed Rate"],
    "금리 결정": ["Rate Decision", "Interest Rate"],
    "비농업": ["Nonfarm", "Non-Farm"],
    "실업률": ["Unemployment Rate"],
    "CPI": ["CPI", "Consumer Price"],
    "Core CPI": ["Core CPI"],
    "PCE": ["PCE", "Personal Consumption"],
    "Core PCE": ["Core PCE"],
    "GDP": ["GDP"],
    "ISM 제조업": ["ISM Manufacturing"],
    "ISM 서비스업": ["ISM Services", "ISM Non-Manufacturing"],
    "소매판매": ["Retail Sales"],
    "산업생산": ["Industrial Production"],
    "내구재": ["Durable Goods"],
    "무역수지": ["Trade Balance"],
    "JOLTS": ["JOLTS", "Job Openings"],
    "ADP": ["ADP"],
    "미시간": ["Michigan"],
    "소비자신뢰": ["Consumer Confidence"],
    "산업활동": ["Industrial Activity", "Industrial Production"],
    "경상수지": ["Current Account"],
    "외환보유": ["Foreign Reserves"],
    "고용동향": ["Employment", "Unemployment Rate"],
    "한국은행": ["Bank of Korea", "BOK Rate"],
    "한은 기준금리": ["Bank of Korea", "BOK Rate"],
}


def normalize_text(s: str) -> str:
    if not s:
        return ""
    return s.lower().replace(" ", "").replace("(", "").replace(")", "").replace("·", "")


def name_matches(local_name: str, finnhub_event: str) -> bool:
    if not local_name or not finnhub_event:
        return False
    fh_norm = normalize_text(finnhub_event)
    for kr_token, en_candidates in NAME_TOKEN_MAP.items():
        if kr_token in local_name:
            for en in en_candidates:
                if normalize_text(en) in fh_norm:
                    return True
    return False


def extract_unit_pattern(reference: str):
    """forecast/previous 문자열에서 (prefix, suffix) 단위 패턴 추출."""
    if not reference:
        return ("", "")
    if any(ch in reference for ch in ("(", ")", "~", " ")):
        return ("", "")
    s = reference.lstrip("+-")
    prefix = ""
    if s.startswith("$"):
        prefix = "$"
        s = s[1:]
    suffix = ""
    for suf in ("bp", "%", "B", "M", "K", "T"):
        if s.endswith(suf):
            suffix = suf
            break
    return (prefix, suffix)


def format_actual_with_unit(actual_raw: str, reference: str) -> str:
    """actual raw 숫자에 reference의 단위 패턴 적용."""
    if not actual_raw:
        return actual_raw
    prefix, suffix = extract_unit_pattern(reference)
    s = str(actual_raw)
    sign = ""
    if s.startswith("-"):
        sign = "-"
        s = s[1:]
    elif s.startswith("+"):
        s = s[1:]
    return f"{sign}{prefix}{s}{suffix}"


def needs_reformat(actual_str: str, reference: str) -> bool:
    """기존 actual이 단위 없이 raw 숫자만 있고, reference엔 단위가 있으면 재처리 필요."""
    if not actual_str:
        return False
    ref_prefix, ref_suffix = extract_unit_pattern(reference)
    if not (ref_prefix or ref_suffix):
        return False
    s = actual_str.lstrip("+-")
    has_prefix = bool(ref_prefix and s.startswith(ref_prefix))
    has_suffix = bool(ref_suffix and s.endswith(ref_suffix))
    if ref_prefix and ref_suffix:
        return not (has_prefix and has_suffix)
    return not (has_prefix or has_suffix)


def fetch_finnhub_calendar(api_key: str, start: str, end: str) -> list:
    url = f"{FINNHUB_BASE}/calendar/economic"
    params = {"from": start, "to": end, "token": api_key}
    try:
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        return data.get("economicCalendar", []) or []
    except Exception as e:
        print(f"  ⚠️ Finnhub API 호출 실패: {e}", file=sys.stderr)
        return []


def find_actual_for_event(local_event: dict, finnhub_events: list):
    local_date = local_event.get("date")
    local_country = local_event.get("country")
    local_name = local_event.get("name", "")
    if not local_date or not local_country:
        return None

    candidates = [
        fe for fe in finnhub_events
        if fe.get("country") == local_country
        and fe.get("time", "").startswith(local_date)
    ]

    for fe in candidates:
        if name_matches(local_name, fe.get("event", "")):
            actual = fe.get("actual")
            if actual not in (None, "", "—"):
                reference = local_event.get("forecast") or local_event.get("previous") or ""
                return format_actual_with_unit(str(actual), reference)
    return None


def main():
    api_key = os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        print("❌ FINNHUB_API_KEY 환경변수 없음", file=sys.stderr)
        sys.exit(1)

    if not CALENDAR_PATH.exists():
        print(f"❌ 파일 없음: {CALENDAR_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(CALENDAR_PATH, "r", encoding="utf-8") as f:
        calendar = json.load(f)

    week_start = calendar.get("weekStart")
    week_end = calendar.get("weekEnd")
    events = calendar.get("events", [])

    if not week_start or not week_end:
        print("❌ weekStart/weekEnd 없음", file=sys.stderr)
        sys.exit(1)

    print(f"▶ 경제 캘린더 actual 갱신: {week_start} ~ {week_end}")
    print(f"  기존 이벤트: {len(events)}건")

    finnhub_events = fetch_finnhub_calendar(api_key, week_start, week_end)
    print(f"  Finnhub 응답: {len(finnhub_events)}건")

    filled = 0
    reformatted = 0
    skipped = 0
    for ev in events:
        if ev.get("country") not in SUPPORTED_COUNTRIES:
            continue

        existing = ev.get("actual")
        reference = ev.get("forecast") or ev.get("previous") or ""

        if existing not in (None, "", "—") and not needs_reformat(str(existing), reference):
            continue

        actual = find_actual_for_event(ev, finnhub_events)
        if actual:
            if existing in (None, "", "—"):
                filled += 1
            else:
                reformatted += 1
            ev["actual"] = actual
        else:
            if existing in (None, "", "—"):
                skipped += 1

    today_kst = datetime.now(timezone.utc).astimezone().date().isoformat()
    calendar["lastUpdated"] = today_kst

    with open(CALENDAR_PATH, "w", encoding="utf-8") as f:
        json.dump(calendar, f, ensure_ascii=False, indent=2)

    print(f"  ✅ actual 채움: {filled}건")
    print(f"  🔄 actual 단위 재적용: {reformatted}건")
    print(f"  - 매칭 실패/미발표: {skipped}건 (정상 — 비워둠)")
    print(f"  저장: {CALENDAR_PATH}")


if __name__ == "__main__":
    main()
