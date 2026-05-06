import { DashboardHeader } from "@/components/ui/DashboardHeader";
import { LiveCardSection } from "@/components/cards/LiveCardSection";
import { SectorETFSection } from "@/components/sectors/SectorETFSection";
import { StockLookup } from "@/components/lookup/StockLookup";
import { DeepDiveSection } from "@/components/deepdive/DeepDiveSection";
import { MarketFlowSection } from "@/components/marketflow/MarketFlowSection";
import { EconomicCalendarSection } from "@/components/calendar/EconomicCalendarSection";
import { EarningsCalendarUS } from "@/components/calendar/EarningsCalendarUS";
import { EarningsCalendarKR } from "@/components/calendar/EarningsCalendarKR";
import { US_INDICATORS, KR_INDICATORS } from "@/lib/data/indicators";

export default function HomePage() {
  return (
    <main className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <DashboardHeader />
        <LiveCardSection
          label="🇺🇸 MARKETS"
          indicators={US_INDICATORS}
        />
        <SectorETFSection />
        <LiveCardSection
          label="🇰🇷 KOREA"
          indicators={KR_INDICATORS}
        />
        <DeepDiveSection />
        <MarketFlowSection />
        <StockLookup />
        <EconomicCalendarSection />
        <EarningsCalendarUS />
        <EarningsCalendarKR />
      </div>
    </main>
  );
}
