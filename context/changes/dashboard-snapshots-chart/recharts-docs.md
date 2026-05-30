# Recharts Documentation

> Fetched via Context7 MCP (`/recharts/recharts`, v3.3.0) for S-02 implementation planning.
> Saved: 2026-05-30.

## Overview

Recharts is a React-based charting library built with D3. Key principles: declarative components, native SVG support, and lightweight with minimal dependencies.

## Installation

```sh
npm install recharts react-is
```

## Core Components for Line Chart

| Component | Purpose |
|---|---|
| `LineChart` | Root container |
| `Line` | The line series |
| `XAxis` / `YAxis` | Axis rendering |
| `CartesianGrid` | Background grid lines |
| `Tooltip` | Hover info |
| `ReferenceLine` | Horizontal markers (e.g., starting point) |
| `ResponsiveContainer` | Auto-fit to parent size |

## Basic Pattern

```tsx
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

<ResponsiveContainer width="100%" height={400}>
  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
    <XAxis dataKey="date" />
    <YAxis />
    <CartesianGrid stroke="#eee" strokeDasharray="5 5" />
    <Line type="monotone" dataKey="netWorth" stroke="#8884d8" dot={false} />
    <Tooltip />
    <ReferenceLine y={startNetWorth} stroke="green" strokeDasharray="3 3" label={{ value: 'Start', fill: 'green', position: 'insideTopRight' }} />
  </LineChart>
</ResponsiveContainer>
```

## Key Props

### ResponsiveContainer
- `width` / `height`: `string` (e.g. `"100%"`) or `number`
- `debounce`: milliseconds to debounce resize observer (default 0)
- `minWidth` / `minHeight`: minimum dimensions
- `initialDimension`: `{ width: number, height: number }` — avoids the -1 warning on initial render by providing valid starting values

### LineChart
- `data`: array of data objects
- `margin`: `{ top, right, bottom, left }`
- `accessibilityLayer`: keyboard/screen reader support (true by default in v3)

### Line
- `type`: `"monotone"` | `"basis"` | `"linear"` | etc.
- `dataKey`: key in data objects (e.g. `"netWorth"`)
- `stroke`: color
- `dot`: show dots on data points (`false` for cleaner trend charts)
- `strokeWidth`: line thickness

### Tooltip
- `content`: custom component for tooltip rendering
- `position`: lock tooltip position via `{ x, y }` coordinates
- `portal`: render tooltip in custom DOM container

### ReferenceLine
- `y`: y-axis value to mark
- `stroke`: color
- `strokeDasharray`: `"3 3"` for dashed line
- `label`: `{ value, fill, position }` — position: `"insideTopRight"` | `"insideBottomLeft"` | etc.

### Custom Tooltip Example

```tsx
function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="label">{label}</p>
        <p className="value">{payload[0].value.toLocaleString()}</p>
      </div>
    );
  }
  return null;
}

<Tooltip content={<CustomTooltip />} />
```

### Data Format for Snapshot Chart

```typescript
interface SnapshotPoint {
  date: string;         // ISO date string, e.g. "2026-05-30"
  netWorth: number;     // converted to display currency
  label?: string;       // optional friendly label, e.g. "May 30"
}

// Example data:
const chartData: SnapshotPoint[] = [
  { date: "2026-01-01", netWorth: 10000, label: "Jan" },
  { date: "2026-02-01", netWorth: 11500, label: "Feb" },
  { date: "2026-03-01", netWorth: 10800, label: "Mar" },
];
```

## TypeScript Notes

- Use named imports: `import { LineChart, Line, ... } from 'recharts'`
- Custom tooltip component receives `active`, `payload`, `label`, and `coordinate` props
- `payload[0].value` is the data value; cast to number and call `.toLocaleString()` for currency display

## Notes for S-02

1. Use `ResponsiveContainer` so the chart fills its parent container on all screen sizes
2. For currency display in tooltip, use a custom `CustomTooltip` component with `toLocaleString()`
3. `ReferenceLine` is ideal for the January 1st starting point marker
4. Use `type="monotone"` for smooth lines (good for financial trend charts)
5. Set `dot={false}` on `Line` for a cleaner trend-line look without scatter dots
6. For initial render warnings, pass `initialDimension={{ width: 600, height: 300 }}` to `ResponsiveContainer`