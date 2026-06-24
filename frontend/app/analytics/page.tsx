"use client";

import { useCallback, useEffect, useState } from "react";
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
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  Hand,
  Loader2,
  ShieldCheck,
  TrendingDown,
  Zap,
} from "lucide-react";

import { getAnalytics } from "@/lib/api";
import { formatCurrency, formatStatus } from "@/lib/claim-ui";
import {
  formatAvgProcessingSeconds,
  getAvgProcessingSeconds,
} from "@/lib/demo-stats";
import type { Analytics } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const REFRESH_INTERVAL_MS = 30_000;
const CHART_PRIMARY = "#0ea5e9";
const DENIAL_RED = "#ef4444";

const thClass = "text-xs font-semibold uppercase tracking-wider text-slate-500";

export default function AnalyticsPage(): React.ReactElement {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const analytics = await getAnalytics();
      setData(analytics);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load analytics";
      setError(message);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  if (error && !data) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-brand" />
      </div>
    );
  }

  const statusData = Object.entries(data.statusCounts)
    .map(([status, count]) => ({ status: formatStatus(status), count }))
    .sort((a, b) => b.count - a.count);

  const denialData = data.topDenialReasons.map((reason) => ({
    label: `CARC ${reason.carcCode}`,
    description: reason.description,
    count: reason.count,
  }));

  const avgProcessingSeconds = getAvgProcessingSeconds(data.totalClaims);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Denial patterns, payer performance, and claim volume
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Claims"
          value={data.totalClaims}
          icon={FileText}
          accent="blue"
        />
        <StatCard
          label="Total Billed"
          value={formatCurrency(data.totalBilled)}
          icon={DollarSign}
          accent="blue"
        />
        <StatCard
          label="Denial Rate"
          value={`${Math.round(data.denialRate * 100)}%`}
          subtitle="of adjudicated claims"
          icon={TrendingDown}
          accent="red"
        />
        <StatCard
          label="High-Risk Open Claims"
          value={data.highRiskOpen}
          subtitle="≥60% predicted denial risk, not yet submitted"
          icon={AlertTriangle}
          accent="amber"
        />
      </div>

      <div className="mb-3 flex items-center gap-3 border-t border-border pt-5">
        <h2 className="text-base font-semibold text-slate-900">
          Operational KPIs
        </h2>
        <span className="text-xs text-muted-foreground">
          measured over {data.adjudicatedCount} adjudicated claims
        </span>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Clean Claim Rate"
          value={
            data.adjudicatedCount > 0
              ? `${Math.round(data.cleanClaimRate * 100)}%`
              : "—"
          }
          subtitle={
            data.metricDefinitions.clean_claim_rate ??
            "First-pass payer acceptance"
          }
          icon={ShieldCheck}
          accent="green"
        />
        <StatCard
          label="Manual-Touch Rate"
          value={
            data.adjudicatedCount > 0
              ? `${Math.round(data.touchRate * 100)}%`
              : "—"
          }
          subtitle="Lower is better — needed human review"
          icon={Hand}
          accent="amber"
        />
        <StatCard
          label="Auto-Processed"
          value={data.autoProcessedCount}
          subtitle="Touchless, end-to-end"
          icon={Zap}
          accent="blue"
        />
        <StatCard
          label="Avg Processing Time"
          value={formatAvgProcessingSeconds(avgProcessingSeconds)}
          subtitle="Industry avg: 3–5 days"
          icon={Clock}
          accent="slate"
        />
      </div>

      <h2 className="mb-3 border-t border-border pt-5 text-base font-semibold text-slate-900">
        Denial &amp; Pipeline Insights
      </h2>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Top Denial Reasons
            </CardTitle>
            <CardDescription>
              Claim adjustment reason codes (CARC) across denied claims
            </CardDescription>
          </CardHeader>
          <CardContent>
            {denialData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No denials recorded
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={denialData}
                    layout="vertical"
                    margin={{ left: 8, right: 16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke="#e2e8f0"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={72}
                      tick={{ fontSize: 11, fill: "#64748b" }}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(239,68,68,0.06)" }}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        fontSize: 12,
                      }}
                      formatter={(value) => [value, "Claims"]}
                      labelFormatter={(label) => {
                        const entry = denialData.find((d) => d.label === label);
                        return entry
                          ? `${entry.label} — ${entry.description}`
                          : label;
                      }}
                    />
                    <Bar dataKey="count" fill={DENIAL_RED} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1 border-t border-border pt-3">
                  {denialData.map((reason) => (
                    <p
                      key={reason.label}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-mono font-medium text-slate-700">
                        {reason.label}
                      </span>{" "}
                      — {reason.description}
                    </p>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Claims by Status
            </CardTitle>
            <CardDescription>Current pipeline distribution</CardDescription>
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
                  <Bar dataKey="count" fill={CHART_PRIMARY} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Payer Performance
            </CardTitle>
            <CardDescription>
              Volume, billed charges, and denial rate by payer
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.payers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No payer data
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={thClass}>Payer</TableHead>
                      <TableHead className={cn(thClass, "text-right")}>
                        Claims
                      </TableHead>
                      <TableHead className={cn(thClass, "text-right")}>
                        Billed
                      </TableHead>
                      <TableHead className={cn(thClass, "text-right")}>
                        Denial rate
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payers.map((payer) => (
                      <TableRow
                        key={payer.payer}
                        className="odd:bg-white even:bg-slate-50/50 hover:bg-blue-50/50"
                      >
                        <TableCell className="text-sm font-medium text-slate-800">
                          {payer.payer}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {payer.claims}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(payer.billed)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={cn(
                              payer.denialRate >= 0.3
                                ? "bg-red-100 text-red-800 border-red-200"
                                : payer.denialRate >= 0.15
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-emerald-100 text-emerald-800 border-emerald-200",
                            )}
                          >
                            {Math.round(payer.denialRate * 100)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Daily Claim Volume
            </CardTitle>
            <CardDescription>
              Claims received per day (last 14 days with activity)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.dailyVolume.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No volume data
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={data.dailyVolume}
                  margin={{ left: 0, right: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#64748b" }}
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
                    dataKey="claims"
                    stroke={CHART_PRIMARY}
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
    </div>
  );
}
