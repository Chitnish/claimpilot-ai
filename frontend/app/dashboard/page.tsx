"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DollarSign, FileText, Loader2, ShieldCheck, TrendingUp } from "lucide-react";

import { listClaims } from "@/lib/api";
import {
  denialRiskColor,
  displayNumber,
  displayText,
  formatCurrency,
  formatStatus,
  statusBadgeVariant,
  truncateId,
} from "@/lib/claim-ui";
import type { Claim } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const POLL_INTERVAL_MS = 10_000;

interface DashboardStats {
  totalClaims: number;
  cleanClaimRate: number;
  avgDenialRisk: number;
  totalBilled: number;
}

function computeStats(claims: Claim[]): DashboardStats {
  const totalClaims = claims.length;
  const reconciled = claims.filter((c) => c.status === "reconciled").length;
  const cleanClaimRate =
    totalClaims > 0 ? Math.round((reconciled / totalClaims) * 100) : 0;
  const avgDenialRisk =
    totalClaims > 0
      ? Math.round(
          (claims.reduce(
            (sum, c) => sum + displayNumber(c.denialRisk),
            0,
          ) /
            totalClaims) *
            100,
        )
      : 0;
  const totalBilled = claims.reduce(
    (sum, c) => sum + displayNumber(c.totalCharge),
    0,
  );

  return { totalClaims, cleanClaimRate, avgDenialRisk, totalBilled };
}

function statusChartData(
  claims: Claim[],
): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const claim of claims) {
    const status = displayText(claim.status);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({
      status: formatStatus(status),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

export default function DashboardPage(): React.ReactElement {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClaims = useCallback(async (): Promise<void> => {
    try {
      const data = await listClaims();
      setClaims(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load claims";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchClaims();
    const interval = setInterval(() => {
      void fetchClaims();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchClaims]);

  const stats = useMemo(() => computeStats(claims), [claims]);
  const chartData = useMemo(() => statusChartData(claims), [claims]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
      </div>
    );
  }

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
              Total claims
            </CardTitle>
            <FileText className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalClaims}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Clean claim rate
            </CardTitle>
            <ShieldCheck className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.cleanClaimRate}%</p>
            <p className="text-xs text-muted-foreground">Status = reconciled</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg denial risk
            </CardTitle>
            <TrendingUp className="size-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.avgDenialRisk}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total billed
            </CardTitle>
            <DollarSign className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatCurrency(stats.totalBilled)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
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
                        <TableCell>
                          {formatCurrency(claim.totalCharge)}
                        </TableCell>
                        <TableCell className="w-36">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={riskPercent}
                              indicatorClassName={denialRiskColor(riskPercent)}
                              className="flex-1"
                            />
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

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Claims by status</CardTitle>
            <CardDescription>Distribution across pipeline stages</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No data to chart
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
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
      </div>
    </div>
  );
}
