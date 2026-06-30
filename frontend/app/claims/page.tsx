"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
  SearchX,
} from "lucide-react";

import { exportClaimsUrl, searchClaims } from "@/lib/api";
import {
  denialRiskColor,
  displayNumber,
  displayText,
  formatCurrency,
  formatStatus,
  statusBadgeClass,
  truncateId,
} from "@/lib/claim-ui";
import type { Claim } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/motion";
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

const thClass = "text-xs font-semibold uppercase tracking-wider text-slate-400";

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

  const setStatus = (next: string): void => {
    setStatusFilter(next);
    setPage(0);
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const toRow = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="p-6 lg:p-8">
      <Reveal className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Work List
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-white">
          Claims
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search, filter, and work the full claims list
        </p>
      </Reveal>

      <Reveal>
      <Card>
        <CardContent className="pt-6">
          {/* Search */}
          <div className="group relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand" />
            <input
              type="search"
              placeholder="Search by patient name, claim ID, or payer…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-12 pr-4 text-sm shadow-sm transition-all placeholder:text-slate-400 focus:border-brand/40 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-brand/10"
            />
          </div>

          {/* Filter pills */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatus("")}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === ""
                  ? "border-brand bg-brand text-white"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              All statuses
            </button>
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatus(status)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  statusFilter === status
                    ? "border-brand bg-brand text-white"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                {formatStatus(status)}
              </button>
            ))}
            <select
              value={payerFilter}
              onChange={(e) => {
                setPayerFilter(e.target.value);
                setPage(0);
              }}
              className="ml-auto h-8 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-slate-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <option value="">All payers</option>
              {payerOptions.map((payer) => (
                <option key={payer} value={payer}>
                  {payer}
                </option>
              ))}
            </select>
          </div>

          {/* Results header + export */}
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {total} claim{total === 1 ? "" : "s"} matching current filters
            </p>
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

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          {loading && claims.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-brand" />
            </div>
          ) : claims.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={SearchX}
              title="No claims match the current filters"
              description="Try adjusting your search terms or clearing a filter."
            />
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-white/[0.03]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={thClass}>Claim ID</TableHead>
                    <TableHead className={thClass}>Status</TableHead>
                    <TableHead className={thClass}>Payer</TableHead>
                    <TableHead className={thClass}>CARC</TableHead>
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
                    return (
                      <TableRow
                        key={claim.claimId}
                        className="group cursor-pointer odd:bg-transparent even:bg-white/[0.03] hover:bg-brand/[0.05]"
                        onClick={() => {
                          if (claim.claimId) {
                            router.push(`/claims/${claim.claimId}`);
                          }
                        }}
                      >
                        <TableCell>
                          <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-xs text-slate-200 transition-colors group-hover:border-brand/30 group-hover:text-brand">
                            {truncateId(claim.claimId)}
                          </span>
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-sm text-slate-200">
                          {displayText(claim.payerName)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-300">
                          {displayText(claim.carcCode)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(claim.totalCharge)}
                        </TableCell>
                        <TableCell className="w-40">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                              <div
                                className={cn(
                                  "h-2 rounded-full transition-all",
                                  denialRiskColor(riskPercent),
                                )}
                                style={{ width: `${riskPercent}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-xs font-medium tabular-nums text-slate-300">
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

          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
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
      </Reveal>
    </div>
  );
}
