// 네이버 뉴스 검색 API 어댑터
// 문서: https://developers.naver.com/docs/serviceapi/search/news/news.md
//
// 요청:
//   GET https://openapi.naver.com/v1/search/news.json
//     ?query=두산에너빌리티
//     &display=20      (한 번에 가져올 개수, 최대 100)
//     &sort=date       (date: 최신순, sim: 정확도)
//   헤더:
//     X-Naver-Client-Id: ...
//     X-Naver-Client-Secret: ...
//
// 응답:
//   {
//     items: [
//       {
//         title: "두산에너빌리티 美 엑스에너지 SMR 협력 강화",
//         originallink: "https://...",  // 원본 매체 URL
//         link: "https://n.news.naver.com/...",  // 네이버 뉴스 URL
//         description: "두산에너빌리티가 미국 소형모듈원전(SMR)...",
//         pubDate: "Fri, 24 Apr 2026 15:34:00 +0900"
//       }, ...
//     ]
//   }

export interface NewsItem {
  title: string;
  link: string;          // 네이버 뉴스 페이지 URL (있으면)
  originalLink: string;  // 원본 매체 URL
  description: string;
  pubDate: string;       // ISO 형식
  publisher: string;     // 매체명 (URL에서 추출)
}

interface NaverNewsItem {
  title: string;
  originallink: string;
  link: string;
  description: string;
  pubDate: string;
}

interface NaverNewsResponse {
  total: number;
  items: NaverNewsItem[];
}

/**
 * HTML 태그 + HTML 엔티티 제거
 * 네이버 API 는 검색어를 <b>...</b> 로 감싸주고 &quot; 같은 엔티티도 사용
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * URL 에서 매체명 추출
 * 예: "https://www.hankyung.com/..." → "한국경제"
 *     "https://n.news.naver.com/..." → 알 수 없음 (네이버는 매체 URL 안 줌)
 */
function extractPublisher(originalLink: string, link: string): string {
  const url = originalLink || link;

  // 도메인 → 매체명 매핑
  const map: Record<string, string> = {
    "hankyung.com": "한국경제",
    "mk.co.kr": "매일경제",
    "yna.co.kr": "연합뉴스",
    "edaily.co.kr": "이데일리",
    "mt.co.kr": "머니투데이",
    "businesspost.co.kr": "비즈니스포스트",
    "chosun.com": "조선일보",
    "joongang.co.kr": "중앙일보",
    "donga.com": "동아일보",
    "khan.co.kr": "경향신문",
    "hani.co.kr": "한겨레",
    "seoul.co.kr": "서울신문",
    "kmib.co.kr": "국민일보",
    "segye.com": "세계일보",
    "hankookilbo.com": "한국일보",
    "munhwa.com": "문화일보",
    "newsis.com": "뉴시스",
    "fnnews.com": "파이낸셜뉴스",
    "etnews.com": "전자신문",
    "ddaily.co.kr": "디지털데일리",
    "zdnet.co.kr": "지디넷",
    "bloter.net": "블로터",
    "newspim.com": "뉴스핌",
    "ajunews.com": "아주경제",
    "mbn.co.kr": "MBN",
    "ytn.co.kr": "YTN",
    "sbs.co.kr": "SBS",
    "kbs.co.kr": "KBS",
    "mbc.co.kr": "MBC",
    "imnews.imbc.com": "MBC",
    "jtbc.co.kr": "JTBC",
    "tvchosun.com": "TV조선",
    "channela.com": "채널A",
    "wowtv.co.kr": "한국경제TV",
    "sedaily.com": "서울경제",
    "thebell.co.kr": "더벨",
    "biz.heraldcorp.com": "헤럴드경제",
    "heraldcorp.com": "헤럴드경제",
    "nocutnews.co.kr": "노컷뉴스",
    "moneys.co.kr": "머니S",
    "asiae.co.kr": "아시아경제",
    "newdaily.co.kr": "뉴데일리",
    "news1.kr": "뉴스1",
    "ohmynews.com": "오마이뉴스",
    "pressian.com": "프레시안",
    "naeil.com": "내일신문",
    "mdtoday.co.kr": "메디컬투데이",
    "yakup.com": "약업닷컴",
    "doctorsnews.co.kr": "의사신문",
  };

  for (const [domain, name] of Object.entries(map)) {
    if (url.includes(domain)) return name;
  }

  // 매핑 못 찾으면 도메인 일부 반환 (예: "example.com" → "example")
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return host.split(".")[0];
  } catch {
    return "기타";
  }
}

/**
 * 종목명·키워드로 네이버 뉴스 검색
 *
 * @param query    검색어 (예: "두산에너빌리티")
 * @param display  결과 개수 (기본 20, 최대 100)
 */
export async function fetchNaverNews(
  query: string,
  display: number = 20
): Promise<NewsItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수가 없습니다."
    );
  }

  const url =
    `https://openapi.naver.com/v1/search/news.json` +
    `?query=${encodeURIComponent(query)}` +
    `&display=${display}` +
    `&sort=date`; // 최신순

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    // 같은 검색어는 5분 캐시 (반복 검색 시 API 호출 절약)
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`네이버 API 요청 실패: HTTP ${res.status}`);
  }

  const json: NaverNewsResponse = await res.json();
  const items = json.items || [];

  return items.map((item) => ({
    title: stripHtml(item.title),
    link: item.link,
    originalLink: item.originallink,
    description: stripHtml(item.description),
    pubDate: new Date(item.pubDate).toISOString(),
    publisher: extractPublisher(item.originallink, item.link),
  }));
}
