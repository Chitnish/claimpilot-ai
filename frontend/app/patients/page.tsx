"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

import { listPatients } from "@/lib/api";
import { formatCurrency, displayText } from "@/lib/claim-ui";
import { formatDate, patientFullName } from "@/lib/patient-ui";
import type { PatientListItem } from "@/lib/schemas";
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

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 350;

const inputClass =
  "h-9 rounded-md border border-input bg-white px-3 text-sm shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30";

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
        <h1 className="text-2xl font-bold text-[#1e3a5f]">Patients</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Patient directory with demographics, insurance, and claims history.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-[#1e3a5f]">Patient Directory</CardTitle>
          <CardDescription>
            Search by name, member ID, payer, or phone.
          </CardDescription>
          <div className="relative mt-3 max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search patients…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={`${inputClass} w-full pl-9`}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              Loading patients…
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          ) : patients.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No patients found.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>DOB</TableHead>
                    <TableHead>Payer</TableHead>
                    <TableHead>Member ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Claims</TableHead>
                    <TableHead className="text-right">Total Billed</TableHead>
                    <TableHead>Last Visit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients.map((patient) => (
                    <TableRow
                      key={patient.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/patients/${patient.id}`)}
                    >
                      <TableCell className="font-medium">
                        {patientFullName(patient.firstName, patient.lastName)}
                      </TableCell>
                      <TableCell>{formatDate(patient.dob)}</TableCell>
                      <TableCell>{displayText(patient.payerName)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {displayText(patient.memberId)}
                      </TableCell>
                      <TableCell>{displayText(patient.phonePrimary)}</TableCell>
                      <TableCell className="text-right">{patient.totalClaims}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(patient.totalBilled)}
                      </TableCell>
                      <TableCell>{formatDate(patient.lastVisit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {fromRow}–{toRow} of {total}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    className="inline-flex items-center rounded-md border px-2 py-1 disabled:opacity-40"
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
                    className="inline-flex items-center rounded-md border px-2 py-1 disabled:opacity-40"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
