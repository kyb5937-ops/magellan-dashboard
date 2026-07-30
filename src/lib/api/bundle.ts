// 마감 보고서용 "묶음 엔드포인트" 공용 유틸 (/api/bundle/kr, /api/bundle/us)
//
// Why: 매일 마감 보고서를 만들 때 지표·수급·지수 JSON을 여러 URL에서 따로 받는 게
//   번거롭고, 소스마다 시점이 어긋나면 보고서가 틀어진다. URL 하나로 그날 필요한
//   데이터를 한 번에 받되, 원본 응답을 손대지 않고 소스별 신선도(updatedAt)를
//   각각 보존한다.
//
// 설계 원칙:
//   1) data 는 원본 응답 그대로. 키 이름 변경·평탄화·정규화 금지.
//   2) updatedAt 은 소스별로 각각 보존. 하나로 합치지 않는다
//      (보고서 프롬프트가 소스별 신선도를 검사함).
//   3) 한 소스가 죽어도 나머지는 받을 수 있어야 한다 → 실패는 ok:false 로 담고
//      HTTP 는 200 유지. 절대 500 으로 터뜨리지 않는다.

import { promises as fs } from "node:fs";
import path from "node:path";

/** 묶음 응답 안의 소스 하나. 실패해도 여기에 담기고 HTTP 200 이 유지된다. */
export interface BundleSource {
  ok: boolean;
  /**
   * 원본 응답의 updatedAt → 없으면 date → 둘 다 없으면 null.
   * 원본 값을 그대로 보존한다(문자열 ISO, 숫자 YYYYMMDD 등 소스마다 다름).
   */
  updatedAt: string | number | null;
  /** 원본 응답 그대로. 실패 시 null. */
  data: unknown;
  error?: string;
}

export interface BundleResponse {
  bundle: "kr" | "us";
  fetchedAt: string;
  sources: Record<string, BundleSource>;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failedSource(err: unknown): BundleSource {
  return { ok: false, updatedAt: null, error: message(err), data: null };
}

/**
 * 원본에서 신선도 필드를 뽑는다. updatedAt 우선, 없으면 date, 둘 다 없으면 null.
 * 값 자체는 변환하지 않고 원본 그대로 돌려준다.
 */
function extractUpdatedAt(data: unknown): string | number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of ["updatedAt", "date"] as const) {
    const value = obj[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

// ── public/data/*.json 읽기 ──
// 이 파일들은 API 라우트가 아니라 GitHub Actions 가 커밋하는 정적 파일이다.
// krxIndex.ts 의 loadKrxIndexFile 과 같은 전략: fs 우선, 실패 시 HTTP fetch.
// (Vercel 은 public/ 을 CDN에서 서빙하므로 서버리스 번들에 미포함될 수 있음)
// 단, 여기서는 메모리 캐시를 두지 않는다 — 마감 보고서는 항상 최신이어야 하고
// 전날 데이터가 나가면 안 된다.

async function readStaticFromFs(fileName: string): Promise<unknown> {
  const p = path.join(process.cwd(), "public", "data", fileName);
  const buf = await fs.readFile(p, "utf-8");
  return JSON.parse(buf);
}

async function readStaticFromHttp(fileName: string): Promise<unknown> {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!base) throw new Error("배포 URL 미설정 (NEXT_PUBLIC_SITE_URL / VERCEL_URL)");
  const res = await fetch(`${base}/data/${fileName}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** public/data/<fileName> 을 소스 하나로 읽는다. 실패해도 throw 하지 않는다. */
export async function staticJsonSource(fileName: string): Promise<BundleSource> {
  try {
    let data: unknown;
    try {
      data = await readStaticFromFs(fileName);
    } catch (fsErr) {
      try {
        data = await readStaticFromHttp(fileName);
      } catch (httpErr) {
        throw new Error(
          `public/data/${fileName} 읽기 실패 — fs: ${message(fsErr)} / http: ${message(httpErr)}`
        );
      }
    }
    return { ok: true, updatedAt: extractUpdatedAt(data), data };
  } catch (err) {
    return failedSource(err);
  }
}

/**
 * 기존 API 라우트의 GET 핸들러를 직접 호출해서 소스 하나로 담는다.
 *
 * Why self-HTTP-fetch 대신 직접 import 인가:
 *   /api/indicators, /api/sector-etfs, /api/key-stocks 의 GET 은 인자가 없는
 *   순수 핸들러라 그대로 호출할 수 있다. self-fetch 는 배포 URL(VERCEL_URL 등)에
 *   의존해서 프리뷰/로컬에서 깨지고 왕복 지연도 붙는다. 직접 호출은 기존 라우트를
 *   전혀 건드리지 않으면서 응답도 동일하다.
 */
export async function routeSource(
  label: string,
  handler: () => Promise<Response>
): Promise<BundleSource> {
  try {
    const res = await handler();
    if (!res.ok) throw new Error(`${label} 응답 실패 (HTTP ${res.status})`);
    const data = await res.json();
    return { ok: true, updatedAt: extractUpdatedAt(data), data };
  } catch (err) {
    return failedSource(err);
  }
}

/** 소스들을 병렬로 모아 묶음 응답 본문을 만든다. 키 순서는 넘긴 순서 그대로. */
export async function buildBundle(
  bundle: "kr" | "us",
  entries: Array<[string, Promise<BundleSource>]>
): Promise<BundleResponse> {
  const settled = await Promise.all(entries.map(([, p]) => p));
  const sources: Record<string, BundleSource> = {};
  entries.forEach(([key], i) => {
    sources[key] = settled[i];
  });

  return {
    bundle,
    fetchedAt: new Date().toISOString(),
    sources,
  };
}
