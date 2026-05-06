# 마젤란의 항해노트 · 모니터링 대시보드

한국 투자자를 위한 IB 관점 시장 모니터.
미국 10개 + 한국 5개 주요 지표를 한 페이지로 제공하고, 핵심 6개 지수는 딥다이브 차트로 확장 조회 가능.

## 기술 스택

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** (마젤란 브랜드 팔레트 커스텀)
- **Recharts** (차트)
- **Vercel** (배포)

## 데이터 소스

| 소스 | 지표 | 비용 | 키 |
|---|---|---|---|
| Yahoo Finance (비공식) | 지수·환율·원자재·BTC·EWY | 무료 | 불필요 |
| FRED | 미 2Y / 10Y 금리 | 무료 | 필요 (30초 발급) |
| 한국은행 ECOS | 국고채 3Y / 10Y | 무료 | 필요 (당일 승인) |

## 실행 방법

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local 을 열어 FRED_API_KEY, ECOS_API_KEY 입력

# 3. 개발 서버 실행
npm run dev
# → http://localhost:3000
```

## 폴더 구조

```
src/
├── app/                       # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── cards/                 # 상단 요약 카드
│   ├── deepdive/              # 딥다이브 상세 차트
│   └── ui/                    # 공통 UI 요소
└── lib/
    ├── api/                   # 데이터 소스 어댑터 (Yahoo·FRED·ECOS)
    └── data/
        └── indicators.ts      # 15개 카드 + 6개 딥다이브 메타데이터
```

## 브랜드 팔레트

PPT 마스터 v4에서 추출:

| 역할 | Hex |
|---|---|
| 배경 (가장 진한) | `#0B1426` |
| 배경 (기본) | `#111E36` |
| 카드 배경 | `#162849` |
| 섹션 구분 | `#1E3A5F` |
| 텍스트 기본 | `#F1F5F9` |
| 텍스트 약한 | `#94A3B8` |
| 상승 | `#10B981` |
| 하락 | `#EF4444` |
| IB 관점 포인트 | `#F59E0B` |

## 한국 실적 서프라이즈 (스냅샷 시스템)

네이버금융은 발표 후 forecast 컬럼이 actual로 덮어써져 같은 분기의 보존된 forecast가 없습니다.
이를 우회하기 위해 매일 KST 09:00 컨센서스를 `public/data/consensus-snapshots-kr.json`에
누적하고, 발표 시 직전 30일 내 가장 최근 스냅샷을 forecast로 사용해 surprise를 계산합니다.

- 워크플로우: `.github/workflows/consensus-snapshot.yml`
- 첫 한 달 정도는 누적이 부족해 한국 종목의 surprise(+/-)가 빈 값으로 남을 수 있습니다 (정상 동작)
- 한 달 이상 누적되면 발표 직전 forecast 기반으로 정확한 surprise를 채웁니다

## 배포

```bash
# Vercel CLI 설치 후
vercel
# → 프로덕션 배포: vercel --prod
```

Vercel 대시보드에서 환경변수 `FRED_API_KEY`, `ECOS_API_KEY` 를 등록해야 합니다.
