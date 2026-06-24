"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Eye,
  Loader2,
  X,
} from "lucide-react";

import { bulkResume, getReviewQueue, resumeClaim } from "@/lib/api";
import {
  denialRiskColor,
  formatCurrency,
  truncateId,
} from "@/lib/claim-ui";
import type { ReviewItem } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;
// "Low risk" claims are the safe candidates for one-click bulk approval.
const LOW_RISK_THRESHOLD = 0.4;

interface ReasonBadgeStyle {
  className: string;
  icon: typeof AlertTriangle | typeof Eye | null;
}

function getReasonBadgeStyle(reason: string): ReasonBadgeStyle {
  const lower = reason.toLowerCase();
  if (lower.includes("denial risk")) {
    return {
      className: "border-amber-200 bg-amber-100 text-amber-800",
      icon: AlertTriangle,
    };
  }
  if (lower.includes("low confidence")) {
    return {
      className: "border-blue-200 bg-blue-100 text-blue-800",
      icon: Eye,
    };
  }
  return {
    className: "border-slate-200 bg-slate-100 text-slate-600",
    icon: null,
  };
}

export default function ReviewPage(): React.ReactElement {
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);

  const loadQueue = useCallback(async (): Promise<void> => {
    try {
      const data = await getReviewQueue();
      setItems(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load review queue";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    const interval = setInterval(() => {
      void loadQueue();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadQueue]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const toggleSelected = (itemId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const selectLowRisk = (): void => {
    setSelected(
      new Set(
        items
          .filter((item) => item.denialRisk < LOW_RISK_THRESHOLD)
          .map((item) => item.id),
      ),
    );
  };

  const clearSelection = (): void => setSelected(new Set());

  const handleBulk = async (approved: boolean): Promise<void> => {
    const chosen = items.filter((item) => selected.has(item.id));
    if (chosen.length === 0) {
      return;
    }
    setBulkActing(true);
    try {
      const result = await bulkResume(
        chosen.map((item) => item.claimId),
        approved,
        "",
      );
      const succeededClaimIds = new Set(
        result.results.filter((r) => r.ok).map((r) => r.claim_id),
      );
      setItems((prev) =>
        prev.filter((row) => !succeededClaimIds.has(row.claimId)),
      );
      clearSelection();
      const verb = approved ? "approved" : "rejected";
      setToast(
        result.failed === 0
          ? `${result.succeeded} claim${result.succeeded === 1 ? "" : "s"} ${verb}.`
          : `${result.succeeded} ${verb}, ${result.failed} skipped (insufficient authority or error).`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Bulk action failed.";
      setToast(message);
    } finally {
      setBulkActing(false);
    }
  };

  const handleDecision = async (
    item: ReviewItem,
    approved: boolean,
  ): Promise<void> => {
    setActingOn(item.id);
    const comment = comments[item.id]?.trim() ?? "";
    try {
      await resumeClaim(item.claimId, approved, comment);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setComments((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setToast(
        approved
          ? "Claim approved and pipeline resumed."
          : "Claim rejected and kept in review.",
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Action failed. Please try again.";
      setToast(message);
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Review Queue
            </h1>
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-100 text-amber-800"
            >
              {items.length} pending
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Claims requiring human approval before submission
          </p>
        </div>
        {items.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectLowRisk}
              disabled={bulkActing}
            >
              Select low-risk (&lt;{Math.round(LOW_RISK_THRESHOLD * 100)}%)
            </Button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sidebar-surface sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 px-4 py-3 text-white shadow-card">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={bulkActing}
              onClick={() => void handleBulk(true)}
            >
              {bulkActing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCheck className="size-4" />
              )}
              Approve selected
            </Button>
            <Button
              size="sm"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={bulkActing}
              onClick={() => void handleBulk(false)}
            >
              Reject selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              disabled={bulkActing}
              onClick={clearSelection}
            >
              <X className="size-4" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-brand" />
        </div>
      ) : error && items.length === 0 ? (
        <p className="text-center text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All clear — no claims pending review"
          description="New claims that need a human decision will appear here automatically."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => {
            const riskPercent = Math.round(item.denialRisk * 100);
            const reasonStyle = getReasonBadgeStyle(item.reason);
            const ReasonIcon = reasonStyle.icon;
            const detailsDenialRisk = item.details.denial_risk;
            const lowConfidenceFields = item.details.low_confidence_fields;
            const isActing = actingOn === item.id;

            return (
              <Card
                key={item.id}
                className="cursor-pointer transition-shadow hover:shadow-card-hover"
                onClick={() => router.push(`/claims/${item.claimId}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label="Select claim for bulk action"
                        checked={selected.has(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleSelected(item.id)}
                        className="mt-1 size-4 cursor-pointer rounded border-input accent-brand"
                      />
                      <div className="min-w-0">
                        <CardTitle className="text-base text-slate-900">
                          {item.patientName.trim() || "Unknown Patient"}
                        </CardTitle>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          {truncateId(item.claimId, 8)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Total charge</p>
                      <p className="text-lg font-bold tabular-nums text-slate-900">
                        {formatCurrency(item.totalCharge)}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-slate-600">Denial risk</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {riskPercent}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-200">
                      <div
                        className={cn(
                          "h-2.5 rounded-full transition-all",
                          denialRiskColor(riskPercent),
                        )}
                        style={{ width: `${riskPercent}%` }}
                      />
                    </div>
                    <div className="mt-2.5">
                      <Badge className={cn("gap-1", reasonStyle.className)}>
                        {ReasonIcon && <ReasonIcon className="size-3" />}
                        {item.reason || "Review required"}
                      </Badge>
                    </div>
                  </div>

                  {(detailsDenialRisk !== undefined ||
                    (lowConfidenceFields && lowConfidenceFields.length > 0)) && (
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <p className="mb-1 font-medium text-slate-500">Details</p>
                      {detailsDenialRisk !== undefined && (
                        <p className="text-slate-700">
                          <span className="text-slate-500">Denial risk: </span>
                          {Math.round(detailsDenialRisk * 100)}%
                        </p>
                      )}
                      {lowConfidenceFields && lowConfidenceFields.length > 0 && (
                        <p className="text-slate-700">
                          <span className="text-slate-500">
                            Low confidence fields:{" "}
                          </span>
                          {lowConfidenceFields.join(", ")}
                        </p>
                      )}
                    </div>
                  )}

                  <div onClick={(event) => event.stopPropagation()}>
                    <label
                      htmlFor={`review-comment-${item.id}`}
                      className="mb-1.5 block text-xs font-medium text-slate-600"
                    >
                      Reason for decision (optional)
                    </label>
                    <Textarea
                      id={`review-comment-${item.id}`}
                      placeholder="Add context for the audit log…"
                      rows={2}
                      value={comments[item.id] ?? ""}
                      className="resize-none text-sm"
                      onChange={(event) => {
                        const value = event.target.value;
                        setComments((prev) => ({
                          ...prev,
                          [item.id]: value,
                        }));
                      }}
                    />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={isActing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDecision(item, true);
                      }}
                    >
                      {isActing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      Approve &amp; Continue
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={isActing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDecision(item, false);
                      }}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-border bg-white px-4 py-3 text-sm shadow-card-hover"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
