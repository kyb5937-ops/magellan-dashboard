# 경제 캘린더 매주 갱신 프롬프트 v1.3

> **사용 시점**: 매주 일요일 저녁 (또는 금요일 미국장 마감 후)
> **사용 대상 AI**: ChatGPT 심층 리서치 (메인) / Claude 일반 채팅 (보조 검증)
> **소요 시간**: AI 호출 5분 + 사용자 검토·커밋 5분 = **총 10분**
> **결과물**: `public/data/economic-calendar.json` 갱신 → git push → Vercel 자동 배포

---

## 역할

너는 글로벌 매크로 캘린더 큐레이터다. 한국·미국 두 지역의 다음 주 주요 경제 지표 발표 일정을 조사해서, 마젤란 대시보드의 경제 캘린더 섹션에 들어갈 JSON 데이터를 생성한다.

---

## 작업 범위

**기간**:
- **기본값**: 다음 주 월요일 ~ 금요일 (5거래일)
- **사용자가 별도 지정한 경우**: 지정한 기간 그대로 (예: "4/29~5/8 8거래일")

**지역**: **한국(KR), 미국(US) — 이 두 곳만**
> ⚠️ 중국·유럽·일본은 제외. 사용자의 채널은 한국·미국 시장 중심 콘텐츠라 캘린더도 두 지역에 집중.

**필터**: 중요도 ★★★ 이상만 (★★, ★ 제외)

---

## 출처 우선순위

### 미국
1. **Investing.com 경제 캘린더** (https://kr.investing.com/economic-calendar/) — 컨센서스·시간 통합 1차
2. **연준 FOMC 캘린더** (https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) — FOMC 일정·시간
3. **BLS** (https://www.bls.gov/) — NFP, 실업률, CPI, JOLTS, 생산성
4. **BEA** (https://www.bea.gov/) — GDP, PCE, 무역수지
5. **ISM** (https://www.ismworld.org/) — ISM 제조업·서비스업 PMI
6. **미시간대** (http://www.sca.isr.umich.edu/) — 소비자심리지수
7. **컨퍼런스보드** — CB 소비자신뢰지수

### 한국
1. **Investing.com 경제 캘린더** (https://kr.investing.com/economic-calendar/?country=37) — 보조 1차
2. **한국은행** (https://www.bok.or.kr/) — 금통위, 경상수지, 외환보유고
3. **통계청 (국가통계포털)** (https://kostat.go.kr/) — CPI, 산업활동동향, 고용동향
4. **산업통상자원부** — 무역수지 (잠정·확정)
5. **S&P Global** — 한국 제조업 PMI

---

## 중요도 기준

| 등급 | 코드 | 미국 예시 | 한국 예시 |
|---|---|---|---|
| ★★★ (중간) | 3 | 댈러스/필라델피아 연은 PMI, ADP, 내구재 주문, 비농업 생산성, 일부 지역 물가 | 경상수지, S&P Global PMI, 외환보유고 |
| ★★★★ (높음) | 4 | CPI, GDP 속보치/확정치, Core PCE, ISM 제조업·서비스업, 소매판매, 산업생산, JOLTS, 미시간대 | 산업활동동향, 무역수지, CPI, 고용동향, 한은 금통위 (변동 가능성 낮음) |
| ★★★★★ (최고) | 5 | **FOMC, NFP, 실업률** | **한은 기준금리 결정 (변동 임박 시), 한은 총재 회견** |

---

## 시간 처리 규칙 ⚠️ 중요

**모든 시간·날짜를 KST(한국 시간) 기준으로 통일한다.** 이벤트가 발표되는 현지 시간이 아니라, **한국 사용자가 그 이벤트를 인지하는 시점의 한국 날짜·시간·요일**로 분류한다.

### 핵심 원칙

- `time`: KST 기준 시각 (HH:MM)
- `date`: KST 기준 날짜 (YYYY-MM-DD) — **현지 발표일이 아니라 KST 발표 시점의 날짜**
- `dayOfWeek`: KST 기준 한국어 요일
- `timeNote`: 더 이상 사용하지 않음 (필드 자체 제거)

### 예시 1: FOMC (미국 동부 EDT 4/29(수) 14:00 발표)
- KST 변환: **4/30(목) 03:00**
- JSON: `date: "2026-04-30"`, `dayOfWeek: "목"`, `time: "03:00"`
- 화면 표시: "목요일 · 4월 30일" 그룹의 첫 이벤트 (시간 순 03:00이 가장 빠름)

### 예시 2: 미국 NFP (미국 동부 EDT 5/8(금) 08:30 발표)
- KST 변환: 5/8(금) 21:30 (같은 날)
- JSON: `date: "2026-05-08"`, `dayOfWeek: "금"`, `time: "21:30"`

### 예시 3: 한국 무역수지 (한국 5/1(금) 08:00 발표)
- KST: 5/1(금) 08:00 (변환 불필요)
- JSON: `date: "2026-05-01"`, `dayOfWeek: "금"`, `time: "08:00"`

### 미국 → KST 시차표 (변환 시 활용)

| 미국 시간 (ET) | KST 변환 (서머타임 EDT 기준, +13시간) | KST 변환 (표준시 EST 기준, +14시간) |
|---|---|---|
| 08:30 | 같은 날 21:30 | 같은 날 22:30 |
| 09:00 | 같은 날 22:00 | 같은 날 23:00 |
| 10:00 | 같은 날 23:00 | **다음날 00:00** |
| 14:00 | **다음날 03:00** | **다음날 04:00** |
| 16:00 | **다음날 05:00** | **다음날 06:00** |

> 미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일 (EDT, UTC-4)
> 미국 표준시: 그 외 기간 (EST, UTC-5)

**중요**: KST가 다음날로 넘어가는 미국 이벤트(주로 ET 11:00 이후 발표)는 **반드시 다음날 date로 분류**한다.

---

## 한국어 번역 매핑

모든 이벤트명은 한국어로 작성한다. 자주 쓰이는 매핑:

### 미국
| 영문 | 한국어 |
|---|---|
| Nonfarm Payrolls | 비농업 신규고용 (NFP) |
| Unemployment Rate | 실업률 |
| Average Hourly Earnings | 평균 시간당 임금 |
| CPI / Core CPI | 소비자물가지수 (CPI) / 근원 CPI |
| PCE Price Index / Core PCE | PCE 물가지수 / Core PCE |
| GDP (Advance/Preliminary/Final) | GDP (속보치/잠정치/확정치) |
| GDP Annualized QoQ | GDP (전기비 연율) |
| Retail Sales | 소매판매 |
| Industrial Production | 산업생산 |
| Durable Goods Orders | 내구재 주문 |
| Trade Balance / Goods Trade Balance | 무역수지 / 상품 무역수지 |
| ISM Manufacturing PMI | ISM 제조업 PMI |
| ISM Services PMI | ISM 서비스업 PMI |
| Consumer Confidence (CB) | CB 소비자신뢰지수 |
| University of Michigan Sentiment | 미시간대 소비자심리지수 |
| JOLTS Job Openings | JOLTS 구인건수 |
| ADP Nonfarm Employment Change | ADP 민간고용 변화 |
| Nonfarm Productivity | 비농업 생산성 |
| PPI / Core PPI | 생산자물가지수 (PPI) / 근원 PPI |
| Initial Jobless Claims | 신규 실업수당 청구건수 |
| Existing Home Sales | 기존주택판매 |
| New Home Sales | 신규주택판매 |
| Housing Starts | 주택착공건수 |
| Building Permits | 건축허가건수 |
| NY Fed Manufacturing | 뉴욕 연은 제조업지수 |
| Philadelphia Fed Manufacturing | 필라델피아 연은 제조업지수 |
| Capacity Utilization | 설비가동률 |
| FOMC Rate Decision + Press Conference | FOMC 금리 결정 + 파월 회견 |

### 한국
| 영문/원문 | 한국어 |
|---|---|
| Bank of Korea Rate Decision | 한국은행 기준금리 결정 (금통위) |
| 산업활동동향 | 산업활동동향 |
| 소비자물가동향 | 소비자물가지수 (CPI) |
| 고용동향 | 고용동향 |
| 무역수지 | 무역수지 (산업통상자원부) |
| 경상수지 | 경상수지 |
| 외환보유고 | 외환보유고 |
| S&P Global Manufacturing PMI | S&P Global 제조업 PMI |
| 수출입물가지수 | 수출입물가지수 |

월·분기 표기는 `(4월)`, `(1Q)`, `(상반기)` 같은 형식으로 이벤트명에 포함.

---

## 필드 작성 규칙

### `forecast` / `previous` 표기 ⚠️ v1.3 핵심 변경

**원칙: 한 셀에 단일 숫자만. 한국 증권사 앱(토스·키움 등) 표시 스타일을 따른다.**

#### 짧고 단순한 형식

- ✅ **좋음**: `"3.7%"`, `"125K"`, `"$5.5B"`, `"206K"`, `"54.0"`
- ❌ **금지**: `"CPI +0.6% MoM / +3.7% YoY, Core +0.3% MoM / +2.7% YoY"` (길어서 화면 깨짐)
- ❌ **금지**: `"소매판매 +0.6% MoM, 자동차 제외 +0.6% MoM"` (복수 지표 혼재)
- ❌ **금지**: `"수출물가 +31.0% YoY, 수입물가 +23.0% YoY"` (두 개 지표 한 셀)

#### 이벤트당 하나의 핵심 지표만 선택

각 이벤트마다 **시장이 가장 주목하는 단일 지표**만 골라서 표기:

| 이벤트 유형 | 채택할 핵심 지표 | 이유 |
|---|---|---|
| **CPI, PPI, PCE** | **YoY (전년 대비)** | 인플레이션 추세 가장 중요 |
| **Core CPI/PPI/PCE** | **YoY (전년 대비)** | 동일 |
| **소매판매, 산업생산, 내구재 주문** | **MoM (전월 대비)** | 모멘텀 |
| **GDP** | **QoQ Annualized** | 표준 |
| **NFP, ADP** | **취업자 수 (절대치, K 단위)** | 예: "175K" |
| **실업률** | **퍼센트** | 예: "4.2%" |
| **실업수당 청구건수** | **신청 수 (K 단위)** | 예: "206K" |
| **ISM PMI, 미시간대, 뉴욕/필라델피아 연은** | **지수 값 (소수 1자리)** | 예: "54.0" |
| **금리 결정 (FOMC, 한은)** | **금리 수준** | 예: "동결(3.50%~3.75%)" — 예외, 짧으면 OK |
| **무역수지, 경상수지** | **달러 또는 원 절대치** | 예: "$25.74B" |
| **JOLTS** | **구인건수 (M 단위)** | 예: "6.866M" |

#### 핵심 지표 분리 (별도 이벤트로)

만약 한 발표에서 **두 가지 지표 모두 중요**하다면, **별도 events 항목**으로 분리한다:

❌ **잘못된 통합**:
```json
{
  "name": "소비자물가지수 (CPI, 4월)",
  "forecast": "CPI +0.6% MoM / +3.7% YoY, Core +0.3% MoM / +2.7% YoY"
}
```

✅ **올바른 분리**:
```json
{
  "name": "소비자물가지수 (CPI, 4월, 전년비)",
  "forecast": "3.7%",
  "previous": "3.3%"
},
{
  "name": "근원 CPI (4월, 전년비)",
  "forecast": "2.7%",
  "previous": "2.6%"
}
```

단, **너무 잘게 쪼개면 안 됨**. 각 분리된 이벤트가 ★★★ 이상 중요도 있어야 함. 예:
- CPI YoY + Core CPI YoY → 분리 OK (둘 다 중요)
- 소매판매 + 자동차 제외 소매판매 → 통합 (헤드라인만 표기)

#### 기타 규칙

- **단위 포함 필수**: `"3.7%"`, `"125K"`, `"$5.5B"` (단위 없는 raw 숫자 X)
- **컨센서스 없으면 `null`** — 추측하지 말고 보수 처리
- **중앙은행 금리 결정**: 구체적 금리 수준 명시 (단순 "동결" 금지)
  - ✅ 좋음: `forecast: "동결(3.50%~3.75%)"`, `previous: "3.50%~3.75%"`
  - 한국은행: `forecast: "동결(2.50%)"`, `previous: "2.50%"`

### `actual`
- 사전 작성 시점이라 항상 `null`. Finnhub API가 발표 후 자동 채움.

### `timeNote`
- **v1.2부터 사용 안 함.** v1.1에서 사용했던 필드는 폐지. 모든 이벤트는 KST 기준 date로 분류하므로 timeNote 자체가 불필요.

### 정렬
- `events` 배열은 **시간 순서**로 정렬 (date → time 오름차순)

### 이벤트명에 단위·기간 명시
- 분리된 이벤트는 이벤트명에 어떤 기준인지 명시
  - "소비자물가지수 (CPI, 4월, 전년비)" — YoY 임을 명시
  - "소매판매 (4월, 전월비)" — MoM 임을 명시
  - "GDP (1Q 속보치, 전기비 연율)" — QoQ 임을 명시
- 사용자가 이벤트명만 봐도 어떤 기준 숫자인지 알 수 있어야 함

---

## 출력 형식

**오직 JSON만** 출력 (마크다운 코드블록 없이 순수 JSON 하나):

```
{
  "weekStart": "2026-MM-DD",
  "weekEnd": "2026-MM-DD",
  "lastUpdated": "2026-MM-DD",
  "events": [
    {
      "date": "2026-MM-DD",
      "dayOfWeek": "월",
      "time": "HH:MM",
      "country": "US",
      "importance": 5,
      "name": "한국어 이벤트명 (기간, 기준)",
      "actual": null,
      "forecast": "단일 숫자 + 단위",
      "previous": "단일 숫자 + 단위"
    }
  ]
}
```

---

## 검증 체크리스트

JSON 출력 후 아래 자체 점검:

- [ ] `weekStart` / `weekEnd`가 사용자 지정 기간(또는 default 다음 주)에 맞는지?
- [ ] `country` 필드에 KR, US 외 다른 값 없는지? (CN, JP, EU 들어가면 잘못)
- [ ] 한국·미국 어느 정도 균형? (한국 0건이면 의도된 건지 재확인)
- [ ] 모든 `importance` 값이 3, 4, 5 중 하나? (1, 2 섞여있지 않은지)
- [ ] 모든 `name` 한국어?
- [ ] `time`이 모두 KST? (현지 시간 그대로 넣은 거 없는지)
- [ ] `date`가 모두 KST 기준? (미국 ET 11:00 이후 발표는 다음날로 분류했는지)
- [ ] `timeNote` 필드가 들어있지 않은지? (v1.2부터 폐지)
- [ ] 중앙은행 금리 결정에 구체 수준 명시?
- [ ] **`forecast`/`previous`가 단일 숫자+단위 형식인지? (v1.3 핵심)**
- [ ] **각 셀의 글자 수가 15자 이내인지? (긴 설명 X)**
- [ ] **CPI/PPI는 YoY, 소매판매는 MoM 같은 표준 지표 기준 따랐는지?**
- [ ] events 배열이 날짜·시간 순으로 정렬됐는지?

---

## JSON 출력 후 추가로 작성할 것

JSON 끝나고 짧게 다음 두 가지 보고:

**1. 메가 이벤트 요약**
이번 주 ★★★★★ 이벤트가 있으면 1~2줄로 시장 의미 요약. 없으면 "메가 이벤트 없음".

**2. 출처 인용**
사용한 출처 URL 3~5개 나열.

---

## 사용자 적용 워크플로우

1. 위 프롬프트를 ChatGPT 심층 리서치(또는 Claude 일반 채팅)에 붙여넣고 실행
   - 기간 변경하고 싶으면 프롬프트 끝에 한 줄 추가: "**기간: 4/29~5/8**"
2. AI가 JSON 출력하면 검토 (메가 이벤트 빠진 거 없는지, 한국 이벤트 너무 적은 거 아닌지, **각 셀이 짧고 깔끔한지**)
3. JSON 부분만 복사
4. 메모장으로 `magellan-dashboard\public\data\economic-calendar.json` 열고 통째로 교체 → 저장
5. cmd:
   ```
   cd "C:\Users\당근\Desktop\주식 컨텐츠 사업 프로젝트\magellan-dashboard-step3\magellan-dashboard"
   git stash
   git pull --rebase
   git stash pop
   git add public/data/economic-calendar.json
   git commit -m "data: 경제 캘린더 갱신 (YYYY-MM-DD ~ YYYY-MM-DD)"
   git push
   ```
6. Vercel 자동 배포 1~2분 → 사이트 확인 (Ctrl+F5)

> 💡 actual은 비워둬도 OK. Finnhub API가 매일 6번 자동으로 채움.

---

## 변경 이력

### v1.3 (2026-05-11)
- **forecast/previous 단일 지표화**: 한 셀에 단일 숫자+단위만 (토스/키움 스타일)
- **복수 지표 분리 원칙**: CPI Headline / Core CPI 처럼 양쪽 다 중요하면 별도 events 항목으로
- **표준 지표 기준 명시**: CPI는 YoY, 소매판매는 MoM 등 시장 관행 따름
- **이벤트명에 기준 명시**: "(4월, 전년비)" 같이 단위·기간 포함
- **추가 매핑**: PPI, 실업수당 청구건수, 주택지표, 지역 연은, 설비가동률 등
- **변경 사유**: v1.2에서 ChatGPT가 한 셀에 너무 많은 정보(MoM+YoY+Core 등)를 넣어 화면이 깨지는 문제 발생. 한국 사용자는 토스·증권사 앱처럼 깔끔한 단일 지표 표시에 익숙. Finnhub API도 단일 숫자 actual을 반환하므로 forecast와 형식 일치가 자연스러움.

### v1.2 (2026-04-29)
- 시간 처리 규칙 전면 개편: KST 기준 완전 통일
- `timeNote` 필드 폐지
- `date` 필드 의미 변경: 현지 발표일 → KST 발표 시점 날짜
- 시차표 강조: ET 11:00 이후 발표는 KST 다음날로 분류 필수

### v1.1 (2026-04-28)
- 국가 범위 축소: 5개국 → 한국·미국 (CN, JP, EU 제외)
- 기간 옵션화: default 다음 주 월~금, 명시 지정 시 그 범위
- 중앙은행 금리 결정 표기 강제: forecast/previous에 구체 수준 명시
- 한국 매크로 매핑 강화 (산업활동동향, 경상수지, 한은 금통위 등)

### v1.0 (2026-04-27)
- 초안 작성. 5개 지역, 중요도 ★★★ 이상, KST 기준.
