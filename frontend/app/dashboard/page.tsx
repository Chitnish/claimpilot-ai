"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  ShieldCheck,
  TrendingDown,
  Zap,
} from "lucide-react";

import { getAnalytics, listClaims } from "@/lib/api";
import {
  denialRiskColor,
  displayNumber,
  displayText,
  formatCurrency,
  formatStatus,
  statusBadgeClass,
  truncateId,
} from "@/lib/claim-ui";
import {
  formatAvgProcessingSeconds,
  getAvgProcessingSeconds,
} from "@/lib/demo-stats";
import type { Analytics, Claim } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CountUp, Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const POLL_INTERVAL_MS = 10_000;
const MANUAL_HOURS_PER_CLAIM = 2.5;
const BILLING_STAFF_HOURLY_RATE = 45;
const CHART_PRIMARY = "#3b82f6";

// Whole-dollar formatter for headline figures (cleaner during count-up).
const usd0 = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const pct = (n: number): string => `${Math.round(n)}%`;

// Tenant label for the hero. Demo placeholder — swap for the real org once
// multi-tenant org metadata is surfaced to the frontend.
const ORG_NAME = "Riverside Medical Group";

const thClass =
  "text-xs font-semibold uppercase tracking-wider text-slate-400";
const rowClass =
  "group cursor-pointer odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04]";

// Dark chart styling, shared across this page's Recharts.
const CHART_AXIS = "#94a3b8";
const CHART_GRID = "rgba(148,163,184,0.12)";
const CHART_TOOLTIP = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "#161619",
  color: "#ededf0",
  fontSize: 12,
  boxShadow: "0 12px 30px -12px rgba(0,0,0,0.7)",
} as const;

function statusChartData(
  statusCounts: Record<string, number>,
): { status: string; count: number }[] {
  return Object.entries(statusCounts)
    .map(([status, count]) => ({ status: formatStatus(status), count }))
    .sort((a, b) => b.count - a.count);
}

const RISK_BUCKET_LABELS = [
  "0-20%",
  "20-40%",
  "40-60%",
  "60-80%",
  "80-100%",
] as const;

function denialRiskBucketData(
  claims: Claim[],
): { bucket: string; count: number }[] {
  const counts = [0, 0, 0, 0, 0];

  for (const claim of claims) {
    const risk = displayNumber(claim.denialRisk);
    if (risk < 0.2) counts[0]++;
    else if (risk < 0.4) counts[1]++;
    else if (risk < 0.6) counts[2]++;
    else if (risk < 0.8) counts[3]++;
    else counts[4]++;
  }

  return RISK_BUCKET_LABELS.map((bucket, index) => ({
    bucket,
    count: counts[index],
  }));
}

/** Glassy metric chip used inside the dark hero cluster. */
function HeroMetric({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.07]">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        <Icon className="size-3.5 text-brand" />
        {label}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
        {children}
      </p>
    </div>
  );
}

export default function DashboardPage(): React.ReactElement {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
  }, []);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const [claimsData, analyticsData] = await Promise.all([
        listClaims(),
        getAnalytics(),
      ]);
      setClaims(claimsData);
      setAnalytics(analyticsData);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load dashboard";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const statusData = useMemo(
    () => (analytics ? statusChartData(analytics.statusCounts) : []),
    [analytics],
  );
  const riskBucketData = useMemo(
    () => denialRiskBucketData(claims),
    [claims],
  );

  if (loading || !analytics) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-brand" />
      </div>
    );
  }

  const cleanClaimPct = Math.round(analytics.cleanClaimRate * 100);
  const denialPct = Math.round(analytics.denialRate * 100);
  const touchPct = Math.round(analytics.touchRate * 100);
  const touchlessPct = Math.max(0, 100 - touchPct);
  const totalClaims = claims.length;
  const avgProcessingSeconds = getAvgProcessingSeconds(totalClaims);
  const fteHoursSaved = totalClaims * MANUAL_HOURS_PER_CLAIM;
  const costSavings = fteHoursSaved * BILLING_STAFF_HOURLY_RATE;

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Hero banner */}
      <Reveal>
        <section className="mesh-hero grid-overlay relative overflow-hidden rounded-2xl border border-white/10 p-6 text-white shadow-float sm:p-8">
          <span className="accent-glow -right-10 -top-10 size-56 bg-brand/40" aria-hidden />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark shadow-lg shadow-brand/30 ring-1 ring-white/20">
                    <Activity className="size-[18px] text-white" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Revenue Cycle Command Center
                  </span>
                </div>
                <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  {ORG_NAME}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                  Real-time claims automation across seven specialized AI
                  agents — from intake through reconciliation.
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                  </span>
                  Pipeline live
                </span>
                <p className="text-xs text-slate-400">{today}</p>
              </div>
            </div>

            <div className="mt-7 grid max-w-2xl gap-3 sm:grid-cols-3">
              <HeroMetric icon={ShieldCheck} label="Clean claim rate">
                {analytics.adjudicatedCount > 0 ? (
                  <CountUp value={cleanClaimPct} format={pct} />
                ) : (
                  "—"
                )}
              </HeroMetric>
              <HeroMetric icon={Zap} label="Touchless">
                {analytics.adjudicatedCount > 0 ? (
                  <CountUp value={touchlessPct} format={pct} />
                ) : (
                  "—"
                )}
              </HeroMetric>
              <HeroMetric icon={DollarSign} label="Total billed">
                <CountUp value={analytics.totalBilled} format={usd0} />
              </HeroMetric>
            </div>
          </div>
        </section>
      </Reveal>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* KPI stat cards */}
      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Claims Processed"
            value={<CountUp value={analytics.totalClaims} />}
            subtitle={`${analytics.adjudicatedCount} submitted to payers`}
            icon={FileText}
            accent="blue"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Clean Claim Rate"
            value={
              analytics.adjudicatedCount > 0 ? (
                <CountUp value={cleanClaimPct} format={pct} />
              ) : (
                "—"
              )
            }
            subtitle={`First-pass acceptance, of ${analytics.adjudicatedCount} adjudicated`}
            icon={ShieldCheck}
            accent="green"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Avg Processing Time"
            value={
              avgProcessingSeconds === null ? (
                "—"
              ) : (
                <CountUp
                  value={avgProcessingSeconds}
                  format={formatAvgProcessingSeconds}
                />
              )
            }
            subtitle="Industry avg: 3–5 days"
            icon={Zap}
            accent="amber"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Total Billed"
            value={<CountUp value={analytics.totalBilled} format={usd0} />}
            subtitle="Across all claims"
            icon={DollarSign}
            accent="blue"
          />
        </StaggerItem>
      </Stagger>

      {/* Business impact (dark, dramatic) */}
      <Reveal>
        <section className="mesh-hero grid-overlay relative overflow-hidden rounded-2xl border border-white/10 p-6 text-white shadow-float sm:p-8">
          <span className="accent-glow -bottom-12 left-1/3 size-72 bg-emerald-500/25" aria-hidden />
          <div className="relative">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/30">
                <TrendingDown className="size-4 text-emerald-300" />
              </span>
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  Estimated Business Impact
                </h2>
                <p className="text-xs text-slate-400">
                  Modeled savings from automated claim processing
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {/* Cost savings — the headline figure */}
              <div className="sm:border-r sm:border-white/10 sm:pr-6">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <DollarSign className="size-4 text-emerald-300" />
                  Cost Savings
                </div>
                <p className="mt-1 font-display text-4xl font-semibold tracking-tight">
                  <span className="text-gradient-brand">
                    <CountUp value={costSavings} format={usd0} />
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-400">vs manual processing</p>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 ring-1 ring-blue-400/20">
                  <Clock className="size-5 text-blue-300" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">FTE Hours Saved</p>
                  <p className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-white">
                    <CountUp
                      value={fteHoursSaved}
                      format={(n) => `${n.toFixed(1)} hrs`}
                    />
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    At $45/hr avg billing staff cost
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-400/20">
                  <TrendingDown className="size-5 text-amber-300" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Denial Rate</p>
                  <p className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-white">
                    {analytics.adjudicatedCount > 0 ? (
                      <CountUp value={denialPct} format={pct} />
                    ) : (
                      "—"
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {touchPct}% of claims needed review
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </Reveal>

      {/* Charts */}
      <Reveal className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-white">
              Claims by Status
            </CardTitle>
            <CardDescription>
              Distribution across pipeline stages
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No data to chart
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={statusData} margin={{ left: 0, right: 8 }}>
                  <defs>
                    <linearGradient id="barBrand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#2563eb" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={CHART_GRID}
                  />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(59,130,246,0.06)" }}
                    contentStyle={CHART_TOOLTIP}
                  />
                  <Bar
                    dataKey="count"
                    fill="url(#barBrand)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={56}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-white">
              Denial Risk Distribution
            </CardTitle>
            <CardDescription>
              Recent claims grouped by predicted denial risk
            </CardDescription>
          </CardHeader>
          <CardContent>
            {claims.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No data to chart
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={riskBucketData} margin={{ left: 0, right: 8 }}>
                  <defs>
                    <linearGradient
                      id="riskStroke"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                    >
                      <stop offset="0%" stopColor="#22c55e" />
                      <stop offset="50%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#ef4444" />
                    </linearGradient>
                    <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={CHART_GRID}
                  />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="url(#riskStroke)"
                    strokeWidth={2.5}
                    fill="url(#riskFill)"
                    dot={{ fill: CHART_PRIMARY, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </Reveal>

      {/* Recent claims */}
      <Reveal>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <FileText className="size-4 text-brand" />
              Recent Claims
            </CardTitle>
            <CardDescription>Click a row to view claim details</CardDescription>
          </div>
          <Link
            href="/claims"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-brand/40 hover:text-brand"
          >
            View all
            <ArrowUpRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No claims yet"
              description="Upload a superbill to start processing claims through the pipeline."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white/[0.03] backdrop-blur-sm">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={thClass}>Claim ID</TableHead>
                    <TableHead className={thClass}>Status</TableHead>
                    <TableHead className={thClass}>Provider</TableHead>
                    <TableHead className={cn(thClass, "text-right")}>
                      Charge
                    </TableHead>
                    <TableHead className={thClass}>Denial Risk</TableHead>
                    <TableHead className={thClass}>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((claim) => {
                    const riskPercent = Math.round(
                      displayNumber(claim.denialRisk) * 100,
                    );
                    const claimId = displayText(claim.claimId);
                    return (
                      <TableRow
                        key={claim.claimId || claimId}
                        className={rowClass}
                        onClick={() => {
                          if (claim.claimId) {
                            router.push(`/claims/${claim.claimId}`);
                          }
                        }}
                      >
                        <TableCell className="font-mono text-xs text-slate-200">
                          {claim.claimId ? truncateId(claim.claimId) : claimId}
                        </TableCell>
                        <TableCell>
                          {claim.status ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                statusBadgeClass(claim.status),
                                claim.status === "needs_review" &&
                                  "animate-status-pulse",
                              )}
                            >
                              {formatStatus(claim.status)}
                            </Badge>
                          ) : (
                            displayText(claim.status)
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-200">
                          {displayText(claim.providerName)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(claim.totalCharge)}
                        </TableCell>
                        <TableCell className="w-40">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-full rounded-full bg-white/10">
                              <div
                                className={cn(
                                  "h-2 rounded-full transition-all",
                                  denialRiskColor(riskPercent),
                                )}
                                style={{ width: `${riskPercent}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums text-slate-400">
                              {riskPercent}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {claim.createdAt
                            ? new Date(claim.createdAt).toLocaleString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </Reveal>
    </div>
  );
}
