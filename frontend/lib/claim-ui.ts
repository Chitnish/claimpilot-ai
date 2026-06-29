// Tailwind safelist: bg-red-500 bg-amber-500 bg-emerald-500 bg-gray-200
import type { VariantProps } from "class-variance-authority";

import { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Dark-native agent tints (translucent fill + 300 text) for the ops console.
const AGENT_COLORS: Record<string, string> = {
  intake: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  eligibility: "bg-teal-500/15 text-teal-300 border-teal-500/25",
  coding: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  scrub: "bg-orange-500/15 text-orange-300 border-orange-500/25",
  submission: "bg-red-500/15 text-red-300 border-red-500/25",
  reconciliation: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  fraud: "border-white/10 bg-white/[0.06] text-slate-300",
  human_review: "border-amber-500/25 bg-amber-500/15 text-amber-300",
  system: "bg-white/[0.06] text-slate-300 border-white/10",
};

export function agentBadgeClass(agent: string): string {
  return AGENT_COLORS[agent.toLowerCase()] ?? AGENT_COLORS.system;
}

export function statusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "reconciled":
    case "paid":
      return "success";
    case "needs_review":
    case "appealed":
      return "warning";
    case "denied":
      return "danger";
    default:
      return "secondary";
  }
}

// Standardized status pill colors, shared across every page so a given claim
// status always reads the same. Returns Tailwind classes layered over the
// Badge base (which already supplies layout + border width).
const STATUS_BADGE_CLASSES: Record<string, string> = {
  reconciled: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  needs_review: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  appealed: "bg-orange-500/15 text-orange-300 border-orange-500/25",
  denied: "bg-red-500/15 text-red-300 border-red-500/25",
  submitted: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  draft: "bg-white/[0.06] text-slate-300 border-white/10",
  extracted: "bg-slate-500/15 text-slate-300 border-slate-500/25",
  coded: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  scrubbed: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
};

export function statusBadgeClass(status: string): string {
  return (
    STATUS_BADGE_CLASSES[status] ??
    "bg-white/[0.06] text-slate-300 border-white/10"
  );
}

export function denialRiskColor(percent: number): string {
  if (percent >= 60) return "bg-red-500";
  if (percent >= 40) return "bg-amber-500";
  return "bg-emerald-500";
}

export function formatCurrency(amount: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount ?? 0);
}

export function displayText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function displayNumber(value: number | null | undefined): number {
  return value ?? 0;
}

export function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}…`;
}

export function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
