/**
 * Hand-drawn SVG charts. Every series comes from real computed data; there are
 * no sample series anywhere in this file.
 */

import type { EpochPoint } from "@/lib/ml/engine";

export function BarList({
  items,
  unit = "",
}: {
  items: { label: string; value: number; tone?: string }[];
  unit?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(6rem,14rem)_1fr_4rem] items-center gap-3">
          <span className="truncate text-xs" title={item.label}>
            {item.label}
          </span>
          <span className="h-3 w-full bg-muted">
            <span
              className="block h-3"
              style={{ width: `${(item.value / max) * 100}%`, background: item.tone ?? "var(--primary)" }}
            />
          </span>
          <span className="metric text-right text-xs text-muted-foreground">
            {item.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TrendChart({
  points,
  height = 160,
  label,
}: {
  points: { date: string; score: number }[];
  height?: number;
  label: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No audits yet, so there is no trend to draw.</p>;
  }
  const width = 640;
  const padding = 28;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const y = (score: number) => height - padding - (score / 100) * (height - padding * 2);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${padding + index * stepX} ${y(point.score)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}>
      {[0, 25, 50, 75, 100].map((tick) => (
        <g key={tick}>
          <line x1={padding} x2={width - padding} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth="1" />
          <text x={4} y={y(tick) + 4} fill="var(--muted-foreground)" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
            {tick}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" />
      {points.map((point, index) => (
        <circle key={`${point.date}-${index}`} cx={padding + index * stepX} cy={y(point.score)} r="3" fill="var(--primary)" />
      ))}
    </svg>
  );
}

export function TrainingCurve({ history, label }: { history: EpochPoint[]; label: string }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">Training has not run yet in this browser.</p>;
  }
  const width = 640;
  const height = 200;
  const padding = 30;
  const maxLoss = Math.max(0.1, ...history.map((point) => Math.max(point.loss, point.valLoss)));
  const x = (index: number) => padding + (index / Math.max(1, history.length - 1)) * (width - padding * 2);
  const yLoss = (value: number) => height - padding - (value / maxLoss) * (height - padding * 2);
  const yAcc = (value: number) => height - padding - value * (height - padding * 2);

  const series = [
    { key: "loss", colour: "var(--critical)", points: history.map((p) => p.loss), scale: yLoss, dash: "" },
    { key: "val_loss", colour: "var(--serious)", points: history.map((p) => p.valLoss), scale: yLoss, dash: "4 3" },
    { key: "accuracy", colour: "var(--pass)", points: history.map((p) => p.acc), scale: yAcc, dash: "" },
    { key: "val_accuracy", colour: "var(--primary)", points: history.map((p) => p.valAcc), scale: yAcc, dash: "4 3" },
  ];

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="var(--border)" />
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} stroke="var(--border)" />
        {series.map((item) => (
          <path
            key={item.key}
            d={item.points.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${item.scale(value)}`).join(" ")}
            fill="none"
            stroke={item.colour}
            strokeWidth="1.75"
            strokeDasharray={item.dash}
          />
        ))}
        <text x={padding} y={height - 8} fill="var(--muted-foreground)" style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}>
          epoch 1
        </text>
        <text
          x={width - padding}
          y={height - 8}
          textAnchor="end"
          fill="var(--muted-foreground)"
          style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}
        >
          epoch {history.length}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((item) => (
          <span key={item.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: item.colour }} aria-hidden="true" />
            {item.key}
          </span>
        ))}
        <span className="metric">
          last: loss {history[history.length - 1].loss.toFixed(4)} · val_acc{" "}
          {(history[history.length - 1].valAcc * 100).toFixed(2)}%
        </span>
      </figcaption>
    </figure>
  );
}

export function DonutBreakdown({ items }: { items: { label: string; value: number; colour: string }[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground">No issues recorded yet.</p>;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Issues by severity">
        {items.map((item) => {
          const length = (item.value / total) * circumference;
          const circle = (
            <circle
              key={item.label}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={item.colour}
              strokeWidth="16"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += length;
          return circle;
        })}
        <text x="70" y="75" textAnchor="middle" fill="var(--foreground)" style={{ fontFamily: "var(--font-mono)", fontSize: 22 }}>
          {total}
        </text>
      </svg>
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className="inline-block size-3" style={{ background: item.colour }} aria-hidden="true" />
            <span className="metric">{item.value}</span>
            <span className="text-muted-foreground">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
