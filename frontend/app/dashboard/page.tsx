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
  statusBadgeVariant,
  truncateId,
} from "@/lib/claim-ui";
import type { Analytics, Claim } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

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
        <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
      </div>
    );
  }

  const cleanClaimPct = Math.round(analytics.cleanClaimRate * 100);
  const denialPct = Math.round(analytics.denialRate * 100);
  const touchPct = Math.round(analytics.touchRate * 100);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Claims overview — refreshes every 10 seconds
        </p>
      </div>

      {error && (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Claims Processed
            </CardTitle>
            <FileText className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{analytics.totalClaims}</p>
            <p className="text-xs text-muted-foreground">
              {analytics.adjudicatedCount} submitted to payers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Clean Claim Rate
            </CardTitle>
            <ShieldCheck className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {analytics.adjudicatedCount > 0 ? `${cleanClaimPct}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              First-pass acceptance, of {analytics.adjudicatedCount} adjudicated
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Processing Time
            </CardTitle>
            <Zap className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatDuration(analytics.avgPipelineSeconds)}
            </p>
            <p className="text-xs text-muted-foreground">
              Measured agent time per claim
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Billed
            </CardTitle>
            <DollarSign className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatCurrency(analytics.totalBilled)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base text-[#1e3a5f]">
            Estimated Business Impact
          </CardTitle>
          <CardDescription>
            Estimate based on {analytics.autoProcessedCount} claims auto-processed
            without human review, at {analytics.businessImpact.manualMinutesPerClaim} min
            assumed manual handling each (${analytics.businessImpact.hourlyRate}/hr billing
            labor). Not a guarantee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                <Clock className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Est. Hours Saved
                </p>
                <p className="text-2xl font-bold text-[#1e3a5f]">
                  {analytics.businessImpact.hoursSaved.toFixed(1)} hrs
                </p>
                <p className="text-xs text-muted-foreground">
                  From {analytics.autoProcessedCount} touchless claims
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                <DollarSign className="size-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Est. Labor Savings
                </p>
                <p className="text-2xl font-bold text-[#1e3a5f]">
                  {formatCurrency(analytics.businessImpact.costSavings)}
                </p>
                <p className="text-xs text-muted-foreground">
                  vs manual processing
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                <TrendingDown className="size-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Denial Rate</p>
                <p className="text-2xl font-bold text-[#1e3a5f]">
                  {analytics.adjudicatedCount > 0 ? `${denialPct}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {touchPct}% of claims needed review
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Claims by Status</CardTitle>
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill="#1e3a5f"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fontSize: 11 }}
                    interval={0}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="url(#riskLineGradient)"
                    strokeWidth={2}
                    dot={{ fill: "#1e3a5f", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent claims</CardTitle>
          <CardDescription>Click a row to view claim details</CardDescription>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No claims yet. Upload a superbill to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Charge</TableHead>
                  <TableHead>Denial risk</TableHead>
                  <TableHead>Created</TableHead>
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
                      className="cursor-pointer"
                      onClick={() => {
                        if (claim.claimId) {
                          router.push(`/claims/${claim.claimId}`);
                        }
                      }}
                    >
                      <TableCell className="font-mono text-xs">
                        {claim.claimId ? truncateId(claim.claimId) : claimId}
                      </TableCell>
                      <TableCell>
                        {claim.status ? (
                          <Badge variant={statusBadgeVariant(claim.status)}>
                            {formatStatus(claim.status)}
                          </Badge>
                        ) : (
                          displayText(claim.status)
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {displayText(claim.providerName)}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(claim.totalCharge)}
                      </TableCell>
                      <TableCell className="w-36">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-full rounded-full bg-gray-200">
                            <div
                              className={cn(
                                "h-2 rounded-full transition-all",
                                denialRiskColor(riskPercent),
                              )}
                              style={{ width: `${riskPercent}%` }}
                            />
                          </div>
                          <span className="w-8 text-xs text-muted-foreground">
                            {riskPercent}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {claim.createdAt
                          ? new Date(claim.createdAt).toLocaleString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
