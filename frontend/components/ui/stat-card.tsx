import * as React from "react";

import { cn } from "@/lib/utils";

export type StatAccent =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "orange"
  | "purple"
  | "slate";

const ACCENTS: Record<
  StatAccent,
  { border: string; chipBg: string; chipText: string }
> = {
  blue: { border: "border-l-blue-500", chipBg: "bg-blue-50", chipText: "text-blue-600" },
  green: {
    border: "border-l-emerald-500",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-600",
  },
  amber: { border: "border-l-amber-500", chipBg: "bg-amber-50", chipText: "text-amber-600" },
  red: { border: "border-l-red-500", chipBg: "bg-red-50", chipText: "text-red-600" },
  orange: {
    border: "border-l-orange-500",
    chipBg: "bg-orange-50",
    chipText: "text-orange-600",
  },
  purple: {
    border: "border-l-purple-500",
    chipBg: "bg-purple-50",
    chipText: "text-purple-600",
  },
  slate: { border: "border-l-slate-400", chipBg: "bg-slate-100", chipText: "text-slate-600" },
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent?: StatAccent;
  /** Adds pointer cursor + shadow lift on hover for clickable metrics. */
  interactive?: boolean;
  className?: string;
}

/**
 * Data-dense KPI card: muted label, large bold value, optional context line,
 * a semantic colored left border (4px) and a matching icon chip on the right.
 */
export function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  accent = "blue",
  interactive = false,
  className,
}: StatCardProps): React.ReactElement {
  const a = ACCENTS[accent];
  return (
    <div
      className={cn(
        "rounded-xl border border-border border-l-4 bg-card p-5 shadow-card transition-shadow",
        a.border,
        interactive && "cursor-pointer hover:shadow-card-hover",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-600">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {value}
          </p>
          {subtitle ? (
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            a.chipBg,
          )}
        >
          <Icon className={cn("size-5", a.chipText)} />
        </div>
      </div>
    </div>
  );
}
