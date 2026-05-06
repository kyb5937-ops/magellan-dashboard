"""
한국 시총 100 종목의 다음 14일 실적 발표 일정 + 컨센서스 자동 수집

[데이터 소스]
- 시총 universe: pykrx (KOSPI + KOSDAQ 시총 상위 100, 매번 재계산)
- 발표일: DART API (잠정실적공시 / 결산실적공시예고 키워드 매칭)
- EPS·매출 컨센서스: 네이버금융 스크래핑 (best effort)

[현실적 기대]
- 한국 잠정실적공시는 보통 발표 D-1 ~ 당일에 등록됨 (DART 특성)
- 따라서 한 주 미리 채우기 어려움 — 매일 cron으로 D-당일 신규 공시를 잡는 구조
- EPS/매출 컨센서스는 종목 50~70%만 채워질 수 있음 (네이버 페이지에 없으면 null)

[입력]
- public/data/stock-symbols-100-kr.json (이 스크립트가 매번 재생성)
- 환경변수 DART_API_KEY

[출력]
- public/data/earnings-calendar-kr.json
- public/data/stock-symbols-100-kr.json (universe 갱신)
"""

import os
import sys
import io
import json
import re
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, date

import requests
from bs4 import BeautifulSoup
from pykrx import stock

# Windows 콘솔(cp949) 호환
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.getcwd()
UNIVERSE_PATH = os.path.join(ROOT, "public", "data", "stock-symbols-100-kr.json")
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "earnings-calendar-kr.json")

DART_API_KEY = os.environ.get("DART_API_KEY", "").strip()

DAY_OF_WEEK_KR = ["월", "화", "수", "목", "금", "토", "일"]

# DART 공시 제목에서 "실적 발표 관련" 으로 인식할 키워드
EARNINGS_KEYWORDS = [
    "잠정실적",
    "결산실적공시예고",
    "결산실적공시 예고",
    "영업(잠정)실적",
    "영업잠정실적",
    "매출액또는손익구조30%이상변경",  # 일부 종목은 이 형식으로 잠정 결과 공시
]


# ── 1. KOSPI + KOSDAQ 시총 상위 100 ─────────────────────────────────────

# 우선주 패턴: 종목명 끝이 "우" 한 글자, 또는 "우[숫자][A-Z]?" 패턴
PREFERRED_PATTERN = re.compile(r"우[0-9]?[A-Z]?$|\(우\)$|우\(.+\)$")


def is_preferred_share(name: str) -> bool:
    """우선주(005935 삼성전자우 등) 여부. 보통주만 universe에 포함하기 위함."""
    if not name:
        return False
    return bool(PREFERRED_PATTERN.search(name))


def _fetch_market_cap_with_fallback():
    """오늘부터 거꾸로 영업일 시총 데이터 시도. (기준일, kospi_df, kosdaq_df) 반환.
    pykrx의 get_market_cap_by_ticker는 KRX 로그인 필요 (KRX_ID/KRX_PW 환경변수)."""
    last_error = None
    for offset in range(0, 10):
        d = (date.today() - timedelta(days=offset)).strftime("%Y%m%d")
        try:
            df_k = stock.get_market_cap_by_ticker(d, market="KOSPI")
            if df_k is None or df_k.empty:
                print(f"  {d} KOSPI: 빈 결과 (df_k.empty)", file=sys.stderr)
                continue
            df_q = stock.get_market_cap_by_ticker(d, market="KOSDAQ")
            if df_q is None or df_q.empty:
                print(f"  {d} KOSDAQ: 빈 결과 (df_q.empty)", file=sys.stderr)
                continue
            print(f"  ✅ KRX 시총 조회 성공: 기준일={d} (KOSPI {len(df_k)}종목, KOSDAQ {len(df_q)}종목)")
            print(f"  KOSPI 컬럼명: {df_k.columns.tolist()}")
            return d, df_k, df_q
        except Exception as e:
            last_error = e
            print(f"  {d} 실패: {type(e).__name__}: {e}", file=sys.stderr)
            continue
    print(f"  ❌ 10일 모두 실패. 마지막 에러: {last_error}", file=sys.stderr)
    return None, None, None


def build_universe():
    biz, df_kospi, df_kosdaq = _fetch_market_cap_with_fallback()
    if biz is None:
        print("  ⚠️ KRX 시총 데이터 조회 실패 (KRX_ID/KRX_PW 확인)", file=sys.stderr)
        return []
    print(f"  Universe 기준일: {biz}")

    rows = []
    for df, market in ((df_kospi, "KOSPI"), (df_kosdaq, "KOSDAQ")):
        if df is None or df.empty:
            continue
        for ticker, row in df.iterrows():
            try:
                name = stock.get_market_ticker_name(ticker)
            except Exception:
                name = ticker
            # 우선주 제외
            if is_preferred_share(name):
                continue
            rows.append({
                "symbol": ticker,
                "name": name,
                "market": market,
                "mcap": int(row.get("시가총액", 0)),
            })

    # mcap 검증
    mcap_zero_count = sum(1 for r in rows if r["mcap"] == 0)
    print(f"  rows 수집: {len(rows)}종목 (mcap=0인 종목: {mcap_zero_count})")
    if mcap_zero_count > len(rows) * 0.5:
        print(f"  ⚠️ mcap이 절반 이상 0임. 컬럼명 또는 row 구조 확인 필요!", file=sys.stderr)
        if df_kospi is not None and not df_kospi.empty:
            first_ticker = df_kospi.index[0]
            first_row = df_kospi.iloc[0]
            print(f"  KOSPI 첫 행 ({first_ticker}): {first_row.to_dict()}", file=sys.stderr)

    # 시총 내림차순 정렬, 상위 100
    rows.sort(key=lambda r: r["mcap"], reverse=True)
    top100 = rows[:100]
    print(f"  정렬 후 상위 5: {[(r['name'], r['mcap']) for r in top100[:5]]}")

    output = {
        "lastUpdated": date.today().isoformat(),
        "source": "pykrx (KOSPI + KOSDAQ market cap)",
        "asOf": biz,
        "stocks": [
            {"rank": i + 1, "symbol": r["symbol"], "name": r["name"], "market": r["market"]}
            for i, r in enumerate(top100)
        ],
    }
    os.makedirs(os.path.dirname(UNIVERSE_PATH), exist_ok=True)
    with open(UNIVERSE_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"  Universe 저장: {len(top100)} 종목")
    return output["stocks"]


# ── 2. DART corp_code 매핑 ─────────────────────────────────────────────

def fetch_dart_corp_code_map(stock_codes_needed):
    """종목코드 → DART corp_code 매핑. 우리 universe 종목만 추출."""
    if not DART_API_KEY:
        print("  ⚠️ DART_API_KEY 없음 — DART 검색 건너뜀", file=sys.stderr)
        return {}

    url = f"https://opendart.fss.or.kr/api/corpCode.xml"
    try:
        r = requests.get(url, params={"crtfc_key": DART_API_KEY}, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"  ⚠️ corp_code.xml 다운로드 실패: {e}", file=sys.stderr)
        return {}

    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
        xml_bytes = z.read("CORPCODE.xml")
    except Exception as e:
        print(f"  ⚠️ corp_code zip 파싱 실패: {e}", file=sys.stderr)
        return {}

    needed = set(stock_codes_needed)
    mapping = {}
    root = ET.fromstring(xml_bytes)
    for elem in root.findall("list"):
        stock_code = (elem.findtext("stock_code") or "").strip()
        corp_code = (elem.findtext("corp_code") or "").strip()
        if stock_code and corp_code and stock_code in needed:
            mapping[stock_code] = corp_code

    print(f"  corp_code 매핑: {len(mapping)}/{len(needed)} 종목")
    return mapping


# ── 3. DART 공시 검색 ───────────────────────────────────────────────────

def fetch_disclosures_for_corp(corp_code: str, start_yyyymmdd: str, end_yyyymmdd: str):
    """단일 회사의 기간 내 공시 목록"""
    if not DART_API_KEY:
        return []
    url = "https://opendart.fss.or.kr/api/list.json"
    params = {
        "crtfc_key": DART_API_KEY,
        "corp_code": corp_code,
        "bgn_de": start_yyyymmdd,
        "end_de": end_yyyymmdd,
        "page_count": 50,
    }
    try:
        r = requests.get(url, params=params, timeout=15)
        data = r.json()
    except Exception as e:
        return []
    if data.get("status") != "000":
        return []
    return data.get("list", [])


def is_earnings_disclosure(report_nm: str) -> bool:
    if not report_nm:
        return False
    return any(kw in report_nm for kw in EARNINGS_KEYWORDS)


# ── 4. 네이버금융 컨센서스 스크래핑 ────────────────────────────────────

def _format_kr_eps(value_str):
    """네이버 셀 값(쉼표 제거된 문자열) → 'XXX원' 포맷. 실패 시 None."""
    if not value_str:
        return None
    try:
        return f"{int(float(value_str)):,}원"
    except (TypeError, ValueError):
        return None


def _format_kr_revenue(value_str):
    """네이버 셀 값(억원 단위) → '조' 또는 '억원' 포맷. 실패 시 None."""
    if not value_str:
        return None
    try:
        rev_num = float(value_str)
    except (TypeError, ValueError):
        return None
    if rev_num >= 10000:
        return f"{rev_num / 10000:.1f}조원"
    return f"{int(rev_num):,}억원"


def _quarter_label_from_naver_header(text: str):
    """네이버 헤더 텍스트(예: '2025.12', '2026.03 (E)') → 'YYQX'.
    파싱 실패 시 None."""
    if not text:
        return None
    m = re.search(r"(\d{4})\.(\d{2})", text)
    if not m:
        return None
    y = int(m.group(1)) % 100
    mo = int(m.group(2))
    if 1 <= mo <= 3:
        return f"{y:02d}Q1"
    if 4 <= mo <= 6:
        return f"{y:02d}Q2"
    if 7 <= mo <= 9:
        return f"{y:02d}Q3"
    return f"{y:02d}Q4"


def _prev_year_quarter(qlabel: str):
    """'26Q1' → '25Q1'."""
    if not qlabel or len(qlabel) != 4:
        return None
    try:
        y = int(qlabel[:2])
    except ValueError:
        return None
    return f"{(y - 1) % 100:02d}{qlabel[2:]}"


def fetch_naver_consensus(stock_code: str, target_quarter: str = None):
    """네이버 종목 페이지 '기업실적분석' 분기 테이블에서 추출.

    target_quarter (예: "26Q1") 가 주어지면 분기 라벨 매칭으로:
      epsActual / revenueActual / operatingIncomeActual = target_quarter 컬럼 값
        (단, (E) 표시면 미발표 → null)
      epsPreviousYoY / revenuePreviousYoY / operatingIncomePreviousYoY
        = target_quarter - 1년 컬럼 값
      epsForecast / revenueForecast / operatingIncomeForecast = (E) 표시 컬럼 값

    target_quarter가 None이면 단순 위치 기반 fallback ((E) 직전·4분기 전).

    반환 dict 키:
      epsForecast / epsActual / epsPreviousYoY /
      revenueForecast / revenueActual / revenuePreviousYoY /
      operatingIncomeForecast / operatingIncomeActual / operatingIncomePreviousYoY /
      surprise
    실패 항목은 None.
    """
    empty = {
        "epsForecast": None,
        "epsActual": None,
        "epsPreviousYoY": None,
        "revenueForecast": None,
        "revenueActual": None,
        "revenuePreviousYoY": None,
        "operatingIncomeForecast": None,
        "operatingIncomeActual": None,
        "operatingIncomePreviousYoY": None,
        "surprise": None,
    }
    try:
        url = f"https://finance.naver.com/item/main.naver?code={stock_code}"
        r = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept-Language": "ko-KR,ko;q=0.9",
        })
        if r.status_code != 200:
            return empty
        soup = BeautifulSoup(r.text, "html.parser")
        section = soup.select_one("div.section.cop_analysis")
        if section is None:
            return empty
        table = section.find("table")
        if table is None:
            return empty

        thead = table.find("thead")
        if thead is None:
            return empty
        thead_rows = thead.find_all("tr")
        if len(thead_rows) < 2:
            return empty
        col_headers = thead_rows[1].find_all("th")

        def is_estimate(idx):
            if idx < 0 or idx >= len(col_headers):
                return True
            em = col_headers[idx].find("em")
            return bool(em and "E" in em.get_text())

        # 마지막 (E) 컬럼 = forecast 컬럼
        future_idx = None
        for i, th in enumerate(col_headers):
            em = th.find("em")
            if em and "E" in em.get_text():
                future_idx = i
        if future_idx is None:
            return empty

        # 컬럼별 분기 라벨 매핑 (분기 영역만, "YYYY.MM" 텍스트가 있는 컬럼만)
        col_labels = {}
        for i, th in enumerate(col_headers):
            text = th.get_text(strip=True)
            ql = _quarter_label_from_naver_header(text)
            if ql:
                col_labels[i] = ql

        # actual_idx / yoy_idx 결정
        actual_idx = None
        yoy_idx = None
        if target_quarter:
            yoy_q = _prev_year_quarter(target_quarter)
            for i, ql in col_labels.items():
                if ql == target_quarter and not is_estimate(i):
                    actual_idx = i
                if ql == yoy_q and not is_estimate(i):
                    yoy_idx = i
        else:
            # fallback: (E) 직전 / 4분기 전
            if future_idx - 1 >= 0 and not is_estimate(future_idx - 1):
                actual_idx = future_idx - 1
            if future_idx - 4 >= 0 and not is_estimate(future_idx - 4):
                yoy_idx = future_idx - 4

        tbody = table.find("tbody")
        if tbody is None:
            return empty

        # 행별 셀 값 수집
        eps_cells = {}
        rev_cells = {}
        op_cells = {}
        for tr in tbody.find_all("tr"):
            label_th = tr.find("th")
            if not label_th:
                continue
            label = label_th.get_text(strip=True)
            tds = tr.find_all("td")
            if "EPS" in label:
                target = eps_cells
            elif "매출액" in label:
                target = rev_cells
            elif "영업이익" in label:
                target = op_cells
            else:
                continue
            for i, td in enumerate(tds):
                cell = td.get_text(strip=True).replace(",", "")
                if cell and cell not in ("-", "—", "N/A"):
                    target[i] = cell

        eps_forecast = _format_kr_eps(eps_cells.get(future_idx))
        eps_actual = _format_kr_eps(eps_cells.get(actual_idx)) if actual_idx is not None else None
        eps_yoy = _format_kr_eps(eps_cells.get(yoy_idx)) if yoy_idx is not None else None

        rev_forecast = _format_kr_revenue(rev_cells.get(future_idx))
        rev_actual = _format_kr_revenue(rev_cells.get(actual_idx)) if actual_idx is not None else None
        rev_yoy = _format_kr_revenue(rev_cells.get(yoy_idx)) if yoy_idx is not None else None

        op_forecast = _format_kr_revenue(op_cells.get(future_idx))
        op_actual = _format_kr_revenue(op_cells.get(actual_idx)) if actual_idx is not None else None
        op_yoy = _format_kr_revenue(op_cells.get(yoy_idx)) if yoy_idx is not None else None

        # 네이버는 forecast → actual 로 컬럼 자체가 갱신되어 같은 분기의 보존된 forecast가 없음.
        # → 정확한 EPS 서프라이즈 산출 불가. null.
        # (Step 4의 스냅샷 시스템에서 채워질 예정)
        surprise = None

        return {
            "epsForecast": eps_forecast,
            "epsActual": eps_actual,
            "epsPreviousYoY": eps_yoy,
            "revenueForecast": rev_forecast,
            "revenueActual": rev_actual,
            "revenuePreviousYoY": rev_yoy,
            "operatingIncomeForecast": op_forecast,
            "operatingIncomeActual": op_actual,
            "operatingIncomePreviousYoY": op_yoy,
            "surprise": surprise,
        }
    except Exception:
        return empty


# ── 5. 공시 → 캘린더 이벤트 ────────────────────────────────────────────

def infer_quarter_kr(announce_date: date) -> str:
    """발표일 → 'YYQX' (해당 분기는 직전 분기)
    한국은 보통 4월 말 1Q, 7월 말 2Q, 10월 말 3Q, 익년 1~2월 4Q 발표.
    """
    m = announce_date.month
    y = announce_date.year
    if 1 <= m <= 3:
        return f"{(y - 1) % 100:02d}Q4"
    if 4 <= m <= 6:
        return f"{y % 100:02d}Q1"
    if 7 <= m <= 9:
        return f"{y % 100:02d}Q2"
    return f"{y % 100:02d}Q3"


def parse_rcept_time(rcept_no: str) -> str:
    """rcept_no 마지막 6자리는 등록 시각(HHMMSS).
    한국 장 마감 후 공시면 'AMC', 장 시작 전이면 'BMO', 장중이면 'HH:MM'.
    """
    try:
        if len(rcept_no) < 14:
            return "AMC"
        hh = int(rcept_no[8:10])
        mm = int(rcept_no[10:12])
        # 한국 정규장 09:00~15:30
        if hh < 9:
            return "BMO"
        if hh >= 15 and (hh > 15 or mm >= 30):
            return "AMC"
        return f"{hh:02d}:{mm:02d}"
    except Exception:
        return "AMC"


# ── 6. 메인 ────────────────────────────────────────────────────────────

def main():
    today = date.today()
    # KR DART 공시는 등록 시점이 곧 발표일이므로 최근 ~ 오늘 범위 검색
    # (DART는 미래 일자 검색해도 결과 없음)
    search_start = today - timedelta(days=7)
    search_end = today + timedelta(days=2)  # 시간대 차이 안전 마진

    print(f"▶ 한국 실적 캘린더 수집: 검색 {search_start} ~ {search_end}")

    # Step 1: Universe
    universe = build_universe()
    if universe:
        top5_summary = [f"{s['name']}({s['symbol']})" for s in universe[:5]]
        print(f"  Universe 상위 5: {top5_summary}")
        top3_names = [s['name'] for s in universe[:3]]
        if not any('삼성전자' in n or 'SK하이닉스' in n for n in top3_names):
            print(f"  ⚠️ 삼성전자/SK하이닉스가 상위 3에 없음. Universe 정렬 의심!", file=sys.stderr)
    else:
        print(f"  ⚠️ Universe가 비어있음. KRX 로그인 또는 시총 조회 실패 의심", file=sys.stderr)
    code_to_meta = {s["symbol"]: s for s in universe}

    # Step 2: corp_code 매핑
    corp_map = fetch_dart_corp_code_map(list(code_to_meta.keys()))

    # Step 3: 종목별 공시 검색
    bgn = search_start.strftime("%Y%m%d")
    end = search_end.strftime("%Y%m%d")

    events = []
    consensus_attempted = 0
    consensus_succeeded = 0

    for i, s in enumerate(universe, 1):
        stock_code = s["symbol"]
        rank = s["rank"]
        name = s["name"]
        corp_code = corp_map.get(stock_code)
        if not corp_code:
            time.sleep(0.1)
            continue

        items = fetch_disclosures_for_corp(corp_code, bgn, end)
        # 키워드 매칭
        earnings_items = [it for it in items if is_earnings_disclosure(it.get("report_nm", ""))]

        if earnings_items:
            # 가장 최근 1건만 (한 종목이 같은 분기를 여러 번 공시할 수 있으므로)
            earnings_items.sort(key=lambda it: it.get("rcept_dt", ""), reverse=True)
            it = earnings_items[0]
            rcept_dt = it.get("rcept_dt", "")
            if len(rcept_dt) >= 8:
                ev_date = date(int(rcept_dt[:4]), int(rcept_dt[4:6]), int(rcept_dt[6:8]))
                # 14일 안 미래 + 오늘 이후만 (지난 공시는 캘린더에 안 보임)
                if (today - timedelta(days=2)) <= ev_date <= today + timedelta(days=14):
                    consensus_attempted += 1
                    target_q = infer_quarter_kr(ev_date)
                    cdata = fetch_naver_consensus(stock_code, target_quarter=target_q)
                    if cdata.get("epsForecast") or cdata.get("revenueForecast"):
                        consensus_succeeded += 1
                    events.append({
                        "date": ev_date.isoformat(),
                        "dayOfWeek": DAY_OF_WEEK_KR[ev_date.weekday()],
                        "time": parse_rcept_time(it.get("rcept_no", "")),
                        "country": "KR",
                        "symbol": stock_code,
                        "name": name,
                        "marketCapRank": rank,
                        "quarter": infer_quarter_kr(ev_date),
                        "epsForecast": cdata.get("epsForecast"),
                        "epsActual": cdata.get("epsActual"),
                        "epsPreviousYoY": cdata.get("epsPreviousYoY"),
                        "revenueForecast": cdata.get("revenueForecast"),
                        "revenueActual": cdata.get("revenueActual"),
                        "revenuePreviousYoY": cdata.get("revenuePreviousYoY"),
                        "operatingIncomeForecast": cdata.get("operatingIncomeForecast"),
                        "operatingIncomeActual": cdata.get("operatingIncomeActual"),
                        "operatingIncomePreviousYoY": cdata.get("operatingIncomePreviousYoY"),
                        "surprise": cdata.get("surprise"),
                    })

        if i % 10 == 0:
            print(f"  진행: {i}/{len(universe)} (이벤트 {len(events)}건)")
        # DART rate limit 보호
        time.sleep(0.4)

    # 정렬: 날짜 → 시점 → 시총 랭크
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
        "weekStart": (today - timedelta(days=2)).isoformat(),
        "weekEnd": (today + timedelta(days=14)).isoformat(),
        "lastUpdated": today.isoformat(),
        "events": events,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n저장: {OUTPUT_PATH}")
    print(f"  총 이벤트: {len(events)}건")
    print(f"  컨센서스 매핑: {consensus_succeeded}/{consensus_attempted} 종목")


if __name__ == "__main__":
    main()
