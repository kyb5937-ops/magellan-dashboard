"use client";

import { useEffect, useState } from "react";

function getDelayedKstTime(): string {
  const now = new Date();
  const delayed = new Date(now.getTime() - 15 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(delayed);
}

export function DashboardHeader() {
  const [delayedTime, setDelayedTime] = useState<string>("");

  useEffect(() => {
    const update = () => setDelayedTime(getDelayedKstTime());
    update();
    const id = setInterval(update, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="pb-4 mb-6 border-b border-navy-light flex items-center justify-between">
      <div>
        <h1 className="text-lg font-medium text-fg">
          마젤란의 항해노트 · 모니터링 대시보드
        </h1>
        <p className="text-xs text-fg-muted mt-0.5">
          한국 투자자를 위한 IB 관점 시장 모니터
        </p>
      </div>
      <div className="text-[11px] text-fg-muted flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 bg-up rounded-full" />
        <span>
          LIVE · 15분 지연
          {delayedTime && (
            <span className="ml-1 text-fg-subtle">
              ({delayedTime} 한국시간 기준)
            </span>
          )}
        </span>
      </div>
    </header>
  );
}
