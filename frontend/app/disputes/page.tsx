"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  MessageSquareWarning,
} from "lucide-react";

import { getPendingDisputes, resolveDispute } from "@/lib/api";
import { truncateId } from "@/lib/claim-ui";
import type { DisputeItem } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

function previewMessages(item: DisputeItem): DisputeItem["disputeThread"] {
  const thread = item.disputeThread;
  if (thread.length <= 2) {
    return thread;
  }
  return thread.slice(-2);
}

function formatTimestamp(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function senderLabel(sender: string): string {
  if (sender === "payer_reply") {
    return "Reply to Appeal";
  }
  if (sender === "ai_reply") {
    return "AI Reply";
  }
  return sender;
}

export default function DisputesPage(): React.ReactElement {
  const router = useRouter();
  const [items, setItems] = useState<DisputeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const loadDisputes = useCallback(async (): Promise<void> => {
    try {
      const data = await getPendingDisputes();
      setItems(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load pending disputes";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDisputes();
    const interval = setInterval(() => {
      void loadDisputes();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadDisputes]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleResolve = async (item: DisputeItem): Promise<void> => {
    setActingOn(item.id);
    const note = notes[item.id]?.trim() ?? "";
    try {
      await resolveDispute(item.claimId, note);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setNotes((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setToast("Dispute marked resolved.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to resolve dispute.";
      setToast(message);
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Pending Disputes</h1>
          <Badge variant="warning">{items.length}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Appeal email threads flagged for human review
        </p>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
        </div>
      ) : error && items.length === 0 ? (
        <p className="text-center text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-background py-16 text-center">
          <CheckCircle2 className="mb-3 size-12 text-emerald-500" />
          <p className="text-lg font-medium text-[#1e3a5f]">
            No pending disputes
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => {
            const previews = previewMessages(item);
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
                    <Badge className="shrink-0 border-amber-200 bg-amber-100 text-amber-800">
                      <MessageSquareWarning className="mr-1 size-3" />
                      CARC {item.carcCode || "—"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {previews.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Recent thread
                      </p>
                      {previews.map((msg, index) => (
                        <div
                          key={`${msg.sender}-${index}`}
                          className={cn(
                            "rounded-lg p-3 text-sm",
                            msg.sender === "ai_reply"
                              ? "ml-4 bg-[#1e3a5f]/10"
                              : "mr-4 bg-muted",
                          )}
                        >
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {senderLabel(msg.sender)}
                            {msg.createdAt && (
                              <span className="ml-2 font-normal">
                                {formatTimestamp(msg.createdAt)}
                              </span>
                            )}
                          </p>
                          <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                            {msg.messageText}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <Textarea
                    placeholder="Resolution note (optional)"
                    rows={2}
                    value={notes[item.id] ?? ""}
                    className="resize-none text-sm"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const value = event.target.value;
                      setNotes((prev) => ({
                        ...prev,
                        [item.id]: value,
                      }));
                    }}
                  />

                  <Button
                    className="w-full bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
                    disabled={isActing}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleResolve(item);
                    }}
                  >
                    {isActing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="mr-1.5 size-4" />
                        Mark Resolved
                      </>
                    )}
                  </Button>
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
