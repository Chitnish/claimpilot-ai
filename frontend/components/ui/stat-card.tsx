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

interface AccentTheme {
  /** Translucent icon-square fill. */
  iconBg: string;
  /** Accent-tinted glyph. */
  iconText: string;
  /** Hairline ring around the icon square. */
  iconRing: string;
}

// Restrained, Solaris-style: a quiet translucent square with an accent glyph —
// no saturated gradient chips, top bars, or glows.
const ACCENTS: Record<StatAccent, AccentTheme> = {
  blue: {
    iconBg: "bg-blue-500/15",
    iconText: "text-blue-300",
    iconRing: "ring-blue-500/20",
  },
  green: {
    iconBg: "bg-emerald-500/15",
    iconText: "text-emerald-300",
    iconRing: "ring-emerald-500/20",
  },
  amber: {
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-300",
    iconRing: "ring-amber-500/20",
  },
  red: {
    iconBg: "bg-red-500/15",
    iconText: "text-red-300",
    iconRing: "ring-red-500/20",
  },
  orange: {
    iconBg: "bg-orange-500/15",
    iconText: "text-orange-300",
    iconRing: "ring-orange-500/20",
  },
  purple: {
    iconBg: "bg-purple-500/15",
    iconText: "text-purple-300",
    iconRing: "ring-purple-500/20",
  },
  slate: {
    iconBg: "bg-white/[0.06]",
    iconText: "text-slate-300",
    iconRing: "ring-white/10",
  },
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent?: StatAccent;
  /** Adds pointer cursor + lift on hover for clickable metrics. */
  interactive?: boolean;
  className?: string;
}

/**
 * KPI tile: a border-defined dark surface, a muted uppercase label, a large
 * semibold numeral, and a quiet accent icon square. Pass a `<CountUp />` as
 * `value` to animate the figure on reveal.
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
        "surface-raised group relative overflow-hidden rounded-2xl border border-white/[0.07] p-5",
        interactive && "card-lift cursor-pointer hover:border-white/15",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {label}
          </p>
          <p className="mt-2.5 font-display text-[1.75rem] font-semibold leading-none tracking-tight text-white">
            {value}
          </p>
          {subtitle ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors",
            a.iconBg,
            a.iconText,
            a.iconRing,
          )}
        >
          <Icon className="size-[18px]" />
        </div>
      </div>
    </div>
  );
}
