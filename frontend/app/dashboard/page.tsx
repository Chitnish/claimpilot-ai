"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
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
const CHART_PRIMARY = "#0ea5e9";

// Tenant label for the hero. Demo placeholder — swap for the real org once
// multi-tenant org metadata is surfaced to the frontend.
const ORG_NAME = "Riverside Medical Group";

const thClass =
  "text-xs font-semibold uppercase tracking-wider text-slate-500";
const rowClass =
  "cursor-pointer odd:bg-white even:bg-slate-50/50 hover:bg-blue-50/50";

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
  const totalClaims = claims.length;
  const avgProcessingSeconds = getAvgProcessingSeconds(totalClaims);
  const fteHoursSaved = totalClaims * MANUAL_HOURS_PER_CLAIM;
  const costSavings = fteHoursSaved * BILLING_STAFF_HOURLY_RATE;

  return (
    <div className="p-6 lg:p-8">
      {/* Hero banner */}
      <div className="mb-6 overflow-hidden rounded-xl bg-gradient-to-br from-clinical-shell to-clinical-sidebar p-6 text-white shadow-card sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-dark shadow-md shadow-brand/20">
                <Activity className="size-5 text-white" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                ClaimPilot AI
              </h1>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Revenue Cycle Management Platform
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm font-semibold text-white">{ORG_NAME}</p>
            <p className="mt-0.5 text-xs text-slate-400">{today}</p>
          </div>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* KPI stat cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Claims Processed"
          value={analytics.totalClaims}
          subtitle={`${analytics.adjudicatedCount} submitted to payers`}
          icon={FileText}
          accent="blue"
        />
        <StatCard
          label="Clean Claim Rate"
          value={analytics.adjudicatedCount > 0 ? `${cleanClaimPct}%` : "—"}
          subtitle={`First-pass acceptance, of ${analytics.adjudicatedCount} adjudicated`}
          icon={ShieldCheck}
          accent="green"
        />
        <StatCard
          label="Avg Processing Time"
          value={formatAvgProcessingSeconds(avgProcessingSeconds)}
          subtitle="Industry avg: 3–5 days"
          icon={Zap}
          accent="amber"
        />
        <StatCard
          label="Total Billed"
          value={formatCurrency(analytics.totalBilled)}
          subtitle="Across all claims"
          icon={DollarSign}
          accent="blue"
        />
      </div>

      {/* Business impact (dark) */}
      <div className="mb-6 rounded-xl bg-gradient-to-br from-clinical-sidebar to-clinical-shell p-6 text-white shadow-card sm:p-8">
        <h2 className="text-base font-semibold text-white">
          Estimated Business Impact
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Modeled savings from automated claim processing
        </p>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-blue-500/15">
              <Clock className="size-5 text-blue-300" />
            </div>
            <div>
              <p className="text-sm text-slate-400">FTE Hours Saved</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">
                {fteHoursSaved.toFixed(1)} hrs
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                At $45/hr avg billing staff cost
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
              <DollarSign className="size-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Cost Savings</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">
                {formatCurrency(costSavings)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                vs manual processing
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
              <TrendingDown className="size-5 text-amber-300" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Denial Rate</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">
                {analytics.adjudicatedCount > 0 ? `${denialPct}%` : "—"}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {touchPct}% of claims needed review
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
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
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(14,165,233,0.06)" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill={CHART_PRIMARY}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
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
                <LineChart data={riskBucketData} margin={{ left: 0, right: 8 }}>
                  <defs>
                    <linearGradient
                      id="riskLineGradient"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                    >
                      <stop offset="0%" stopColor="#22c55e" />
                      <stop offset="50%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#ef4444" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="url(#riskLineGradient)"
                    strokeWidth={2.5}
                    dot={{ fill: CHART_PRIMARY, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent claims */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-slate-900">
            Recent Claims
          </CardTitle>
          <CardDescription>Click a row to view claim details</CardDescription>
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
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm">
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
                        <TableCell className="font-mono text-xs text-slate-700">
                          {claim.claimId ? truncateId(claim.claimId) : claimId}
                        </TableCell>
                        <TableCell>
                          {claim.status ? (
                            <Badge
                              variant="outline"
                              className={statusBadgeClass(claim.status)}
                            >
                              {formatStatus(claim.status)}
                            </Badge>
                          ) : (
                            displayText(claim.status)
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-700">
                          {displayText(claim.providerName)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(claim.totalCharge)}
                        </TableCell>
                        <TableCell className="w-40">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-full rounded-full bg-slate-200">
                              <div
                                className={cn(
                                  "h-2 rounded-full transition-all",
                                  denialRiskColor(riskPercent),
                                )}
                                style={{ width: `${riskPercent}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums text-slate-500">
                              {riskPercent}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
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
    </div>
  );
}
