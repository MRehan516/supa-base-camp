/**
 * Shared presentation primitives. All colour comes from design-system tokens.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";

export function SectionLabel({ number, children }: { number?: string; children: ReactNode }) {
  return (
    <p className="label-caps flex items-center gap-2">
      {number ? <span className="section-number">{number}</span> : null}
      <span>{children}</span>
    </p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="rule-line border-b pb-6">
      <SectionLabel>{eyebrow}</SectionLabel>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl leading-tight sm:text-4xl">{title}</h1>
          {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Breadcrumbs({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="label-caps flex flex-wrap items-center gap-2">
        {trail.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2">
            {item.to ? (
              <Link to={item.to} className="underline underline-offset-2 hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {item.label}
              </span>
            )}
            {index < trail.length - 1 ? <span aria-hidden="true">/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "bg-critical text-critical-foreground",
  serious: "bg-serious text-serious-foreground",
  moderate: "bg-moderate text-moderate-foreground",
  minor: "bg-minor text-minor-foreground",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "metric inline-flex items-center rounded-sm px-2 py-0.5 text-[0.6875rem] uppercase tracking-wider",
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

export function Panel({
  title,
  label,
  actions,
  children,
  className,
}: {
  title?: string;
  label?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel p-5", className)}>
      {title || label || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {label ? <SectionLabel>{label}</SectionLabel> : null}
            {title ? <h2 className="mt-1 text-xl">{title}</h2> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <p className="label-caps">{label}</p>
      <p className="metric mt-1 text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-start gap-3 border-dashed p-6">
      <h3 className="text-lg">{title}</h3>
      <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

/** Score gauge drawn as an SVG arc — no chart library, no fake numbers. */
export function ScoreGauge({ score, size = 160 }: { score: number; size?: number }) {
  const radius = size / 2 - 12;
  const circumference = Math.PI * radius * 1.5;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const tone = score >= 85 ? "var(--pass)" : score >= 60 ? "var(--serious)" : "var(--critical)";
  return (
    <svg
      width={size}
      height={size * 0.72}
      viewBox={`0 0 ${size} ${size * 0.72}`}
      role="img"
      aria-label={`Accessibility score ${score} out of 100`}
    >
      <path
        d={describeArc(size / 2, size / 2, radius, 135, 405)}
        fill="none"
        stroke="var(--border)"
        strokeWidth="10"
      />
      <path
        d={describeArc(size / 2, size / 2, radius, 135, 405)}
        fill="none"
        stroke={tone}
        strokeWidth="10"
        strokeDasharray={`${dash} ${circumference}`}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        fill="var(--foreground)"
        style={{ fontFamily: "var(--font-mono)", fontSize: size * 0.24 }}
      >
        {score}
      </text>
      <text
        x={size / 2}
        y={size / 2 + 20}
        textAnchor="middle"
        fill="var(--muted-foreground)"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em" }}
      >
        / 100
      </text>
    </svg>
  );
}

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, start: number, end: number): string {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start <= 180 ? "0" : "1";
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

/** Horizontal probability bars — the raw softmax output, not a decoration. */
export function ProbabilityBars({
  classes,
  probabilities,
  highlight,
}: {
  classes: string[];
  probabilities: number[];
  highlight?: string;
}) {
  return (
    <ul className="space-y-2">
      {classes.map((label, index) => {
        const value = probabilities[index] ?? 0;
        return (
          <li key={label} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3">
            <span className={cn("metric text-xs", highlight === label && "text-foreground")}>{label}</span>
            <span className="h-2 w-full bg-muted">
              <span
                className={cn("block h-2", highlight === label ? "bg-primary" : "bg-secondary-foreground/40")}
                style={{ width: `${(value * 100).toFixed(2)}%` }}
              />
            </span>
            <span className="metric text-right text-xs text-muted-foreground">{(value * 100).toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ConfusionMatrix({ classes, matrix }: { classes: string[]; matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <table className="metric w-full text-xs">
        <caption className="label-caps mb-2 text-left">Confusion matrix — rows: true class, columns: predicted</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-left">
              true \ pred
            </th>
            {classes.map((label) => (
              <th key={label} scope="col" className="p-2 text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((label, row) => (
            <tr key={label}>
              <th scope="row" className="p-2 text-left font-normal">
                {label}
              </th>
              {classes.map((col, index) => {
                const value = matrix[row]?.[index] ?? 0;
                return (
                  <td
                    key={col}
                    className="border border-border p-2 text-center"
                    style={{ background: `color-mix(in oklch, var(--primary) ${(value / max) * 70}%, var(--card))` }}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Minimal stroke icons drawn inline. */
export function Icon({ name, className }: { name: "audit" | "chart" | "flask" | "book" | "cog" | "check" | "alert"; className?: string }) {
  const paths: Record<string, ReactNode> = {
    audit: <path d="M4 3h9l4 4v14H4zM13 3v4h4M7 12h7M7 16h5" />,
    chart: <path d="M4 20V5M4 20h16M8 20v-7M13 20v-11M18 20v-5" />,
    flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />,
    book: <path d="M4 5c0-1 1-2 2-2h12v18H6c-1 0-2-1-2-2zM8 7h7M8 11h7" />,
    cog: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M4.2 7.2l2.1 2.1M17.7 14.7l2.1 2.1M3 12h3M18 12h3M4.2 16.8l2.1-2.1M17.7 9.3l2.1-2.1" />,
    check: <path d="M4 13l5 5L20 6" />,
    alert: <path d="M12 4l9 16H3zM12 10v5M12 17.5v.5" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      className={cn("size-5", className)}
    >
      {paths[name]}
    </svg>
  );
}
