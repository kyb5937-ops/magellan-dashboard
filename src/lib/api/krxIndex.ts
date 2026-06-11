// KRX 본 지수(코스피·코스닥) 공식 종가 어댑터
//
// Why: Yahoo 차트 API가 특정 거래일 일봉을 종종 누락해서 전일 종가가
//   엇갈리고 등락률이 틀리게 표시되는 사고가 반복됨. GitHub Actions가
//   매 거래일 KRX pykrx로 공식 종가를 받아 public/data/index-kr.json 으로
//   커밋(=Vercel 재배포)하므로, 그 파일을 그대로 읽는다.
//
// 읽기 전략:
//   1) fs 로 process.cwd()/public/data/index-kr.json (로컬 dev, self-host)
//   2) 실패 시 배포 URL(VERCEL_URL / NEXT_PUBLIC_SITE_URL)로 fetch
//      (Vercel은 public/ 을 CDN에서 서빙하므로 서버리스 번들에 미포함될
//       수 있어 HTTP fallback 필요)
//   둘 다 실패하면 null → route.ts 가 Yahoo 폴백으로 전환.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface KrxIndexEntry {
  value: number;
  change_pct: number;
  change_pt: number;
  prevClose: number;
  tradeDate: string;
}

export interface KrxIndexFile {
  date: string;
  updatedAt?: string;
  kospi?: KrxIndexEntry;
  kosdaq?: KrxIndexEntry;
}

let cache: { data: KrxIndexFile; expiresAt: number } | null = null;
const TTL_MS = 60_000;

async function readFromFs(): Promise<KrxIndexFile | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "index-kr.json");
    const buf = await fs.readFile(p, "utf-8");
    return JSON.parse(buf) as KrxIndexFile;
  } catch {
    return null;
  }
}

async function readFromHttp(): Promise<KrxIndexFile | null> {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/data/index-kr.json`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as KrxIndexFile;
  } catch {
    return null;
  }
}

export async function loadKrxIndexFile(): Promise<KrxIndexFile | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  let data = await readFromFs();
  if (!data) data = await readFromHttp();
  if (data) cache = { data, expiresAt: Date.now() + TTL_MS };
  return data;
}
