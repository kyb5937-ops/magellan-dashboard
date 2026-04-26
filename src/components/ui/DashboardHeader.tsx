export function DashboardHeader() {
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
        LIVE · 15분 지연
      </div>
    </header>
  );
}
