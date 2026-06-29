"use client";

import { useCallback, useEffect, useState } from "react";
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

const REFRESH_INTERVAL_MS = 30_000;
const CHART_PRIMARY = "#0ea5e9";

const thClass = "text-xs font-semibold uppercase tracking-wider text-slate-400";

// Dark chart styling, shared across this page's Recharts.
const CHART_AXIS = "#94a3b8";
const CHART_GRID = "rgba(148,163,184,0.12)";
const CHART_TOOLTIP = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "#131c30",
  color: "#e8eef7",
  fontSize: 12,
  boxShadow: "0 12px 30px -12px rgba(0,0,0,0.7)",
} as const;

const usd0 = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const pct = (n: number): string => `${Math.round(n)}%`;

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
      <Reveal className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Performance Intelligence
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-white">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Denial patterns, payer performance, and claim volume
        </p>
      </Reveal>

      <Stagger className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Total Claims"
            value={<CountUp value={data.totalClaims} />}
            icon={FileText}
            accent="blue"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Total Billed"
            value={<CountUp value={data.totalBilled} format={usd0} />}
            icon={DollarSign}
            accent="blue"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Denial Rate"
            value={<CountUp value={Math.round(data.denialRate * 100)} format={pct} />}
            subtitle="of adjudicated claims"
            icon={TrendingDown}
            accent="red"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="High-Risk Open Claims"
            value={<CountUp value={data.highRiskOpen} />}
            subtitle="≥60% predicted denial risk, not yet submitted"
            icon={AlertTriangle}
            accent="amber"
          />
        </StaggerItem>
      </Stagger>

      <Reveal className="mb-3 flex items-center gap-3 border-t border-border pt-5">
        <h2 className="font-display text-base font-semibold text-white">
          Operational KPIs
        </h2>
        <span className="text-xs text-muted-foreground">
          measured over {data.adjudicatedCount} adjudicated claims
        </span>
      </Reveal>
      <Stagger className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Clean Claim Rate"
            value={
              data.adjudicatedCount > 0 ? (
                <CountUp value={Math.round(data.cleanClaimRate * 100)} format={pct} />
              ) : (
                "—"
              )
            }
            subtitle={
              data.metricDefinitions.clean_claim_rate ??
              "First-pass payer acceptance"
            }
            icon={ShieldCheck}
            accent="green"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Manual-Touch Rate"
            value={
              data.adjudicatedCount > 0 ? (
                <CountUp value={Math.round(data.touchRate * 100)} format={pct} />
              ) : (
                "—"
              )
            }
            subtitle="Lower is better — needed human review"
            icon={Hand}
            accent="amber"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Auto-Processed"
            value={<CountUp value={data.autoProcessedCount} />}
            subtitle="Touchless, end-to-end"
            icon={Zap}
            accent="blue"
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
            icon={Clock}
            accent="slate"
          />
        </StaggerItem>
      </Stagger>

      <Reveal>
        <h2 className="mb-3 border-t border-border pt-5 font-display text-base font-semibold text-white">
          Denial &amp; Pipeline Insights
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-white">
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
                      <defs>
                        <linearGradient id="denialGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#f87171" />
                          <stop offset="100%" stopColor="#dc2626" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        horizontal={false}
                        stroke={CHART_GRID}
                      />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: CHART_AXIS }}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={72}
                        tick={{ fontSize: 11, fill: CHART_AXIS }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(239,68,68,0.06)" }}
                        contentStyle={CHART_TOOLTIP}
                        formatter={(value) => [value, "Claims"]}
                        labelFormatter={(label) => {
                          const entry = denialData.find((d) => d.label === label);
                          return entry
                            ? `${entry.label} — ${entry.description}`
                            : label;
                        }}
                      />
                      <Bar
                        dataKey="count"
                        fill="url(#denialGrad)"
                        radius={[0, 6, 6, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1 border-t border-border pt-3">
                    {denialData.map((reason) => (
                      <p
                        key={reason.label}
                        className="text-xs text-muted-foreground"
                      >
                        <span className="font-mono font-medium text-slate-200">
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
              <CardTitle className="text-base text-white">
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
                    <defs>
                      <linearGradient id="statusGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="#0284c7" />
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
                      cursor={{ fill: "rgba(14,165,233,0.06)" }}
                      contentStyle={CHART_TOOLTIP}
                    />
                    <Bar
                      dataKey="count"
                      fill="url(#statusGrad)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </Reveal>

      <Reveal className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-white">
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
                  <TableHeader className="bg-white/[0.03]">
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
                        className="odd:bg-transparent even:bg-white/[0.03] hover:bg-white/[0.04]"
                      >
                        <TableCell className="text-sm font-medium text-slate-100">
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
                                ? "bg-red-500/15 text-red-300 border-red-500/25"
                                : payer.denialRate >= 0.15
                                  ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
                                  : "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
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
            <CardTitle className="text-base text-white">
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
                <AreaChart
                  data={data.dailyVolume}
                  margin={{ left: 0, right: 8 }}
                >
                  <defs>
                    <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={CHART_GRID}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
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
                    dataKey="claims"
                    stroke={CHART_PRIMARY}
                    strokeWidth={2.5}
                    fill="url(#volumeFill)"
                    dot={{ fill: CHART_PRIMARY, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}
