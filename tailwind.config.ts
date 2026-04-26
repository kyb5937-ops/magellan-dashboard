import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 마젤란 브랜드 팔레트 (PPT 마스터 v4 추출)
        navy: {
          darkest: "#0B1426",   // 배경 (가장 진한)
          dark: "#111E36",      // 배경 (기본)
          DEFAULT: "#162849",   // 카드 배경
          light: "#1E3A5F",     // 섹션 구분·헤더
        },
        fg: {
          DEFAULT: "#F1F5F9",   // 텍스트 기본
          muted: "#94A3B8",     // 서브 텍스트
          subtle: "#64748B",    // 캡션
        },
        up: "#10B981",          // 상승
        down: "#EF4444",        // 하락
        accent: "#F59E0B",      // IB 관점 포인트
        chart: {
          blue: "#3B82F6",      // 차트 라인 기본
        },
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
