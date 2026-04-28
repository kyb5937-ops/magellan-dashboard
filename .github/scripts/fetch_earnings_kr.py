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
PREFERRED_PATTERN = re.compile(r"우[0-9]?[A-Z]?$|\(우\)$")


def is_preferred_share(name: str) -> bool:
    """우선주(005935 삼성전자우 등) 여부. 보통주만 universe에 포함하기 위함."""
    if not name:
        return False
    return bool(PREFERRED_PATTERN.search(name))


def _fetch_market_cap_with_fallback():
    """오늘부터 거꾸로 영업일 시총 데이터 시도. (기준일, kospi_df, kosdaq_df) 반환.
    pykrx의 get_market_cap_by_ticker는 KRX 로그인 필요 (KRX_ID/KRX_PW 환경변수)."""
    for offset in range(0, 10):
        d = (date.today() - timedelta(days=offset)).strftime("%Y%m%d")
        try:
            df_k = stock.get_market_cap_by_ticker(d, market="KOSPI")
            if df_k is None or df_k.empty:
                continue
            df_q = stock.get_market_cap_by_ticker(d, market="KOSDAQ")
            return d, df_k, df_q
        except Exception:
            continue
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

    # 시총 내림차순 정렬, 상위 100
    rows.sort(key=lambda r: r["mcap"], reverse=True)
    top100 = rows[:100]

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

def fetch_naver_consensus(stock_code: str):
    """네이버 종목 페이지 '기업실적분석' 테이블에서 다음 분기 EPS·매출 추정 추출.

    테이블 구조:
    - 컨테이너: div.section.cop_analysis
    - thead 1행: 카테고리 (연간 / 분기)
    - thead 2행: 실제 분기 라벨 (마지막에 'YYYY.MM (E)' = 다가올 분기 추정치)
    - tbody: 행마다 '매출액(억원)', '영업이익(억원)', 'EPS(원)' 등 행 + 10개 td

    실패 시 (None, None) 반환.
    """
    try:
        url = f"https://finance.naver.com/item/main.naver?code={stock_code}"
        r = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept-Language": "ko-KR,ko;q=0.9",
        })
        if r.status_code != 200:
            return (None, None)
        soup = BeautifulSoup(r.text, "html.parser")
        section = soup.select_one("div.section.cop_analysis")
        if section is None:
            return (None, None)
        table = section.find("table")
        if table is None:
            return (None, None)

        thead = table.find("thead")
        if thead is None:
            return (None, None)
        thead_rows = thead.find_all("tr")
        if len(thead_rows) < 2:
            return (None, None)
        # 2번째 row의 th들이 실제 분기 라벨
        col_headers = thead_rows[1].find_all("th")
        # 가장 마지막의 (E) 표기된 컬럼 = 다가올 분기 추정치
        future_idx = None
        for i, th in enumerate(col_headers):
            em = th.find("em")
            if em and "E" in em.get_text():
                future_idx = i
        if future_idx is None:
            return (None, None)

        eps_val = None
        rev_val = None
        tbody = table.find("tbody")
        if tbody is None:
            return (None, None)
        for tr in tbody.find_all("tr"):
            label_th = tr.find("th")
            if not label_th:
                continue
            label = label_th.get_text(strip=True)
            tds = tr.find_all("td")
            if future_idx >= len(tds):
                continue
            cell = tds[future_idx].get_text(strip=True).replace(",", "")
            if not cell or cell in ("-", "—", "N/A"):
                continue
            if "EPS" in label and eps_val is None:
                eps_val = cell
            elif "매출액" in label and rev_val is None:
                rev_val = cell

        eps_str = None
        if eps_val:
            try:
                eps_str = f"{int(float(eps_val)):,}원"
            except ValueError:
                pass
        rev_str = None
        if rev_val:
            try:
                rev_num = float(rev_val)
                if rev_num >= 10000:
                    rev_str = f"{rev_num / 10000:.1f}조원"
                else:
                    rev_str = f"{int(rev_num):,}억원"
            except ValueError:
                pass
        return (eps_str, rev_str)
    except Exception:
        return (None, None)


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
                if today <= ev_date <= today + timedelta(days=14):
                    consensus_attempted += 1
                    eps_fcast, rev_fcast = fetch_naver_consensus(stock_code)
                    if eps_fcast or rev_fcast:
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
                        "epsForecast": eps_fcast,
                        "epsPrevious": None,
                        "revenueForecast": rev_fcast,
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
        "weekStart": today.isoformat(),
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
