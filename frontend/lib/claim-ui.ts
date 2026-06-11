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
