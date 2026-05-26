import { Card } from "@/components/ui/card";
import type { Currency } from "@/lib/net-worth";

export interface DeltaInfo {
  absolute: number;
  percentage: number;
}

interface NetWorthCardProps {
  total: number;
  currency: Currency;
  deltaMonth?: DeltaInfo | null;
  deltaYear?: DeltaInfo | null;
}

function formatCurrency(value: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentage(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function NetWorthCard({ total, currency, deltaMonth, deltaYear }: NetWorthCardProps) {
  return (
    <Card className="relative overflow-hidden">
      {/* Background gradient accent */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />

      <div className="relative">
        <p className="mb-1 text-sm font-medium text-blue-200/70">Net Worth</p>
        <p className="mb-4 text-4xl font-bold text-white">{formatCurrency(total, currency)}</p>

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-blue-200/60">vs. Last Month</p>
            {deltaMonth ? (
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold ${deltaMonth.absolute >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {formatCurrency(deltaMonth.absolute, displayCurrency)}
                </span>
                <span className={`text-xs ${deltaMonth.percentage >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {formatPercentage(deltaMonth.percentage)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-white/40">--</p>
            )}
          </div>

          <div>
            <p className="text-xs text-blue-200/60">vs. Jan 1st</p>
            {deltaYear ? (
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold ${deltaYear.absolute >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {formatCurrency(deltaYear.absolute, displayCurrency)}
                </span>
                <span className={`text-xs ${deltaYear.percentage >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {formatPercentage(deltaYear.percentage)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-white/40">--</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
