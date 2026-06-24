"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Users,
} from "lucide-react";

import { listPatients } from "@/lib/api";
import { formatCurrency, displayText } from "@/lib/claim-ui";
import { formatDate, patientFullName } from "@/lib/patient-ui";
import type { PatientListItem } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 350;

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-purple-100 text-purple-700",
  "bg-amber-100 text-amber-700",
  "bg-cyan-100 text-cyan-700",
  "bg-rose-100 text-rose-700",
] as const;

function avatarColor(seed: string): string {
  const code = seed.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length]!;
}

export default function PatientsPage(): React.ReactElement {
  const router = useRouter();
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [total, setTotal] = useState(0);
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
      const result = await listPatients({
        q: debouncedSearch,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setPatients(result.items);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load patients");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const toRow = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Patients
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Patient directory with demographics, insurance, and claims history
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Search by name, member ID, payer, or phone…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="h-11 w-full rounded-lg border border-input bg-white pl-11 pr-3 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      </div>

      {loading && patients.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin text-brand" />
          Loading patients…
        </div>
      ) : error && patients.length === 0 ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : patients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No patients found"
          description="Try a different search term to locate a patient record."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {patients.map((patient) => {
              const name = patientFullName(
                patient.firstName,
                patient.lastName,
              );
              const initial = (
                patient.lastName ||
                patient.firstName ||
                "?"
              )
                .charAt(0)
                .toUpperCase();
              return (
                <Card
                  key={patient.id}
                  className="flex cursor-pointer flex-col p-5 transition-shadow hover:shadow-card-hover"
                  onClick={() => router.push(`/patients/${patient.id}`)}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold",
                        avatarColor(initial),
                      )}
                    >
                      {initial}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">
                        {name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        DOB {formatDate(patient.dob)}
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {displayText(patient.memberId)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Badge
                      variant="outline"
                      className="bg-blue-100 text-blue-800 border-blue-200"
                    >
                      {displayText(patient.payerName)}
                    </Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
                    <div>
                      <p className="text-xs text-slate-500">Total claims</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900">
                        {patient.totalClaims}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Total billed</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900">
                        {formatCurrency(patient.totalBilled)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end">
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
                      View Profile
                      <ChevronRight className="size-4" />
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {fromRow}–{toRow} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
                className="inline-flex items-center rounded-md border border-border bg-white px-2 py-1 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span>
                Page {page + 1} of {pageCount}
              </span>
              <button
                type="button"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
                className="inline-flex items-center rounded-md border border-border bg-white px-2 py-1 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
