"""
미국 시장 데이터 모닝 배치 (미동부 장 마감 후 실행)

[목적]
  미국 지수 4개(S&P·나스닥·다우·SOX)와 미 국채 2Y·10Y 수익률을
  public/data/index-us.json 으로 저장한다.
  한국용 fetch_market_data.py 와는 완전히 별개의 스크립트/워크플로다.

[데이터 소스]
  - 지수: EODHD(eod 확정 종가) 1차 → FMP(stable/historical-price-eod/light) 폴백.
          FMP 무료 지수 종가가 부정확해(예: 7/2 다우 FMP 52760.68 vs 실제 52900.01)
          정확한 EODHD 확정 종가를 1차로 쓰고 FMP 은 폴백으로 강등.
          SOX(^SOX)는 FMP 무료 플랜에서 막혀 EODHD 전용(폴백 없음).
  - 금리: 미 재무부 Par Yield Curve XML (BC_2YEAR / BC_10YEAR).

[환경변수]
  - TARGET_DATE_US : "YYYY-MM-DD". 없으면 미동부 기준 직전 거래일 자동 계산.
  - EODHD_API_KEY  : EODHD (무료 20콜/일 — 지수 4개 eod = 4콜만 사용)
  - FMP_API_KEY    : Financial Modeling Prep (폴백 전용; EODHD 실패/미확정 시에만)

[출력]
  - public/data/index-us.json (저장소 루트 기준)

[호출 절약 원칙]
  EODHD eod 를 지수 4개(지수3 + SOX1)에 각 1콜 = 4콜/일. 무료 20콜/일 내 충분.
  FMP 은 EODHD 가 실패했을 때만 폴백으로 호출. 절대 루프에서 남발하지 않는다.
"""

import os
import sys
import json
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

# Windows 콘솔(cp949)에서도 이모지/한글 출력 가능하도록 강제 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ── 환경변수 ──
FMP_API_KEY = os.environ.get("FMP_API_KEY", "").strip()
EODHD_API_KEY = os.environ.get("EODHD_API_KEY", "").strip()

# ── 출력 위치 (저장소 루트 기준) ──
DASHBOARD_PATH = os.getcwd()

HTTP_TIMEOUT = 15
# 재무부 XML 은 응답 시작까지 ~19초(실측 18.5~19.8초) 걸려 15초로는 매번 Read timeout.
# 재무부 호출에만 적용 — FMP/EODHD 는 HTTP_TIMEOUT 그대로.
TREASURY_TIMEOUT = (10, 60)  # (connect, read)

# 지수 정의: FMP 심볼(없으면 EODHD 전용), EODHD 심볼
#   SOX 는 FMP 무료에서 막히므로 fmp=None → 바로 EODHD.
INDEX_DEFS = [
    {"key": "sp500",  "fmp": "^GSPC", "eodhd": "GSPC.INDX"},
    {"key": "nasdaq", "fmp": "^IXIC", "eodhd": "IXIC.INDX"},
    {"key": "dow",    "fmp": "^DJI",  "eodhd": "DJI.INDX"},
    {"key": "sox",    "fmp": None,    "eodhd": "SOX.INDX"},
]


def compute_target_date():
    """미동부 기준 직전 거래일(가장 최근 영업일) "YYYY-MM-DD".

    배치는 UTC 20:30(미동부 약 16:30, 마감 직후)에 돌므로 당일 ET 날짜가
    그날의 거래일이다. 주말이면 직전 금요일로 되돌린다. (공휴일 미보정 —
    데이터 제공처가 자기 기준 마지막 거래일을 반환하므로 큰 문제 없음.)
    """
    # 20:30 UTC 시점에는 ET(=UTC-5/-4)가 동일 calendar day 이므로 -5h 로 근사.
    et_now = datetime.now(timezone.utc) - timedelta(hours=5)
    d = et_now.date()
    while d.weekday() > 4:  # 5=토, 6=일
        d = d - timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def _previous_business_day(yyyy_mm_dd):
    """"YYYY-MM-DD" 의 직전 영업일(주말 스킵). 공휴일은 보정하지 않는다.
    '전부 실패'가 미국 공휴일 오탐인지 가리기 위한 1회 재시도용."""
    d = datetime.strptime(yyyy_mm_dd, "%Y-%m-%d").date() - timedelta(days=1)
    while d.weekday() > 4:
        d = d - timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def _num(v):
    """문자열/숫자를 float 으로. 빈값·NA·변환불가·파싱실패는 None."""
    try:
        if v is None:
            return None
        if isinstance(v, str) and v.strip().upper() in ("", "NA", "N/A", "NULL"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_fmp_index(sym, trade_date):
    """FMP historical-price-eod/light 로 확정 종가(EOD) 1건 조회.

    stable/quote 는 마감 직후 정정 전 값이라 확정 종가와 미세하게 어긋나므로
    EOD 종가 시리즈를 쓴다. 응답 배열은 최신순: [0]=대상일 종가, [1]=전일 종가.
    실패/무효값이거나 대상일 EOD 가 아직 확정 전이면 None → EODHD 폴백.
    """
    url = (
        "https://financialmodelingprep.com/stable/historical-price-eod/light"
        f"?symbol={urllib.parse.quote(sym)}&apikey={FMP_API_KEY}"
    )
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ⚠️ FMP {sym} 조회 실패: {e}", file=sys.stderr)
        return None

    if not isinstance(data, list) or not data:
        print(f"  ⚠️ FMP {sym} 응답 비정상: {str(data)[:120]}", file=sys.stderr)
        return None

    row = data[0]
    price = _num(row.get("price"))
    if not price:  # 0/None/NA → 실패로 간주
        return None

    # 대상일 EOD 가 아직 확정 전이면([0].date != 대상일) EODHD 폴백으로 넘긴다.
    row_date = str(row.get("date") or "")[:10]
    if row_date != trade_date:
        print(f"  ⚠️ FMP {sym} EOD 미확정(최신 {row_date} ≠ 대상 {trade_date}) — EODHD 폴백",
              file=sys.stderr)
        return None

    prev = _num(data[1].get("price")) if len(data) >= 2 else None
    chg = price - prev if prev is not None else None
    chg_pct = (chg / prev * 100) if (prev not in (None, 0) and chg is not None) else None

    return {
        "value": round(price, 2),
        "change_pct": round(chg_pct, 2) if chg_pct is not None else None,
        "change_pt": round(chg, 2) if chg is not None else None,
        "prevClose": round(prev, 2) if prev is not None else None,
        "source": "fmp",
        "tradeDate": trade_date,
    }


def fetch_eodhd_index(sym, trade_date):
    """EODHD eod(확정 종가) 로 지수 1건 조회. 실패/무효값·미확정이면 None.

    GET /api/eod/{SYM}?...&order=d&limit=2 → 최신순 배열: [0]=대상일, [1]=전일.
    확정 종가라 real-time 시세보다 정확하다. value=[0].close, prevClose=[1].close.
    [0].date != 대상일이면 아직 EOD 미확정 → None(FMP 폴백으로 넘김).
    """
    url = (
        f"https://eodhd.com/api/eod/{sym}"
        f"?api_token={EODHD_API_KEY}&fmt=json&order=d&limit=2"
    )
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ⚠️ EODHD {sym} 조회 실패: {e}", file=sys.stderr)
        return None

    if not isinstance(data, list) or not data:
        print(f"  ⚠️ EODHD {sym} 응답 비정상: {str(data)[:120]}", file=sys.stderr)
        return None

    row = data[0]
    close = _num(row.get("close"))
    if not close:  # 0/None/NA → 실패로 간주
        return None

    # 대상일 EOD 가 아직 확정 전이면([0].date != 대상일) FMP 폴백으로 넘긴다.
    row_date = str(row.get("date") or "")[:10]
    if row_date != trade_date:
        print(f"  ⚠️ EODHD {sym} EOD 미확정(최신 {row_date} ≠ 대상 {trade_date}) — FMP 폴백",
              file=sys.stderr)
        return None

    prev = _num(data[1].get("close")) if len(data) >= 2 else None
    chg = close - prev if prev is not None else None
    chg_pct = (chg / prev * 100) if (prev not in (None, 0) and chg is not None) else None

    return {
        "value": round(close, 2),
        "change_pct": round(chg_pct, 2) if chg_pct is not None else None,
        "change_pt": round(chg, 2) if chg is not None else None,
        "prevClose": round(prev, 2) if prev is not None else None,
        "source": "eodhd",
        "tradeDate": trade_date,
    }


def fetch_indices(trade_date):
    """지수 4개 수집. EODHD(확정 종가) 1차 → FMP 폴백(SOX 는 EODHD 전용)."""
    out = {}
    for d in INDEX_DEFS:
        key = d["key"]
        result = None

        # 1차: EODHD eod (확정 종가 — FMP 무료보다 정확; 키가 있을 때만)
        if d["eodhd"] and EODHD_API_KEY:
            result = fetch_eodhd_index(d["eodhd"], trade_date)

        # 2차: FMP 폴백 (EODHD 실패/미확정 시에만; SOX 는 fmp=None 이라 폴백 없음)
        if result is None and d["fmp"] and FMP_API_KEY:
            result = fetch_fmp_index(d["fmp"], trade_date)

        if result is not None:
            out[key] = result
            print(f"    {key}: {result['value']} "
                  f"({result['change_pct']:+}% , {result['change_pt']:+}pt) "
                  f"[{result['source']}, {result['tradeDate']}]")
        else:
            print(f"    ⚠️ {key} 지수 수집 실패 — 생략", file=sys.stderr)
    return out


def _prev_month_yyyymm(yyyymm):
    """"YYYYMM" 의 직전 달 "YYYYMM"."""
    y = int(yyyymm[:4])
    m = int(yyyymm[4:6]) - 1
    if m == 0:
        y -= 1
        m = 12
    return f"{y:04d}{m:02d}"


def _fetch_treasury_month(yyyymm):
    """재무부 Par Yield Curve XML 한 달치 → [(date, y2, y10), ...]. 실패 시 [].

    timeout·연결 오류면 3초 쉬고 1회 재시도. 그 외 오류(HTTP 상태·XML 파싱)는 재시도 없이 [].
    """
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/"
        "interest-rates/pages/xml"
        f"?data=daily_treasury_yield_curve&field_tdr_date_value_month={yyyymm}"
    )
    for attempt in (1, 2):
        try:
            r = requests.get(url, timeout=TREASURY_TIMEOUT)
            r.raise_for_status()
            root = ET.fromstring(r.content)
            break
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            if attempt == 2:
                print(f"  ⚠️ 재무부 금리({yyyymm}) 조회 실패(재시도 후): {e}", file=sys.stderr)
                return []
            print(f"  ⚠️ 재무부 금리({yyyymm}) timeout/연결 오류 — 3초 후 재시도: {e}",
                  file=sys.stderr)
            time.sleep(3)
        except Exception as e:
            print(f"  ⚠️ 재무부 금리({yyyymm}) 조회 실패: {e}", file=sys.stderr)
            return []

    NS_D = "{http://schemas.microsoft.com/ado/2007/08/dataservices}"
    NS_M = "{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}"

    rows = []
    for props in root.iter(NS_M + "properties"):
        date_el = props.find(NS_D + "NEW_DATE")
        if date_el is None or not date_el.text:
            continue
        y2_el = props.find(NS_D + "BC_2YEAR")
        y10_el = props.find(NS_D + "BC_10YEAR")
        rows.append((
            date_el.text[:10],
            _num(y2_el.text if y2_el is not None else None),
            _num(y10_el.text if y10_el is not None else None),
        ))
    return rows


def fetch_treasury_yields(trade_date):
    """미 재무부 Par Yield Curve XML 에서 2Y·10Y 수익률 + 전일대비 bp.

    이번 달 XML 을 먼저 받고, 행이 2개 미만(월초 — 직전 영업일이 이번 달에 없음)일 때만
    직전 달 XML 을 추가로 받아 병합·정렬해서 직전 영업일을 확보한다.
    (XML 1회 ~19초라 매번 두 달을 받으면 ~40초. 월초가 아니면 이번 달만으로 충분.)
    """
    yyyymm = trade_date[0:4] + trade_date[5:7]

    merged = _fetch_treasury_month(yyyymm)
    if len(merged) < 2:
        merged += _fetch_treasury_month(_prev_month_yyyymm(yyyymm))
    if not merged:
        print("  ⚠️ 재무부 금리 entry 없음 — 생략", file=sys.stderr)
        return {}

    # 날짜 중복 제거(달 경계 안전) 후 오름차순 정렬 → 마지막이 최신
    dedup = {}
    for row in merged:
        dedup[row[0]] = row
    rows = sorted(dedup.values(), key=lambda x: x[0])

    latest = rows[-1]
    prev = rows[-2] if len(rows) >= 2 else (None, None, None)
    latest_date = latest[0]

    out = {}
    # us2y
    if latest[1] is not None:
        change_bp = None
        if prev[1] is not None:
            change_bp = round((latest[1] - prev[1]) * 100, 1)
        out["us2y"] = {
            "value": round(latest[1], 3),
            "change_bp": change_bp,
            "tradeDate": latest_date,
        }
    # us10y
    if latest[2] is not None:
        change_bp = None
        if prev[2] is not None:
            change_bp = round((latest[2] - prev[2]) * 100, 1)
        out["us10y"] = {
            "value": round(latest[2], 3),
            "change_bp": change_bp,
            "tradeDate": latest_date,
        }

    for k in ("us2y", "us10y"):
        if k in out:
            print(f"    {k}: {out[k]['value']}% "
                  f"({out[k]['change_bp']}bp) [{out[k]['tradeDate']}]")
        else:
            print(f"    ⚠️ {k} 금리 없음 — 생략", file=sys.stderr)
    return out


def main():
    target = os.environ.get("TARGET_DATE_US", "").strip() or compute_target_date()
    print(f"▶ 미국 시장 데이터 수집 시작 (대상일 {target})")

    index_data = {
        "date": target,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    print("  [지수] S&P·나스닥·다우·SOX 수집...")
    indices = fetch_indices(target)

    print("  [금리] 미 국채 2Y·10Y 수집...")
    treasury = fetch_treasury_yields(target)

    # ── 지수 0개 → 직전 거래일로 지수만 1회 재시도 ──
    # 지수 함수는 대상일 EOD 가 없으면(미국 휴장일·장 마감 전 수동 실행) None 을 돌려주지만,
    # 금리는 대상일과 무관하게 재무부 최신 거래일 값을 돌려준다. 그래서 재시도 기준을
    # "전부 실패"로 두면 휴장일엔 금리만 성공해 지수 없는 파일이 저장된다(7/3 독립기념일
    # 대체휴장 때 실제 발생). 기준은 "지수 0개"이고, 금리는 이미 받은 값을 그대로 둔다.
    # 재시도도 지수 0개면 EODHD/FMP 접근 이상 — 지수가 이 파일의 핵심이므로 금리만 든
    # 파일로 덮어쓰지 않고 exit 1 (기존 index-us.json 보존).
    #   ※ 연휴가 이틀 이상 연속이면 1회 재시도가 또 휴장일에 걸려 오탐(exit 1)이 남을 수 있음.
    if not indices:
        retry_date = _previous_business_day(target)
        print(f"⚠️ {target} 지수 전부 실패 — 직전 거래일 {retry_date}로 지수만 1회 재시도",
              file=sys.stderr)
        indices = fetch_indices(retry_date)
        if not indices:
            print("❌ 지수 전부 실패 (직전 거래일 재시도도 실패) — "
                  "EODHD/FMP 접근 확인 필요. index-us.json 보존", file=sys.stderr)
            sys.exit(1)
        print(f"  ↩ 직전 거래일 {retry_date} 지수 확보 — 휴장으로 간주하고 저장",
              file=sys.stderr)
        index_data["date"] = retry_date

    # 지수는 있고 금리만 없으면 그대로 저장 — 금리 카드는 FRED 폴백, 누락 알림은 워크플로가 띄운다.
    index_data.update(indices)
    index_data.update(treasury)

    ALL_KEYS = ("sp500", "nasdaq", "dow", "sox", "us2y", "us10y")
    success_keys = [k for k in ALL_KEYS if k in index_data]

    json_dir = os.path.join(DASHBOARD_PATH, "public", "data")
    os.makedirs(json_dir, exist_ok=True)
    filepath = os.path.join(json_dir, "index-us.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    print(f"✅ 저장: {filepath}")
    print(f"   수집 성공: {', '.join(success_keys)}")


if __name__ == "__main__":
    main()
