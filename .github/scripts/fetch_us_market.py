"""
미국 시장 데이터 모닝 배치 (미동부 장 마감 후 실행)

[목적]
  미국 지수 4개(S&P·나스닥·다우·SOX)와 미 국채 2Y·10Y 수익률을
  public/data/index-us.json 으로 저장한다.
  한국용 fetch_market_data.py 와는 완전히 별개의 스크립트/워크플로다.

[데이터 소스]
  - 지수: FMP(stable/historical-price-eod/light) 확정 종가 1차 → EODHD(real-time) 폴백.
          단 SOX(^SOX)는 FMP 무료 플랜에서 막혀 EODHD 전용.
  - 금리: 미 재무부 Par Yield Curve XML (BC_2YEAR / BC_10YEAR).

[환경변수]
  - TARGET_DATE_US : "YYYY-MM-DD". 없으면 미동부 기준 직전 거래일 자동 계산.
  - FMP_API_KEY    : Financial Modeling Prep (무료 250콜/일, 지수 3콜 사용)
  - EODHD_API_KEY  : EODHD (무료 20콜/일 — SOX 1콜 ~ 최대 4콜만 사용)

[출력]
  - public/data/index-us.json (저장소 루트 기준)

[호출 절약 원칙]
  EODHD는 SOX에 항상 1콜, 나머지 지수는 FMP가 실패했을 때만 폴백으로 호출.
  절대 루프에서 남발하지 않는다.
"""

import os
import sys
import json
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
    """EODHD real-time 로 지수 1건 조회. 실패/무효값이면 None."""
    url = (
        f"https://eodhd.com/api/real-time/{sym}"
        f"?api_token={EODHD_API_KEY}&fmt=json"
    )
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ⚠️ EODHD {sym} 조회 실패: {e}", file=sys.stderr)
        return None

    if not isinstance(data, dict):
        print(f"  ⚠️ EODHD {sym} 응답 비정상: {str(data)[:120]}", file=sys.stderr)
        return None

    close = _num(data.get("close"))
    if not close:  # 0/None/NA → 실패로 간주
        return None

    prev = _num(data.get("previousClose"))
    chg = _num(data.get("change"))
    chg_pct = _num(data.get("change_p"))

    if chg is None and prev is not None:
        chg = close - prev
    if chg_pct is None and prev not in (None, 0):
        chg_pct = (close - prev) / prev * 100

    return {
        "value": round(close, 2),
        "change_pct": round(chg_pct, 2) if chg_pct is not None else None,
        "change_pt": round(chg, 2) if chg is not None else None,
        "prevClose": round(prev, 2) if prev is not None else None,
        "source": "eodhd",
        "tradeDate": trade_date,
    }


def fetch_indices(trade_date):
    """지수 4개 수집. FMP 1차 → EODHD 폴백(SOX 는 EODHD 전용)."""
    out = {}
    for d in INDEX_DEFS:
        key = d["key"]
        result = None

        # 1차: FMP (fmp 심볼이 있고 키가 있을 때만)
        if d["fmp"] and FMP_API_KEY:
            result = fetch_fmp_index(d["fmp"], trade_date)

        # 2차: EODHD (SOX 는 항상 여기로, 나머지는 FMP 실패 시에만 — 콜 절약)
        if result is None and d["eodhd"] and EODHD_API_KEY:
            result = fetch_eodhd_index(d["eodhd"], trade_date)

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
    """재무부 Par Yield Curve XML 한 달치 → [(date, y2, y10), ...]. 실패 시 []."""
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/"
        "interest-rates/pages/xml"
        f"?data=daily_treasury_yield_curve&field_tdr_date_value_month={yyyymm}"
    )
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        root = ET.fromstring(r.content)
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

    월초(이번 달 관측 1개)엔 전일이 없어 bp 계산이 안 되므로,
    이번 달 + 직전 달 XML 을 함께 받아 병합·정렬해서 직전 영업일을 확보한다.
    """
    yyyymm = trade_date[0:4] + trade_date[5:7]
    prev_mm = _prev_month_yyyymm(yyyymm)

    merged = _fetch_treasury_month(yyyymm) + _fetch_treasury_month(prev_mm)
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
    index_data.update(indices)

    print("  [금리] 미 국채 2Y·10Y 수집...")
    treasury = fetch_treasury_yields(target)
    index_data.update(treasury)

    # 성공한 데이터가 하나라도 있을 때만 파일을 쓴다 (전부 실패 시 기존 보존)
    success_keys = [k for k in ("sp500", "nasdaq", "dow", "sox", "us2y", "us10y")
                    if k in index_data]
    if not success_keys:
        print("⚠️ 지수·금리 모두 실패 — index-us.json 갱신 안 함", file=sys.stderr)
        sys.exit(0)

    json_dir = os.path.join(DASHBOARD_PATH, "public", "data")
    os.makedirs(json_dir, exist_ok=True)
    filepath = os.path.join(json_dir, "index-us.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    print(f"✅ 저장: {filepath}")
    print(f"   수집 성공: {', '.join(success_keys)}")


if __name__ == "__main__":
    main()
