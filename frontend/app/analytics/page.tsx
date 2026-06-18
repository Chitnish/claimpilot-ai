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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const REFRESH_INTERVAL_MS = 30_000;

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
        <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
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
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Denial patterns, payer performance, and claim volume
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Claims
            </CardTitle>
            <FileText className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.totalClaims}</p>
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
              {formatCurrency(data.totalBilled)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Denial Rate
            </CardTitle>
            <TrendingDown className="size-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {Math.round(data.denialRate * 100)}%
            </p>
            <p className="text-xs text-muted-foreground">
              of adjudicated claims
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              High-Risk Open Claims
            </CardTitle>
            <AlertTriangle className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.highRiskOpen}</p>
            <p className="text-xs text-muted-foreground">
              ≥60% predicted denial risk, not yet submitted
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[#1e3a5f]">
          Operational KPIs
        </h2>
        <span className="text-xs text-muted-foreground">
          measured over {data.adjudicatedCount} adjudicated claims
        </span>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Clean Claim Rate
            </CardTitle>
            <ShieldCheck className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {data.adjudicatedCount > 0
                ? `${Math.round(data.cleanClaimRate * 100)}%`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.metricDefinitions.clean_claim_rate ??
                "First-pass payer acceptance"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Manual-Touch Rate
            </CardTitle>
            <Hand className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {data.adjudicatedCount > 0
                ? `${Math.round(data.touchRate * 100)}%`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Lower is better — needed human review
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Auto-Processed
            </CardTitle>
            <Zap className="size-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.autoProcessedCount}</p>
            <p className="text-xs text-muted-foreground">
              Touchless, end-to-end
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Processing Time
            </CardTitle>
            <Clock className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatAvgProcessingSeconds(avgProcessingSeconds)}
            </p>
            <p className="text-xs text-muted-foreground">
              Industry avg: 3-5 days
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Denial Reasons</CardTitle>
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
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={72}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value) => [value, "Claims"]}
                      labelFormatter={(label) => {
                        const entry = denialData.find(
                          (d) => d.label === label,
                        );
                        return entry
                          ? `${entry.label} — ${entry.description}`
                          : label;
                      }}
                    />
                    <Bar dataKey="count" fill="#dc2626" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1 border-t pt-3">
                  {denialData.map((reason) => (
                    <p
                      key={reason.label}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-mono font-medium text-foreground">
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
            <CardTitle className="text-base">Claims by Status</CardTitle>
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
                  <Bar dataKey="count" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payer Performance</CardTitle>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payer</TableHead>
                    <TableHead className="text-right">Claims</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Denial rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payers.map((payer) => (
                    <TableRow key={payer.payer}>
                      <TableCell className="text-sm font-medium">
                        {payer.payer}
                      </TableCell>
                      <TableCell className="text-right">
                        {payer.claims}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(payer.billed)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            payer.denialRate >= 0.3
                              ? "danger"
                              : payer.denialRate >= 0.15
                                ? "warning"
                                : "success"
                          }
                        >
                          {Math.round(payer.denialRate * 100)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Claim Volume</CardTitle>
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="claims"
                    stroke="#1e3a5f"
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
    </div>
  );
}
