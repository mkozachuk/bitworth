import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { SnapshotRow } from "@/lib/database.types";
import type { Currency } from "@/lib/net-worth";

interface NetWorthChartProps {
  snapshots: SnapshotRow[];
  currency: Currency;
}

function formatCurrency(value: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ChartDataPoint {
  date: string;
  label: string;
  netWorth: number;
}

function buildChartData(snapshots: SnapshotRow[]): ChartDataPoint[] {
  return snapshots.map((s) => ({
    date: s.snapshot_date,
    label: formatDate(s.snapshot_date),
    netWorth: s.total_net_worth,
  }));
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  currency: Currency;
}

function CustomTooltip({ active, payload, label, currency }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/20 bg-[#0f0f1e] px-3 py-2 text-sm text-white shadow-xl">
      <p className="text-white/50">{label}</p>
      <p className="font-semibold text-white">{formatCurrency(payload[0].value, currency)}</p>
    </div>
  );
}

export function NetWorthChart({ snapshots, currency }: NetWorthChartProps) {
  if (snapshots.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Net Worth Trend</CardTitle>
        </CardHeader>
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-white/40">Save at least 2 snapshots to see a chart</p>
        </div>
      </Card>
    );
  }

  const data = buildChartData(snapshots);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Worth Trend</CardTitle>
      </CardHeader>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              tickFormatter={(value) => formatCurrency(value, currency).replace(/\.00$/, "")}
            />
            <Tooltip
              content={<CustomTooltip currency={currency} />}
              cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="netWorth"
              stroke="#a855f7"
              strokeWidth={2}
              dot={{ fill: "#a855f7", r: 3 }}
              activeDot={{ r: 5, fill: "#c084fc" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
