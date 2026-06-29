"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Banknote, Loader2, Wallet } from "lucide-react";

import { getArAging } from "@/lib/api";
import { formatCurrency } from "@/lib/claim-ui";
import type { ArAging } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard, type StatAccent } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CountUp, Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

const usd0 = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const REFRESH_INTERVAL_MS = 30_000;
const thClass = "text-xs font-semibold uppercase tracking-wider text-slate-500";

const BUCKET_ORDER = ["0-30", "31-60", "61-90", "90+"] as const;

const BUCKET_ACCENT: Record<string, StatAccent> = {
  "0-30": "green",
  "31-60": "amber",
  "61-90": "orange",
  "90+": "red",
};

const BUCKET_BAR_COLOR: Record<string, string> = {
  "0-30": "#22c55e",
  "31-60": "#f59e0b",
  "61-90": "#f97316",
  "90+": "#ef4444",
};

function bucketBadgeClass(bucket: string): string {
  switch (bucket) {
    case "0-30":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "31-60":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "61-90":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "90+":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export default function AccountsReceivablePage(): React.ReactElement {
  const [data, setData] = useState<ArAging | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const aging = await getArAging();
      setData(aging);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load A/R");
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

  const bucketMap = new Map(data.buckets.map((b) => [b.bucket, b]));
  const chartData = BUCKET_ORDER.map((bucket) => {
    const b = bucketMap.get(bucket);
    return {
      bucket: `${bucket} days`,
      raw: bucket,
      amount: b?.amount ?? 0,
      count: b?.count ?? 0,
    };
  });

  const overdueBucket = bucketMap.get("90+");
  const overdueAmount = overdueBucket?.amount ?? 0;

  return (
    <div className="p-6 lg:p-8">
      <Reveal className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Collections
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-slate-900">
          Accounts Receivable
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outstanding patient balances and aging — what patients owe after
          insurance adjudication
        </p>
      </Reveal>

      {/* Financial urgency banner */}
      {overdueAmount > 0 && (
        <Reveal className="mb-6">
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-4 shadow-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 ring-1 ring-red-200">
              <AlertTriangle className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-semibold text-red-800">
                {formatCurrency(overdueAmount)} in balances over 90 days
              </p>
              <p className="mt-0.5 text-red-700">
                {overdueBucket?.count ?? 0} account
                {(overdueBucket?.count ?? 0) === 1 ? "" : "s"} at high collection
                risk
                — prioritize follow-up.
              </p>
            </div>
          </div>
        </Reveal>
      )}

      <Stagger className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StaggerItem>
          <StatCard
            label="Total Patient A/R"
            value={<CountUp value={data.totalOutstanding} format={usd0} />}
            subtitle={`${data.openAccounts} open account${data.openAccounts === 1 ? "" : "s"}`}
            icon={Wallet}
            accent="blue"
          />
        </StaggerItem>
        {BUCKET_ORDER.map((bucket) => {
          const b = bucketMap.get(bucket);
          return (
            <StaggerItem key={bucket}>
              <StatCard
                label={`${bucket} days`}
                value={<CountUp value={b?.amount ?? 0} format={usd0} />}
                subtitle={`${b?.count ?? 0} account${(b?.count ?? 0) === 1 ? "" : "s"}`}
                icon={Banknote}
                accent={BUCKET_ACCENT[bucket] ?? "slate"}
              />
            </StaggerItem>
          );
        })}
      </Stagger>

      <Reveal className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Aging Buckets
            </CardTitle>
            <CardDescription>Patient balance by days outstanding</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  cursor={{ fill: "rgba(15,23,42,0.04)" }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                    boxShadow: "0 10px 30px -12px rgba(15,23,42,0.25)",
                  }}
                />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.raw}
                      fill={BUCKET_BAR_COLOR[entry.raw] ?? "#0ea5e9"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              Outstanding Patient Balances
            </CardTitle>
            <CardDescription>
              {data.openAccounts} open account
              {data.openAccounts === 1 ? "" : "s"} · sorted by age
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.accounts.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No outstanding patient balances"
                description="Patient A/R appears here once reconciled claims leave a balance (requires migration 0004 for historical roll-up)."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={thClass}>Account</TableHead>
                      <TableHead className={thClass}>Payer</TableHead>
                      <TableHead className={cn(thClass, "text-right")}>
                        Age
                      </TableHead>
                      <TableHead className={thClass}>Bucket</TableHead>
                      <TableHead className={cn(thClass, "text-right")}>
                        Balance
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.accounts.map((a) => {
                      const overdue = a.bucket === "90+";
                      return (
                        <TableRow
                          key={a.claimId}
                          className={cn(
                            "group",
                            overdue
                              ? "bg-red-50/70 hover:bg-red-50"
                              : "odd:bg-white even:bg-slate-50/50 hover:bg-brand/[0.05]",
                          )}
                        >
                          <TableCell>
                            <Link
                              href={`/claims/${a.claimId}`}
                              className="inline-block rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-sky-50"
                            >
                              {a.claimId.slice(0, 8).toUpperCase()}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-slate-700">
                            {a.payerName || "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-slate-700">
                            {a.ageDays}d
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                bucketBadgeClass(a.bucket),
                                overdue && "animate-status-pulse-danger",
                              )}
                            >
                              {a.bucket}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-bold tabular-nums",
                              overdue ? "text-red-700" : "text-slate-900",
                            )}
                          >
                            {formatCurrency(a.balance)}
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
