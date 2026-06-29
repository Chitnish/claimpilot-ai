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
  /** Solid gradient icon chip (white glyph on saturated brand color). */
  chip: string;
  /** Colored ambient shadow under the chip. */
  chipShadow: string;
  /** Soft glow blob bled into the top-right corner. */
  glow: string;
  /** Thin top accent bar gradient. */
  bar: string;
  /** Tint for the label marker dot. */
  dot: string;
}

const ACCENTS: Record<StatAccent, AccentTheme> = {
  blue: {
    chip: "from-sky-500 to-blue-600",
    chipShadow: "shadow-blue-500/25",
    glow: "bg-sky-400",
    bar: "from-sky-500 to-blue-600",
    dot: "bg-sky-500",
  },
  green: {
    chip: "from-emerald-500 to-teal-600",
    chipShadow: "shadow-emerald-500/25",
    glow: "bg-emerald-400",
    bar: "from-emerald-500 to-teal-600",
    dot: "bg-emerald-500",
  },
  amber: {
    chip: "from-amber-400 to-orange-500",
    chipShadow: "shadow-amber-500/25",
    glow: "bg-amber-400",
    bar: "from-amber-400 to-orange-500",
    dot: "bg-amber-500",
  },
  red: {
    chip: "from-red-500 to-rose-600",
    chipShadow: "shadow-red-500/25",
    glow: "bg-red-400",
    bar: "from-red-500 to-rose-600",
    dot: "bg-red-500",
  },
  orange: {
    chip: "from-orange-500 to-amber-600",
    chipShadow: "shadow-orange-500/25",
    glow: "bg-orange-400",
    bar: "from-orange-500 to-amber-600",
    dot: "bg-orange-500",
  },
  purple: {
    chip: "from-violet-500 to-purple-600",
    chipShadow: "shadow-purple-500/25",
    glow: "bg-violet-400",
    bar: "from-violet-500 to-purple-600",
    dot: "bg-violet-500",
  },
  slate: {
    chip: "from-slate-500 to-slate-700",
    chipShadow: "shadow-slate-500/20",
    glow: "bg-slate-400",
    bar: "from-slate-400 to-slate-600",
    dot: "bg-slate-500",
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
 * Premium KPI tile: layered raised surface, a saturated gradient icon chip,
 * a colored accent bar + ambient corner glow, and a large display numeral.
 * Pass a `<CountUp />` as `value` to animate the figure on reveal.
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
      {/* Top accent bar */}
      <span
        className={cn(
          "absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-90",
          a.bar,
        )}
        aria-hidden
      />
      {/* Ambient corner glow */}
      <span
        className={cn("accent-glow -right-6 -top-6 size-24", a.glow)}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span className={cn("size-1.5 rounded-full", a.dot)} aria-hidden />
            {label}
          </p>
          <p className="mt-2 font-display text-[1.75rem] font-bold leading-none tracking-tight text-white">
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
            "flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ring-1 ring-white/20 transition-transform duration-200 group-hover:scale-105",
            a.chip,
            a.chipShadow,
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}
