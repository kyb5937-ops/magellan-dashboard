import type { IndicatorMeta } from "@/lib/data/indicators";
import type { IndicatorValue } from "@/lib/data/dummy-values";
import { IndicatorCard } from "./IndicatorCard";

interface CardSectionProps {
  label: string;
  indicators: IndicatorMeta[];
  values: IndicatorValue[];
}

export function CardSection({ label, indicators, values }: CardSectionProps) {
  return (
    <section className="mb-6">
      <div className="text-xs font-medium text-fg-muted mb-2 tracking-wider">
        {label}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {indicators.map((meta) => {
          const value = values.find((v) => v.id === meta.id);
          return <IndicatorCard key={meta.id} meta={meta} value={value} />;
        })}
      </div>
    </section>
  );
}
