"""
GitHub Actions 환경에서 실행되는 시장 데이터 자동 수집 스크립트

기존 사용자 PC의 get_market_flow_v7.py 와 동일한 로직.
차이점:
  - 날짜를 환경변수 TARGET_DATE 에서 받음 (input() 제거)
  - KRX 로그인 정보를 환경변수에서 받음
  - 대시보드 경로 = 현재 디렉터리 (GitHub 저장소 루트)
  - 자동 종료 (input() 대기 없음)

[2026-06 추가] 코스피·코스닥 본 지수의 KRX 공식 종가/등락률을
  public/data/index-kr.json 으로 함께 저장한다.
  (Yahoo가 특정 거래일 데이터를 누락해 등락률이 깨지는 문제의 근본 처방)
"""

import os
import json
import sys
from datetime import datetime, timedelta, timezone
import pandas as pd

# ── 환경변수에서 받기 ──
TARGET_DATE = os.environ.get("TARGET_DATE")
if not TARGET_DATE:
    print("❌ TARGET_DATE 환경변수가 없습니다", file=sys.stderr)
    sys.exit(1)

# KRX 로그인 정보는 환경변수에 이미 설정되어 있음 (workflow에서 export)
if not os.environ.get("KRX_ID") or not os.environ.get("KRX_PW"):
    print("❌ KRX_ID 또는 KRX_PW 환경변수가 없습니다", file=sys.stderr)
    sys.exit(1)

from pykrx import stock

# ── 대시보드 JSON 출력 위치 (저장소 루트 기준) ──
DASHBOARD_PATH = os.getcwd()

INSTITUTIONS = ['은행', '금융투자', '보험', '투신', '사모', '기타금융', '연기금']

# 코스피·코스닥 본 지수 티커 (KRX 표준)
INDEX_TICKERS = {
    "kospi": "1001",   # 코스피 종합
    "kosdaq": "2001",  # 코스닥 종합
}

KOSPI_SECTOR_CODES = [
    "1005", "1006", "1007", "1008", "1009", "1010", "1011", "1012",
    "1013", "1014", "1015", "1016", "1017", "1018", "1019", "1020",
    "1021", "1024", "1025", "1026", "1045", "1046", "1047",
]

KOSDAQ_SECTOR_CODES = [
    "2012", "2026", "2027", "2029", "2031", "2037", "2056", "2058",
    "2062", "2063", "2065", "2066", "2067", "2068", "2070", "2072",
    "2074", "2075", "2077", "2114", "2118",
]


def fetch_market_flow(date, market):
    df_sell = stock.get_market_trading_value_by_date(
        date, date, market, detail=True, on='매도'
    )
    df_buy = stock.get_market_trading_value_by_date(
        date, date, market, detail=True, on='매수'
    )
    df_net = stock.get_market_trading_value_by_date(
        date, date, market, detail=True, on='순매수'
    )
    return df_sell, df_buy, df_net


def format_amount(val):
    return round(val / 100_000_000, 1)


def get_investor_data(df_sell, df_buy, df_net, inv_key):
    try:
        return {
            "sell": format_amount(df_sell[inv_key].iloc[0]),
            "buy": format_amount(df_buy[inv_key].iloc[0]),
            "net": format_amount(df_net[inv_key].iloc[0]),
        }
    except KeyError:
        return None


def get_institution_total(df_sell, df_buy, df_net):
    sell_total = buy_total = net_total = 0
    for inst in INSTITUTIONS:
        if inst in df_sell.columns:
            sell_total += df_sell[inst].iloc[0]
            buy_total += df_buy[inst].iloc[0]
            net_total += df_net[inst].iloc[0]
    return {
        "sell": format_amount(sell_total),
        "buy": format_amount(buy_total),
        "net": format_amount(net_total),
    }


_change_pct_cache = {}


def _previous_business_day(date_str):
    """date_str(YYYYMMDD) 직전 영업일을 KRX 캘린더 기준으로 반환.

    get_nearest_business_day_in_a_week 가 'on/before' 동작이라
    (date - 1) 을 넘기면 자연스럽게 직전 영업일을 돌려준다.
    """
    d = datetime.strptime(date_str, "%Y%m%d") - timedelta(days=1)
    return stock.get_nearest_business_day_in_a_week(d.strftime("%Y%m%d"))


def _change_pct_map(date, market):
    """{종목코드: 전일 종가比 등락률(%)} 캐시.

    Why: get_market_ohlcv(date, market=) 은 등락률 컬럼을 제공하지 않아
    이전 구현은 (종가-시가)/시가 의 "당일 시가比" 폴백으로 잘못 표시했다
    (2026-06-11 삼성전자 -1.16% / +1.15% 사고). 전 영업일 OHLCV 와 비교해
    (당일종가 - 전일종가)/전일종가 로 KRX 공식 일간 등락률을 산출한다.
    시장당 OHLCV 2회 호출만 추가되며, 동일 (date, market) 은 외국인/기관/
    개인 호출 사이에 캐시 재사용.
    """
    key = (date, market)
    if key in _change_pct_cache:
        return _change_pct_cache[key]

    prev_bd = _previous_business_day(date)
    df_today = stock.get_market_ohlcv(date, market=market)
    df_prev = stock.get_market_ohlcv(prev_bd, market=market)

    cmap = {}
    for code in df_today.index:
        try:
            cc = float(df_today.loc[code, '종가'])
            if code not in df_prev.index:
                continue
            pc = float(df_prev.loc[code, '종가'])
            if pc > 0:
                cmap[code] = round((cc - pc) / pc * 100, 2)
        except (KeyError, ValueError):
            continue

    _change_pct_cache[key] = cmap
    return cmap


def get_top_stocks(date, market, investor, top_n=10):
    df = stock.get_market_net_purchases_of_equities(
        date, date, market, investor
    )
    if df is None or df.empty:
        return {"buy": [], "sell": []}

    # 전일 종가比 KRX 공식 등락률 (시가比 폴백 제거)
    change_map = _change_pct_map(date, market)

    name_map = {}
    for code in df.index:
        try:
            name_map[code] = stock.get_market_ticker_name(code)
        except Exception:
            name_map[code] = code

    net_col = None
    for col in ['순매수거래대금', '순매수']:
        if col in df.columns:
            net_col = col
            break
    if net_col is None:
        return {"buy": [], "sell": []}

    items = []
    for code, row in df.iterrows():
        items.append({
            "code": code,
            "name": name_map.get(code, code),
            "change_pct": round(float(change_map.get(code, 0)), 2),
            "amount": format_amount(row[net_col]),
        })

    buy_top = sorted(items, key=lambda x: x['amount'], reverse=True)[:top_n]
    sell_top = sorted(items, key=lambda x: x['amount'])[:top_n]
    return {"buy": buy_top, "sell": sell_top}


def fetch_index_quote(date, code):
    """코스피·코스닥 본 지수의 KRX 공식 종가 + 전일 대비 등락률.

    get_sector_changes()와 동일한 검증된 패턴:
      14일 윈도우를 받아 마지막 두 거래일 종가로 등락률을 계산한다.
    Yahoo와 달리 KRX는 거래일을 누락하지 않으므로 전일 종가가 항상 정확하다.
    """
    target = datetime.strptime(date, "%Y%m%d")
    start = target - timedelta(days=14)
    start_str = start.strftime("%Y%m%d")

    df = stock.get_index_ohlcv_by_date(start_str, date, code)
    if df is None or len(df) < 2:
        return None

    prev_close = float(df['종가'].iloc[-2])
    curr_close = float(df['종가'].iloc[-1])
    last_date = df.index[-1].strftime("%Y-%m-%d")

    if prev_close == 0:
        return None

    change_pct = (curr_close - prev_close) / prev_close * 100
    change_pt = curr_close - prev_close

    return {
        "value": round(curr_close, 2),
        "change_pct": round(float(change_pct), 2),
        "change_pt": round(float(change_pt), 2),
        "prevClose": round(prev_close, 2),
        "tradeDate": last_date,
    }


def get_sector_changes(date, sector_codes):
    """전일 종가 대비 등락률 (KRX 표준)"""
    target = datetime.strptime(date, "%Y%m%d")
    start = target - timedelta(days=14)
    start_str = start.strftime("%Y%m%d")

    items = []
    for code in sector_codes:
        try:
            df = stock.get_index_ohlcv_by_date(start_str, date, code)
            if df is None or len(df) < 2:
                continue

            prev_close = df['종가'].iloc[-2]
            curr_close = df['종가'].iloc[-1]

            if prev_close == 0:
                continue

            change_pct = (curr_close - prev_close) / prev_close * 100
            name = stock.get_index_ticker_name(code)

            items.append({
                "code": code,
                "name": name,
                "change_pct": round(float(change_pct), 2),
            })
        except Exception as e:
            print(f"  ⚠️ 업종 {code} 조회 실패: {e}", file=sys.stderr)

    items.sort(key=lambda x: x['change_pct'], reverse=True)
    return items


def main():
    date = TARGET_DATE
    print(f"▶ {date} 데이터 수집 시작")

    # ── 시장 전체 매매동향 ──
    print(f"  [1/6] KOSPI 매매동향...")
    kospi_sell, kospi_buy, kospi_net = fetch_market_flow(date, "KOSPI")

    print(f"  [2/6] KOSDAQ 매매동향...")
    kosdaq_sell, kosdaq_buy, kosdaq_net = fetch_market_flow(date, "KOSDAQ")

    # 데이터가 비어있는 경우 (휴장일 등) → 종료
    if kospi_sell.empty:
        print(f"❌ {date} 데이터 없음 (휴장일?). 갱신 건너뜀")
        sys.exit(0)

    # ── 종목 TOP10 ──
    print(f"  [3/6] KOSPI 종목 TOP10...")
    kospi_top = {
        "외국인": get_top_stocks(date, "KOSPI", "외국인"),
        "기관": get_top_stocks(date, "KOSPI", "기관합계"),
        "개인": get_top_stocks(date, "KOSPI", "개인"),
    }

    print(f"  [4/6] KOSDAQ 종목 TOP10...")
    kosdaq_top = {
        "외국인": get_top_stocks(date, "KOSDAQ", "외국인"),
        "기관": get_top_stocks(date, "KOSDAQ", "기관합계"),
        "개인": get_top_stocks(date, "KOSDAQ", "개인"),
    }

    # ── 업종 등락률 ──
    print(f"  [5/6] KOSPI 업종 ({len(KOSPI_SECTOR_CODES)}개)...")
    kospi_sectors = get_sector_changes(date, KOSPI_SECTOR_CODES)

    print(f"  [6/6] KOSDAQ 업종 ({len(KOSDAQ_SECTOR_CODES)}개)...")
    kosdaq_sectors = get_sector_changes(date, KOSDAQ_SECTOR_CODES)

    # ── 데이터 정리 ──
    investors = ['은행', '금융투자', '보험', '투신', '사모', '기타금융',
                 '연기금', '기관합계', '외국인', '개인', '기타법인']

    json_data = {
        "date": date,
        "unit": "억원",
        "kospi": {},
        "kosdaq": {},
        "top": {
            "kospi": kospi_top,
            "kosdaq": kosdaq_top,
        },
        "sectors": {
            "kospi": kospi_sectors,
            "kosdaq": kosdaq_sectors,
        },
    }

    for inv in investors:
        if inv == '기관합계':
            k = get_institution_total(kospi_sell, kospi_buy, kospi_net)
            q = get_institution_total(kosdaq_sell, kosdaq_buy, kosdaq_net)
        else:
            k = get_investor_data(kospi_sell, kospi_buy, kospi_net, inv)
            q = get_investor_data(kosdaq_sell, kosdaq_buy, kosdaq_net, inv)

        if k:
            json_data["kospi"][inv] = k
        if q:
            json_data["kosdaq"][inv] = q

    # ── JSON 저장 ──
    json_dir = os.path.join(DASHBOARD_PATH, "public", "data")
    os.makedirs(json_dir, exist_ok=True)
    json_filepath = os.path.join(json_dir, "market-flow.json")
    with open(json_filepath, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)

    print(f"✅ JSON 저장: {json_filepath}")
    print(f"   KOSPI 업종: {len(kospi_sectors)}개")
    print(f"   KOSDAQ 업종: {len(kosdaq_sectors)}개")

    # ── 코스피·코스닥 본 지수 (KRX 공식 종가) ──
    # 별도 파일 public/data/index-kr.json 으로 저장. 대시보드가 이 파일을 읽어
    # 코스피·코스닥 카드의 값/등락률을 Yahoo 대신 KRX 공식치로 표시한다.
    print(f"  [지수] 코스피·코스닥 종가 수집...")
    index_data = {
        "date": date,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    for key, code in INDEX_TICKERS.items():
        try:
            q = fetch_index_quote(date, code)
            if q:
                index_data[key] = q
                print(f"    {key}: {q['value']} ({q['change_pct']:+.2f}%) "
                      f"[전일 {q['prevClose']}, {q['tradeDate']}]")
            else:
                print(f"    ⚠️ {key} 지수 데이터 부족 — skip", file=sys.stderr)
        except Exception as e:
            print(f"    ⚠️ {key} 지수 조회 실패: {e}", file=sys.stderr)

    # 둘 중 하나라도 받았을 때만 파일을 갱신 (둘 다 실패 시 기존 파일 보존)
    if "kospi" in index_data or "kosdaq" in index_data:
        index_filepath = os.path.join(json_dir, "index-kr.json")
        with open(index_filepath, "w", encoding="utf-8") as f:
            json.dump(index_data, f, ensure_ascii=False, indent=2)
        print(f"✅ 지수 JSON 저장: {index_filepath}")
    else:
        print("⚠️ 코스피·코스닥 둘 다 실패 — index-kr.json 갱신 안 함", file=sys.stderr)


if __name__ == "__main__":
    main()
