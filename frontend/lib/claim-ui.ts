// Tailwind safelist: bg-red-500 bg-amber-500 bg-emerald-500 bg-gray-200
import type { VariantProps } from "class-variance-authority";

import { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const AGENT_COLORS: Record<string, string> = {
  intake: "bg-blue-100 text-blue-800 border-blue-200",
  coding: "bg-purple-100 text-purple-800 border-purple-200",
  scrub: "bg-orange-100 text-orange-800 border-orange-200",
  submission: "bg-red-100 text-red-800 border-red-200",
  reconciliation: "bg-green-100 text-green-800 border-green-200",
  fraud: "border-gray-300 bg-gray-50 text-gray-700",
  human_review: "border-amber-300 bg-amber-50 text-amber-700",
  system: "bg-gray-100 text-gray-700 border-gray-200",
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
  reconciled: "bg-emerald-100 text-emerald-800 border-emerald-200",
  paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  needs_review: "bg-amber-100 text-amber-800 border-amber-200",
  appealed: "bg-orange-100 text-orange-800 border-orange-200",
  denied: "bg-red-100 text-red-800 border-red-200",
  submitted: "bg-blue-100 text-blue-800 border-blue-200",
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  extracted: "bg-slate-100 text-slate-700 border-slate-200",
  coded: "bg-purple-100 text-purple-800 border-purple-200",
  scrubbed: "bg-cyan-100 text-cyan-800 border-cyan-200",
};

export function statusBadgeClass(status: string): string {
  return (
    STATUS_BADGE_CLASSES[status] ??
    "bg-slate-100 text-slate-700 border-slate-200"
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
