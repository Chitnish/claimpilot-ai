"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
} from "lucide-react";

import { exportClaimsUrl, searchClaims } from "@/lib/api";
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
import { Button } from "@/components/ui/button";
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

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 350;

const STATUS_OPTIONS = [
  "draft",
  "extracted",
  "coded",
  "scrubbed",
  "needs_review",
  "submitted",
  "denied",
  "appealed",
  "paid",
  "reconciled",
] as const;

const inputClass =
  "h-9 rounded-md border border-input bg-white px-3 text-sm shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30";

export default function ClaimsWorkListPage(): React.ReactElement {
  const router = useRouter();

  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [payerFilter, setPayerFilter] = useState("");
  const [page, setPage] = useState(0);

  const [claims, setClaims] = useState<Claim[]>([]);
  const [total, setTotal] = useState(0);
  const [payerOptions, setPayerOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchText);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchText]);

  const fetchPage = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await searchClaims({
        q: debouncedSearch,
        status: statusFilter,
        payer: payerFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setClaims(result.items);
      setTotal(result.total);
      setPayerOptions(result.payers);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load claims";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, payerFilter, page]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const toRow = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Claims</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search, filter, and work the full claims list
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="text-base">Work list</CardTitle>
              <CardDescription>
                {total} claim{total === 1 ? "" : "s"} matching current filters
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Claim ID, payer, CARC…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className={cn(inputClass, "w-56 pl-8")}
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(0);
                }}
                className={inputClass}
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </select>
              <select
                value={payerFilter}
                onChange={(e) => {
                  setPayerFilter(e.target.value);
                  setPage(0);
                }}
                className={inputClass}
              >
                <option value="">All payers</option>
                {payerOptions.map((payer) => (
                  <option key={payer} value={payer}>
                    {payer}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={total === 0}
                asChild
              >
                <a
                  href={exportClaimsUrl({
                    q: debouncedSearch,
                    status: statusFilter,
                    payer: payerFilter,
                  })}
                >
                  <Download className="size-4" />
                  Export CSV
                </a>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          {loading && claims.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-[#1e3a5f]" />
            </div>
          ) : claims.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No claims match the current filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>CARC</TableHead>
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
                  return (
                    <TableRow
                      key={claim.claimId}
                      className="cursor-pointer"
                      onClick={() => {
                        if (claim.claimId) {
                          router.push(`/claims/${claim.claimId}`);
                        }
                      }}
                    >
                      <TableCell className="font-mono text-xs">
                        {truncateId(claim.claimId)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(claim.status)}>
                          {formatStatus(claim.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {displayText(claim.payerName)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {displayText(claim.carcCode)}
                      </TableCell>
                      <TableCell>{formatCurrency(claim.totalCharge)}</TableCell>
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

          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Showing {fromRow}–{toRow} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
