"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  Loader2,
} from "lucide-react";

import { getReviewQueue, resumeClaim } from "@/lib/api";
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
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

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
    className: "border-gray-200 bg-gray-100 text-gray-600",
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

  const handleDecision = async (
    item: ReviewItem,
    approved: boolean,
  ): Promise<void> => {
    setActingOn(item.id);
    try {
      await resumeClaim(
        item.claimId,
        approved,
        approved
          ? "Approved via review queue"
          : "Rejected via review queue",
      );
      setItems((prev) => prev.filter((row) => row.id !== item.id));
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
            <h1 className="text-2xl font-bold text-[#1e3a5f]">Review Queue</h1>
            <Badge variant="warning">{items.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Claims requiring human review
          </p>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
        </div>
      ) : error && items.length === 0 ? (
        <p className="text-center text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-background py-16 text-center">
          <CheckCircle className="mb-3 size-12 text-emerald-500" />
          <p className="text-lg font-medium text-[#1e3a5f]">
            All clear — no claims pending review
          </p>
        </div>
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
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => router.push(`/claims/${item.claimId}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {item.patientName.trim() || "Unknown Patient"}
                      </CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {truncateId(item.claimId, 8)}
                      </p>
                    </div>
                    <Badge className={cn("shrink-0", reasonStyle.className)}>
                      {ReasonIcon && <ReasonIcon className="mr-1 size-3" />}
                      {item.reason || "Review required"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Denial risk</span>
                      <span className="font-medium">{riskPercent}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-200">
                      <div
                        className={cn(
                          "h-2 rounded-full transition-all",
                          denialRiskColor(riskPercent),
                        )}
                        style={{ width: `${riskPercent}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Total charge</p>
                    <p className="text-lg font-semibold">
                      {formatCurrency(item.totalCharge)}
                    </p>
                  </div>

                  {(detailsDenialRisk !== undefined ||
                    (lowConfidenceFields && lowConfidenceFields.length > 0)) && (
                    <div className="rounded-lg bg-muted/50 p-3 text-sm">
                      <p className="mb-1 font-medium text-muted-foreground">
                        Details
                      </p>
                      {detailsDenialRisk !== undefined && (
                        <p>
                          <span className="text-muted-foreground">
                            Denial risk:{" "}
                          </span>
                          {Math.round(detailsDenialRisk * 100)}%
                        </p>
                      )}
                      {lowConfidenceFields && lowConfidenceFields.length > 0 && (
                        <p>
                          <span className="text-muted-foreground">
                            Low confidence fields:{" "}
                          </span>
                          {lowConfidenceFields.join(", ")}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={isActing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDecision(item, true);
                      }}
                    >
                      Approve & Continue
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={isActing}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDecision(item, false);
                      }}
                    >
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
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border bg-background px-4 py-3 text-sm shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
