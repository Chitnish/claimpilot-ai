"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, Users, Wallet } from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const REFRESH_INTERVAL_MS = 30_000;

function bucketBadgeVariant(
  bucket: string,
): "success" | "warning" | "danger" | "secondary" {
  switch (bucket) {
    case "0-30":
      return "success";
    case "31-60":
      return "warning";
    case "61-90":
      return "danger";
    case "90+":
      return "danger";
    default:
      return "secondary";
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
        <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
      </div>
    );
  }

  const chartData = data.buckets.map((b) => ({
    bucket: `${b.bucket} days`,
    amount: b.amount,
    count: b.count,
  }));

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">
          Accounts Receivable
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Outstanding patient balances and aging — what patients owe after
          insurance adjudication
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Patient A/R
            </CardTitle>
            <Wallet className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {formatCurrency(data.totalOutstanding)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Open Accounts
            </CardTitle>
            <Users className="size-4 text-[#1e3a5f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.openAccounts}</p>
          </CardContent>
        </Card>

        {data.buckets.slice(2).map((b) => (
          <Card key={b.bucket}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {b.bucket} days
              </CardTitle>
              <Badge variant={bucketBadgeVariant(b.bucket)}>{b.count}</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(b.amount)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Aging buckets</CardTitle>
            <CardDescription>Patient balance by days outstanding</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  cursor={{ fill: "rgba(30,58,95,0.06)" }}
                />
                <Bar dataKey="amount" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Outstanding patient balances</CardTitle>
            <CardDescription>
              {data.openAccounts} open account
              {data.openAccounts === 1 ? "" : "s"} · sorted by age
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.accounts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Wallet className="mx-auto mb-3 size-8 text-muted-foreground/40" />
                <p>No outstanding patient balances.</p>
                <p className="mt-1 text-xs">
                  Patient A/R appears here once reconciled claims leave a balance
                  (requires migration 0004 for historical roll-up).
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Payer</TableHead>
                    <TableHead className="text-right">Age</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.accounts.map((a) => (
                    <TableRow key={a.claimId}>
                      <TableCell>
                        <Link
                          href={`/claims/${a.claimId}`}
                          className="font-mono text-xs text-[#1e3a5f] underline underline-offset-2"
                        >
                          {a.claimId.slice(0, 8).toUpperCase()}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{a.payerName || "—"}</TableCell>
                      <TableCell className="text-right text-sm">
                        {a.ageDays}d
                      </TableCell>
                      <TableCell>
                        <Badge variant={bucketBadgeVariant(a.bucket)}>
                          {a.bucket}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(a.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
