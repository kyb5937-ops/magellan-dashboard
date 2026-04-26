"""
한국 종목 코드 → 한국어 회사명 매핑 JSON 생성

KOSPI + KOSDAQ 전체 종목의 한국어 이름을 받아서
public/data/stock-names.json 으로 저장합니다.

[사용법]
1. 명령 프롬프트에서 대시보드 폴더로 이동:
   cd "C:\\Users\\당근\\Desktop\\주식 컨텐츠 사업 프로젝트\\magellan-dashboard-step3\\magellan-dashboard"

2. 이 스크립트 실행:
   python generate_stock_names.py

3. 1~2분 대기

4. 생성 완료되면 git 으로 올림:
   git add public/data/stock-names.json
   git commit -m "한국 종목명 매핑 추가"
   git push

[필요 패키지]
pykrx (대부분 이미 설치되어 있을 것)
없으면: pip install pykrx
"""

import os
import json
from pykrx import stock

# 출력 위치 (현재 폴더 기준)
OUTPUT_PATH = os.path.join("public", "data", "stock-names.json")


def main():
    print("▶ 한국 종목명 매핑 생성 시작\n")

    mapping = {}

    # KOSPI
    print("[1/2] KOSPI 종목 리스트 조회 중...")
    kospi_tickers = stock.get_market_ticker_list(market="KOSPI")
    print(f"   {len(kospi_tickers)} 개 종목")

    for i, ticker in enumerate(kospi_tickers, 1):
        try:
            name = stock.get_market_ticker_name(ticker)
            mapping[ticker] = name
            if i % 100 == 0:
                print(f"   진행: {i}/{len(kospi_tickers)}")
        except Exception as e:
            print(f"   ⚠️ {ticker} 실패: {e}")

    # KOSDAQ
    print(f"\n[2/2] KOSDAQ 종목 리스트 조회 중...")
    kosdaq_tickers = stock.get_market_ticker_list(market="KOSDAQ")
    print(f"   {len(kosdaq_tickers)} 개 종목")

    for i, ticker in enumerate(kosdaq_tickers, 1):
        try:
            name = stock.get_market_ticker_name(ticker)
            mapping[ticker] = name
            if i % 200 == 0:
                print(f"   진행: {i}/{len(kosdaq_tickers)}")
        except Exception as e:
            print(f"   ⚠️ {ticker} 실패: {e}")

    # 폴더 생성 + 저장
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 완료: {len(mapping)} 개 종목 매핑")
    print(f"   파일: {os.path.abspath(OUTPUT_PATH)}")
    print(f"\n다음 단계:")
    print(f"   git add {OUTPUT_PATH}")
    print(f'   git commit -m "한국 종목명 매핑 추가"')
    print(f"   git push")


if __name__ == "__main__":
    main()
