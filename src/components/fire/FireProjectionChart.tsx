import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { FireProjectionPoint } from "@/lib/fire";

type Currency = "USD" | "EUR" | "PLN";

interface Props {
  projection: FireProjectionPoint[];
  fireNumber: number;
  displayCurrency: Currency;
  retirementAge: number | null;
}

function CustomTooltip({
  active,
  payload,
  label,
  displayCurrency,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: number;
  displayCurrency: Currency;
}) {
  if (active && payload?.length) {
    return (
      <div className="bg-card text-card-foreground border-border shadow-paper rounded-md border p-3">
        <p className="text-muted-foreground text-xs">Age {label}</p>
        <p className="tnum text-sm font-bold">
          {payload[0].value.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}{" "}
          {displayCurrency}
        </p>
      </div>
    );
  }
  return null;
}

export function FireProjectionChart({ projection, fireNumber, displayCurrency, retirementAge }: Props) {
  // Recharts won't render an empty dataset; the never-reaches-FI case (null
  // retirementAge) still has a projection but is worth flagging explicitly.
  if (projection.length === 0 || retirementAge === null) {
    return (
      <div className="border-kraft mt-6 rounded-md border-2 border-dashed p-8 text-center">
        <p className="text-foreground/70 text-sm">
          Your portfolio won&apos;t reach FI within the projection horizon at this savings rate. Increase your income,
          cut expenses, or adjust your assumptions to see a projection curve.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border-border mt-6 rounded-md border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-foreground/60 text-xs font-bold tracking-[0.12em] uppercase">
          Projected Portfolio (today&apos;s money)
        </h2>
        <span className="text-muted-foreground text-xs font-bold">{displayCurrency}</span>
      </div>

      <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 600, height: 300 }}>
        <LineChart data={projection} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="5 5" />
          <XAxis
            dataKey="age"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: number) => `${v}`}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v: number) =>
              v.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })
            }
          />
          <Tooltip content={<CustomTooltip displayCurrency={displayCurrency} />} />
          <Line type="monotone" dataKey="balance" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
          <ReferenceLine
            y={fireNumber}
            stroke="var(--chart-2)"
            strokeDasharray="3 3"
            label={{
              value: "FIRE number",
              fill: "var(--chart-2)",
              position: "insideTopLeft",
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
