"""
한국 시총 100 종목의 컨센서스(네이버 분기 forecast) 일일 스냅샷 누적

[목적]
네이버 컨센서스는 발표 후 forecast가 actual로 덮어써져서 같은 분기의
"발표 직전 forecast"를 보존할 수 없음. → 매일 스냅샷을 별도 파일에 누적해서
발표 시 과거 스냅샷에서 forecast를 찾아 surprise 계산.

[입력]
- public/data/stock-symbols-100-kr.json (universe)

[출력]
- public/data/consensus-snapshots-kr.json
  구조:
  {
    "lastUpdated": "YYYY-MM-DD",
    "snapshots": {
      "005930": {                     # 종목코드
        "26Q1": {                     # 분기 라벨
          "history": [
            {                         # 일별 스냅샷 (날짜+값 페어)
              "date": "2026-04-15",
              "epsForecast": 1080.0,           # 원
              "revenueForecast": 750000.0,     # 억원
              "operatingIncomeForecast": 80000.0  # 억원
            },
            ...
          ]
        }
      }
    }
  }

[중복 처리]
- 같은 (종목, 분기, 날짜) 항목이 이미 있으면 덮어쓰기
- 없으면 새로 추가

[참고]
- 매일 KST 09:00 (UTC 00:00) cron으로 실행
- 처음 한 달 정도는 history 누적 안 되어 surprise 빈 값 (정상)
"""

import os
import sys
import json
import re
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.getcwd()
UNIVERSE_PATH = os.path.join(ROOT, "public", "data", "stock-symbols-100-kr.json")
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "consensus-snapshots-kr.json")


def _quarter_label_from_naver_header(text: str):
    """네이버 헤더 텍스트(예: '2025.12', '2026.03 (E)') → 'YYQX'."""
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


def _to_float(s):
    """네이버 셀 텍스트(쉼표 제거 가능) → float, 실패 시 None."""
    if not s:
        return None
    try:
        return float(s.replace(",", ""))
    except (TypeError, ValueError):
        return None


def fetch_forecast_columns(stock_code: str):
    """네이버 종목 페이지에서 (E) 표시된 분기 컬럼들의 raw 값을 추출.

    반환:
      dict[quarter_label, {epsForecast: float|None, revenueForecast: float|None,
                            operatingIncomeForecast: float|None}]

    실패 시 빈 dict.
    """
    out = {}
    try:
        url = f"https://finance.naver.com/item/main.naver?code={stock_code}"
        r = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept-Language": "ko-KR,ko;q=0.9",
        })
        if r.status_code != 200:
            return out
        soup = BeautifulSoup(r.text, "html.parser")
        section = soup.select_one("div.section.cop_analysis")
        if section is None:
            return out
        table = section.find("table")
        if table is None:
            return out

        thead = table.find("thead")
        if thead is None:
            return out
        thead_rows = thead.find_all("tr")
        if len(thead_rows) < 2:
            return out
        col_headers = thead_rows[1].find_all("th")

        # (E) 표시된 컬럼 + 분기 라벨 매핑
        forecast_cols = {}  # idx → quarter_label
        for i, th in enumerate(col_headers):
            text = th.get_text(strip=True)
            ql = _quarter_label_from_naver_header(text)
            em = th.find("em")
            is_estimate = bool(em and "E" in em.get_text())
            if ql and is_estimate:
                forecast_cols[i] = ql

        if not forecast_cols:
            return out

        tbody = table.find("tbody")
        if tbody is None:
            return out

        eps_cells = {}
        rev_cells = {}
        op_cells = {}
        for tr in tbody.find_all("tr"):
            label_th = tr.find("th")
            if not label_th:
                continue
            label = label_th.get_text(strip=True)
            tds = tr.find_all("td")
            norm = label.replace(" ", "").replace("(", "").replace(")", "").replace(":", "")
            if norm in ("EPS", "EPS원"):
                target = eps_cells
            elif norm == "매출액":
                target = rev_cells
            elif norm == "영업이익":
                target = op_cells
            else:
                continue
            for i, td in enumerate(tds):
                cell = td.get_text(strip=True)
                if cell and cell not in ("-", "—", "N/A"):
                    target[i] = cell

        for idx, ql in forecast_cols.items():
            out[ql] = {
                "epsForecast": _to_float(eps_cells.get(idx)),
                "revenueForecast": _to_float(rev_cells.get(idx)),
                "operatingIncomeForecast": _to_float(op_cells.get(idx)),
            }
    except Exception as e:
        print(f"  ⚠️ {stock_code} 스크래핑 실패: {e}", file=sys.stderr)
        return {}
    return out


def load_existing_snapshots():
    if not os.path.exists(OUTPUT_PATH):
        return {"snapshots": {}}
    try:
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "snapshots" not in data:
            data["snapshots"] = {}
        return data
    except Exception as e:
        print(f"  ⚠️ 기존 스냅샷 파일 읽기 실패 (새로 시작): {e}", file=sys.stderr)
        return {"snapshots": {}}


def upsert_history(history, today_str, values):
    """history 리스트에 (today_str) 항목 upsert.
    values 셋이 모두 None이면 추가하지 않음.
    """
    if all(v is None for v in (
        values.get("epsForecast"),
        values.get("revenueForecast"),
        values.get("operatingIncomeForecast"),
    )):
        return False
    entry = {"date": today_str, **values}
    for i, h in enumerate(history):
        if h.get("date") == today_str:
            history[i] = entry
            return True
    history.append(entry)
    history.sort(key=lambda e: e.get("date", ""))
    return True


def main():
    today = date.today()
    today_str = today.isoformat()

    print(f"▶ 한국 컨센서스 스냅샷: {today_str}")

    if not os.path.exists(UNIVERSE_PATH):
        print(f"  ⚠️ universe 파일 없음: {UNIVERSE_PATH}", file=sys.stderr)
        print(f"  → fetch_earnings_kr.py를 먼저 실행하거나 매핑 파일 확인 필요", file=sys.stderr)
        return

    with open(UNIVERSE_PATH, "r", encoding="utf-8") as f:
        universe = json.load(f)

    stocks = universe.get("stocks", [])
    print(f"  Universe: {len(stocks)}종목")

    data = load_existing_snapshots()
    snapshots = data["snapshots"]

    new_or_updated = 0
    stocks_with_data = 0
    for i, s in enumerate(stocks, 1):
        sym = s["symbol"]
        forecasts = fetch_forecast_columns(sym)
        if forecasts:
            stocks_with_data += 1
        for q_label, vals in forecasts.items():
            sym_node = snapshots.setdefault(sym, {})
            q_node = sym_node.setdefault(q_label, {"history": []})
            history = q_node.setdefault("history", [])
            if upsert_history(history, today_str, vals):
                new_or_updated += 1

        if i % 10 == 0:
            print(f"  진행: {i}/{len(stocks)} (데이터 있는 종목 {stocks_with_data})")

        # 네이버 부하 보호
        time.sleep(0.4)

    data["lastUpdated"] = today_str

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 저장: {OUTPUT_PATH}")
    print(f"   업데이트된 (종목,분기) 항목: {new_or_updated}")
    print(f"   데이터 있는 종목: {stocks_with_data}/{len(stocks)}")


if __name__ == "__main__":
    main()
