// 미국 지수·금리 공식 종가 어댑터 (모닝 배치가 미국 종가 기록)
//
// Why: FRED 가격 지수/Yahoo 차트 API가 거래일 일봉을 종종 누락해 등락률이
//   엇갈리는 문제가 반복됨. GitHub Actions 모닝 배치가 미국 종가를 받아
//   public/data/index-us.json 으로 커밋(=Vercel 재배포)하므로, 그 파일을
//   그대로 읽는다. KR 쪽 index-kr.json(krxIndex.ts) 과 동일한 패턴.
//
// 읽기 전략:
//   1) fs 로 process.cwd()/public/data/index-us.json (로컬 dev, self-host)
//   2) 실패 시 배포 URL(VERCEL_URL / NEXT_PUBLIC_SITE_URL)로 fetch
//      (Vercel은 public/ 을 CDN에서 서빙하므로 서버리스 번들에 미포함될
//       수 있어 HTTP fallback 필요)
//   둘 다 실패하면 null → route.ts 가 FRED/Yahoo 폴백으로 전환.

import { promises as fs } from "node:fs";
import path from "node:path";

// 지수 항목 (S&P 500·NASDAQ·Dow·SOX)
export interface UsIndexEntry {
  value: number;
  change_pct: number;
  change_pt: number;
  prevClose: number;
  source: string;
  tradeDate: string;
}

// 미 국채 2년·10년 (수익률 %, 전일대비 bp)
export interface UsYieldEntry {
  value: number;       // 수익률 %
  change_bp: number;   // 전일대비 bp
  tradeDate: string;
}

export interface UsIndexFile {
  date: string;
  updatedAt?: string;
  sp500?: UsIndexEntry;
  nasdaq?: UsIndexEntry;
  dow?: UsIndexEntry;
  sox?: UsIndexEntry;
  us2y?: UsYieldEntry;
  us10y?: UsYieldEntry;
}

let cache: { data: UsIndexFile; expiresAt: number } | null = null;
const TTL_MS = 60_000;

async function readFromFs(): Promise<UsIndexFile | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "index-us.json");
    const buf = await fs.readFile(p, "utf-8");
    return JSON.parse(buf) as UsIndexFile;
  } catch {
    return null;
  }
}

async function readFromHttp(): Promise<UsIndexFile | null> {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/data/index-us.json`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as UsIndexFile;
  } catch {
    return null;
  }
}

export async function loadUsIndexFile(): Promise<UsIndexFile | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  let data = await readFromFs();
  if (!data) data = await readFromHttp();
  if (data) cache = { data, expiresAt: Date.now() + TTL_MS };
  return data;
}
